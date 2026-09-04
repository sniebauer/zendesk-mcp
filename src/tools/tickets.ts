import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createZendeskClient, loadConfig, withZendeskError } from "../zendesk.js";
import {
  ACTIONED_TAG,
  REVIEWED_TAG,
  addTags,
  appendTag,
  stampTag,
} from "../tags.js";
import {
  collectAuthorIds,
  hasCustomFieldChanges,
  summarizeAudits,
  type RawAudit,
} from "../audits.js";

const ticketId = z.number().int().positive().describe("Zendesk ticket ID");

export const getTicketInput = z.object({
  id: ticketId,
  include_events: z
    .boolean()
    .default(true)
    .describe(
      "Include `events`: a compact chronological log of everything that happened to the ticket (status/priority/assignee/group changes, tag and CC changes, macros applied, custom field edits), derived from the Ticket Audits API. Set false to skip the audits call entirely."
    ),
  include_raw_audits: z
    .boolean()
    .default(false)
    .describe(
      "Include the unfiltered `audits` array straight from the Ticket Audits API, notification bodies and all. Very large (hundreds of KB on busy tickets) — prefer the summarized `events`."
    ),
});

export const createTicketInput = z.object({
  subject: z.string().min(1).describe("Ticket subject"),
  body: z.string().min(1).describe("Initial comment body (HTML or plain text)"),
  requester_email: z
    .string()
    .email()
    .optional()
    .describe(
      "Email of the ticket requester. If omitted, the authenticated user is the requester."
    ),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  tags: z.array(z.string()).optional(),
  assignee_id: z.number().int().positive().optional(),
  group_id: z.number().int().positive().optional(),
});

const ticketStatus = z.enum([
  "new",
  "open",
  "pending",
  "hold",
  "solved",
  "closed",
]);

const customFieldValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

const customFieldEntry = z.object({
  id: z.number().int().positive().describe("Custom field ID (from the Zendesk admin ticket field config)"),
  value: customFieldValue.describe(
    "New value for the field. Use null to clear it. Multiselect/checkbox fields take an array of tag-like strings."
  ),
});

const updateTicketBase = z.object({
  id: ticketId,
  status: ticketStatus.optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assignee_id: z.number().int().positive().optional(),
  group_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Reassign the ticket to this group."),
  type: z
    .enum(["question", "incident", "problem", "task"])
    .optional()
    .describe(
      "Ticket type. Set 'problem' to make this ticket a Problem others can be linked to, or 'incident' (together with problem_id) to link it under one."
    ),
  problem_id: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "ID of the Problem ticket this incident belongs to. Only valid on a ticket whose type is 'incident' — set both in the same call when converting. Pass null to detach the incident from its problem."
    ),
  ticket_form_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Switch the ticket to this ticket form. Changing the form changes which fields are required, so set any newly required field in the same call."
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      "REPLACES the ticket's entire tag set — any tag not listed here is removed. To add tags without losing the existing ones, use zd_add_ticket_tags instead."
    ),
  custom_fields: z
    .array(customFieldEntry)
    .optional()
    .describe(
      "Custom ticket field updates as [{id, value}] pairs. Only listed fields are touched; omitted custom fields are left as-is."
    ),
});

/** Everything `zd_update_ticket` can write; `id` alone is not an update. */
const UPDATABLE_TICKET_FIELDS = [
  "status",
  "priority",
  "assignee_id",
  "group_id",
  "type",
  "problem_id",
  "ticket_form_id",
  "tags",
  "custom_fields",
] as const;

export const updateTicketInput = updateTicketBase
  .refine(
    (v) => UPDATABLE_TICKET_FIELDS.some((field) => v[field] !== undefined),
    {
      message: `Must set at least one of: ${UPDATABLE_TICKET_FIELDS.join(", ")}`,
    }
  )
  // Zendesk only accepts problem_id on an incident, and rejects the pairing
  // with an opaque RecordInvalid. Type omitted is fine — the ticket may already
  // be an incident.
  .refine(
    (v) =>
      v.problem_id === undefined ||
      v.problem_id === null ||
      v.type === undefined ||
      v.type === "incident",
    {
      message:
        "problem_id is only valid on an incident — pass type:'incident' or omit type if the ticket already is one",
    }
  );

