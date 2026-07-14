import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createZendeskClient, withZendeskError } from "../zendesk.js";

const ticketId = z.number().int().positive().describe("Zendesk ticket ID");

export const getTicketInput = z.object({ id: ticketId });

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
  tags: z.array(z.string()).optional(),
  custom_fields: z
    .array(customFieldEntry)
    .optional()
    .describe(
      "Custom ticket field updates as [{id, value}] pairs. Only listed fields are touched; omitted custom fields are left as-is."
    ),
});

export const updateTicketInput = updateTicketBase.refine(
  (v) =>
    v.status !== undefined ||
    v.priority !== undefined ||
    v.assignee_id !== undefined ||
    v.tags !== undefined ||
    v.custom_fields !== undefined,
  {
    message:
      "Must set at least one of: status, priority, assignee_id, tags, custom_fields",
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

export function registerTicketTools(server: McpServer) {
  server.tool(
    "zd_get_ticket",
    "Fetch a single Zendesk ticket by ID, including its comments. Returns ticket fields, all comments (public + internal), and basic requester/assignee info.",
    getTicketInput.shape,
    async (raw) => {
      const { id } = getTicketInput.parse(raw);
      const client = createZendeskClient();
      const { result: ticket } = await withZendeskError(() =>
        client.tickets.show(id)
      );
      const comments = await withZendeskError(() =>
        client.tickets.getComments(id)
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ticket, comments }, null, 2),
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
          tags: input.tags,
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
    "Update fields on an existing Zendesk ticket. Must supply at least one of: status, priority, assignee_id, tags, custom_fields. Pass custom_fields as [{id, value}] to set custom ticket fields directly (preferred over tag-based workarounds). Use zd_add_ticket_comment to add a comment.",
    updateTicketBase.shape,
    async (raw) => {
      const { id, ...fields } = updateTicketInput.parse(raw);
      const client = createZendeskClient();
      const { result } = await withZendeskError(() =>
        // node-zendesk types custom field values as string|number|boolean, but
        // the Zendesk REST API also accepts string[] (multiselect/checkbox) and
        // null (to clear a field). Cast to the client's payload type so our
        // broader-but-API-correct schema still type-checks.
        client.tickets.update(id, {
          ticket: fields,
        } as Parameters<typeof client.tickets.update>[1])
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "zd_add_ticket_comment",
    "Add a comment to an existing Zendesk ticket. Set `public: true` for a customer-visible reply, false (default) for an internal note.",
    addTicketCommentInput.shape,
    async (raw) => {
      const { id, body, public: isPublic } = addTicketCommentInput.parse(raw);
      const client = createZendeskClient();
      const { result } = await withZendeskError(() =>
        client.tickets.update(id, {
          ticket: { comment: { body, public: isPublic } },
        })
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