export const listTicketFieldsInput = z.object({});

type RawTicketField = {
  id: number;
  title: string;
  type: string;
  active?: boolean;
  required?: boolean;
  custom_field_options?: Array<{ name?: string; value?: string }> | null;
};

type TicketFieldSummary = {
  id: number;
  title: string;
  type: string;
  active?: boolean;
  required?: boolean;
  options?: Array<{ name?: string; value?: string }>;
};

/**
 * Projects a Zendesk ticket field down to the fields useful for resolving a
 * name/title to the numeric id that zd_update_ticket's custom_fields needs.
 * Dropdown/multiselect (tagger/multiselect) fields also expose their allowed
 * options so a human-readable value can be mapped to the stored tag value.
 */
export function summarizeTicketField(field: RawTicketField): TicketFieldSummary {
  const summary: TicketFieldSummary = {
    id: field.id,
    title: field.title,
    type: field.type,
    active: field.active,
    required: field.required,
  };
  if (field.custom_field_options && field.custom_field_options.length > 0) {
    summary.options = field.custom_field_options.map((o) => ({
      name: o.name,
      value: o.value,
    }));
  }
  return summary;
}

export const addTicketCommentInput = z.object({
  id: ticketId,
  body: z.string().min(1).describe("Comment body"),
  public: z
    .boolean()
    .default(false)
    .describe(
      "If true, the comment is visible to the requester. Default false (internal note)."
    ),
});

export const addTicketTagsInput = z.object({
  id: ticketId,
  tags: z
    .array(z.string().min(1))
    .min(1)
    .describe("Tags to add. Existing tags on the ticket are preserved."),
});

type ZendeskClient = ReturnType<typeof createZendeskClient>;

/** Zendesk caps the show_many id list; audits never come close, but chunking keeps a pathological ticket from 400ing. */
const SHOW_MANY_LIMIT = 100;

/**
 * Ticket fields change rarely and the list is account-wide, so it is cached for
 * the life of the process behind a short TTL — long enough that a burst of
 * zd_get_ticket calls costs one lookup, short enough that a newly created field
 * shows up without a restart.
 */
const FIELD_TITLE_TTL_MS = 10 * 60 * 1000;
let fieldTitleCache: { at: number; titles: Map<number, string> } | undefined;

/** Author names are stable, so resolved ids are memoized for the process lifetime and only the misses are fetched. */
const actorNameCache = new Map<number, string>();

/**
 * Resolves audit author ids to display names.
 *
 * Best-effort by design: this decorates a read that has already succeeded, so a
 * failure here degrades `actor` to a raw numeric id rather than failing the
 * whole tool call.
 */
async function resolveActors(
  client: ZendeskClient,
  ids: number[]
): Promise<Map<number, string>> {
  const resolved = new Map<number, string>();
  const missing: number[] = [];
  for (const id of ids) {
    const cached = actorNameCache.get(id);
    if (cached === undefined) missing.push(id);
    else resolved.set(id, cached);
  }
  if (missing.length === 0) return resolved;

  try {
    for (let i = 0; i < missing.length; i += SHOW_MANY_LIMIT) {
      const chunk = missing.slice(i, i + SHOW_MANY_LIMIT);
      const res: unknown = await client.users.showMany(chunk);
      const users = (
        Array.isArray(res) ? res : ((res as { result?: unknown[] })?.result ?? [])
      ) as Array<{ id?: number; name?: string }>;
      for (const user of users) {
        if (typeof user.id !== "number" || !user.name) continue;
        actorNameCache.set(user.id, user.name);
        resolved.set(user.id, user.name);
      }
    }
  } catch (err) {
    console.error(
      `[zendesk-mcp] could not resolve audit author names: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  return resolved;
}

/**
 * Resolves numeric custom-field ids to their titles.
 *
 * Same best-effort contract as {@link resolveActors}: on failure the summary
 * keeps the raw numeric field id, which is still usable with zd_update_ticket.
 */
async function resolveFieldTitles(
  client: ZendeskClient
): Promise<Map<number, string>> {
  const now = Date.now();
  if (fieldTitleCache && now - fieldTitleCache.at < FIELD_TITLE_TTL_MS) {
    return fieldTitleCache.titles;
  }
  const titles = new Map<number, string>();
  try {
    const res: unknown = await client.ticketfields.list();
    const fields = (
      Array.isArray(res) ? res : ((res as { result?: unknown[] })?.result ?? [])
    ) as RawTicketField[];
    for (const field of fields) {
      if (typeof field.id === "number" && field.title) titles.set(field.id, field.title);
    }
    fieldTitleCache = { at: now, titles };
  } catch (err) {
    console.error(
      `[zendesk-mcp] could not resolve custom field titles: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  return titles;
}

export function registerTicketTools(server: McpServer) {
  server.tool(
    "zd_get_ticket",
    "Fetch a single Zendesk ticket by ID, including its full history. Returns ticket fields, all comments (public + internal), and `events` — a compact chronological log of everything else that happened: status, priority, assignee and group changes, tag and CC changes, macros applied, and custom field edits, each with who did it and which trigger or automation drove it. Use this to answer 'what happened on this ticket and where does it stand'. Pass include_events:false to skip the history, or include_raw_audits:true for the unfiltered Ticket Audits payload.",
    getTicketInput.shape,
    async (raw) => {
      const { id, include_events, include_raw_audits } =
        getTicketInput.parse(raw);
      const cfg = loadConfig();
      const client = createZendeskClient(cfg);
      const { result: ticket } = await withZendeskError(() =>
        client.tickets.show(id)
      );
      const comments = await withZendeskError(() =>
        client.tickets.getComments(id)
      );

      const payload: Record<string, unknown> = { ticket, comments };

      // Skipped entirely when neither view is requested, so opting out costs
      // nothing — the tool then behaves exactly as it did before audits existed.
      let audits: RawAudit[] | undefined;
      if (include_events || include_raw_audits) {
        try {
          audits = (await withZendeskError(() =>
            client.ticketaudits.list(id)
          )) as RawAudit[];
        } catch (err) {
          // History is an enrichment on top of a read that has already
          // succeeded, so a failure here (rate limit, permissions, a timeout on
          // a very long ticket) must not cost the caller the ticket and its
          // comments. Report it in-band instead of throwing, so an absent
          // history is never mistaken for an uneventful ticket.
          payload.events_error =
            err instanceof Error ? err.message : String(err);
        }
      }

      if (audits) {
        if (include_events) {
          const [actors, fields] = await Promise.all([
            resolveActors(client, collectAuthorIds(audits)),
            hasCustomFieldChanges(audits)
              ? resolveFieldTitles(client)
              : Promise.resolve(new Map<number, string>()),
          ]);
          payload.events = summarizeAudits(audits, {
            resolveActor: (authorId) => actors.get(authorId),
            resolveField: (fieldId) => fields.get(fieldId),
          });
        }
        if (include_raw_audits) payload.audits = audits;
      }

      await stampTag(cfg, id, REVIEWED_TAG);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "zd_list_ticket_fields",
    "List all Zendesk ticket fields (system + custom) with their id, title, type, active flag, and — for dropdown/multiselect fields — the allowed options. Use this to resolve a custom field's name/title to the numeric id required by zd_update_ticket's custom_fields parameter.",
    listTicketFieldsInput.shape,
    async (raw) => {
      listTicketFieldsInput.parse(raw);
      const client = createZendeskClient();
      // node-zendesk v5: client.ticketfields.list() resolves to an array of
      // ticket fields; some endpoints instead wrap in {result}, so handle both.
      const res: unknown = await withZendeskError(() =>
        client.ticketfields.list()
      );
      const fields = (
        Array.isArray(res)
          ? res
          : ((res as { result?: unknown[] })?.result ?? [])
      ) as RawTicketField[];
      const summary = fields.map(summarizeTicketField);
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "zd_create_ticket",
    "Create a new Zendesk ticket. Required: subject, body. Optional: requester_email, priority, tags, assignee_id, group_id.",
    createTicketInput.shape,
    async (raw) => {
      const input = createTicketInput.parse(raw);
      const client = createZendeskClient();
      const payload = {
        ticket: {
          subject: input.subject,
          comment: { body: input.body },
          priority: input.priority,
          // Carried inline rather than via a follow-up tags call: one write, and
          // no extra audit entry on a brand-new ticket.
          tags: appendTag(input.tags, ACTIONED_TAG),
          assignee_id: input.assignee_id,
          group_id: input.group_id,
          requester: input.requester_email
            ? { email: input.requester_email }
            : undefined,
        },
      };
      const { result } = await withZendeskError(() =>
        client.tickets.create(payload)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "zd_update_ticket",
    "Update fields on an existing Zendesk ticket: status, priority, assignee_id, group_id, type, problem_id, ticket_form_id, tags, custom_fields (at least one required). Set type:'problem' to turn a ticket into a Problem, or type:'incident' + problem_id to link one under it. Pass custom_fields as [{id, value}] to set custom ticket fields directly (preferred over tag-based workarounds). WARNING: `tags` replaces the ticket's whole tag set — use zd_add_ticket_tags to add tags without dropping the rest. Use zd_add_ticket_comment to add a comment.",
    updateTicketBase.shape,
    async (raw) => {
      const { id, ...fields } = updateTicketInput.parse(raw);
      const cfg = loadConfig();
      const client = createZendeskClient(cfg);
      const { result } = await withZendeskError(() =>
        // node-zendesk types custom field values as string|number|boolean, but
        // the Zendesk REST API also accepts string[] (multiselect/checkbox) and
        // null (to clear a field). Cast to the client's payload type so our
        // broader-but-API-correct schema still type-checks.
        client.tickets.update(id, {
          ticket: fields,
        } as Parameters<typeof client.tickets.update>[1])
      );
      await stampTag(cfg, id, ACTIONED_TAG);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "zd_add_ticket_tags",
    "Add tags to a Zendesk ticket without disturbing the tags already on it. Uses Zendesk's additive tags endpoint. Prefer this over zd_update_ticket's `tags`, which replaces the entire tag set. Returns the ticket's resulting tags.",
    addTicketTagsInput.shape,
    async (raw) => {
      const { id, tags } = addTicketTagsInput.parse(raw);
      const cfg = loadConfig();
      // ACTIONED_TAG rides along in the same additive call: one request, one
      // audit entry, instead of a separate stampTag round trip.
      const result = await addTags(cfg, id, appendTag(tags, ACTIONED_TAG));
      return {
        content: [
          { type: "text", text: JSON.stringify({ id, tags: result }, null, 2) },
        ],
      };
    }
  );

  server.tool(
    "zd_add_ticket_comment",
    "Add a comment to an existing Zendesk ticket. Set `public: true` for a customer-visible reply, false (default) for an internal note.",
    addTicketCommentInput.shape,
    async (raw) => {
      const { id, body, public: isPublic } = addTicketCommentInput.parse(raw);
      const cfg = loadConfig();
      const client = createZendeskClient(cfg);
      const { result } = await withZendeskError(() =>
        client.tickets.update(id, {
          ticket: { comment: { body, public: isPublic } },
        })
      );
      await stampTag(cfg, id, ACTIONED_TAG);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
