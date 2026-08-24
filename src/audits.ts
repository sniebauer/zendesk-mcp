/**
 * Condenses Zendesk ticket audits into a compact, chronological change log.
 *
 * The Ticket Audits API (`GET /tickets/{id}/audits`) is a strict superset of
 * the comments endpoint: every update to a ticket is one audit, and each audit
 * carries an `events[]` array describing what changed. That completeness comes
 * at a price — on a real long-lived ticket the raw payload is enormous, and
 * almost all of it is noise:
 *
 *   ticket 277030 -> 86 audits / 657KB, of which 256 `Change`, 52
 *   `FollowerNotification` (full HTML email bodies), 33 `WebhookEvent`,
 *   14 `Notification` (more full email bodies).
 *
 * Two things dominate the size. Notification-shaped events embed entire
 * rendered emails, and every `tags` change repeats the ticket's *whole* tag
 * list twice (before and after) — ~30 tags x 82 changes on that same ticket.
 *
 * So we drop the notification-shaped events, diff the list-valued ones down to
 * what actually changed, and strip comment bodies (they are already returned in
 * full under `comments`). What remains is the answer to "what happened on this
 * ticket, and who did it" at roughly 2% of the original size.
 */

export interface RawVia {
  channel?: string;
  source?: {
    rel?: string | null;
    from?: { title?: string; id?: number | string } | null;
  } | null;
}

export interface RawAuditEvent {
  id?: number;
  type?: string;
  field_name?: string;
  value?: unknown;
  previous_value?: unknown;
  via?: RawVia | null;
  public?: boolean;
  macro_title?: string;
  macro_id?: string | number;
  previous_email_ccs?: unknown;
  current_email_ccs?: unknown;
  previous_followers?: unknown;
  current_followers?: unknown;
  body?: unknown;
  [key: string]: unknown;
}

export interface RawAudit {
  id?: number;
  ticket_id?: number;
  created_at?: string;
  author_id?: number;
  via?: RawVia | null;
  events?: RawAuditEvent[] | null;
}

export interface SummarizedEvent {
  at?: string;
  actor: string;
  via: string;
  kind: string;
  audit_id?: number;
  /** Human-readable field title. Custom fields resolve to their title. */
  field?: string;
  /** Numeric custom field id, when `field` was resolved from one. Feed this straight to zd_update_ticket's custom_fields. */
  field_id?: number;
  from?: unknown;
  to?: unknown;
  added?: string[];
  removed?: string[];
  /** Initial field values captured at ticket creation. */
  values?: Record<string, unknown>;
  comment_id?: number;
  public?: boolean;
  macro?: string;
  article?: string;
}

/**
 * Event types dropped from the summary by default.
 *
 * These are machine-to-machine plumbing: rendered outbound emails, webhook and
 * Slack/integration fan-out, skill/schedule bookkeeping. None of them describe
 * an actual change to the ticket, and the notification ones carry full HTML
 * email bodies. Use `include_raw_audits` when you genuinely need them.
 */
export const NOISE_EVENT_TYPES = new Set([
  "Notification",
  "FollowerNotification",
  "CcNotification",
  "NotificationWithHTML",
  "External",
  "WebhookEvent",
  "ScheduleAssignment",
  "AssociateAttValsEvent",
  "OfferedToEvent",
  "SkillBasedRoutingAttributeChange",
]);

/** Zendesk uses author_id -1 for changes made by the system rather than a user. */
const SYSTEM_AUTHOR_ID = -1;

/**
 * Renders the mechanism behind a change: a named trigger/automation when a rule
 * drove it, otherwise the bare channel ("web", "api", "email", "rule").
 *
 * The rule title is the useful part — "trigger: Assign new tickets created
 * without a Group selected" explains a mystery reassignment on its own.
 */
export function describeVia(via?: RawVia | null): string {
  const rel = via?.source?.rel;
  const title = via?.source?.from?.title;
  if (rel && title) return `${rel}: ${title}`;
  if (rel) return String(rel);
  return via?.channel ?? "unknown";
}

/** Coerces a Zendesk list-valued field to string[]. Tags arrive as an array, but space-delimited strings show up on older audits. */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string" && value.trim() !== "") return value.trim().split(/\s+/);
  return [];
}

/**
 * Reduces a before/after pair of lists to just the delta.
 *
 * This is the single biggest size win: a `tags` change ships the ticket's
 * entire tag list twice, so a one-tag edit costs ~2KB raw and ~40 bytes here.
 */
export function diffList(
  previous: unknown,
  current: unknown
): { added: string[]; removed: string[] } {
  const before = toStringArray(previous);
  const after = toStringArray(current);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((v) => !beforeSet.has(v)),
    removed: before.filter((v) => !afterSet.has(v)),
  };
}

export interface SummarizeOptions {
  /** Maps an author_id to a display name. Return undefined to fall back to the raw id. */
  resolveActor?: (authorId: number) => string | undefined;
  /** Maps a numeric custom-field id to its title. Return undefined to leave the id as-is. */
  resolveField?: (fieldId: number) => string | undefined;
}

function actorFor(audit: RawAudit, opts: SummarizeOptions): string {
  const id = audit.author_id;
  if (id === undefined || id === null) return "unknown";
  if (id === SYSTEM_AUTHOR_ID) return "system";
  return opts.resolveActor?.(id) ?? String(id);
}

/**
 * Splits a Change event's `field_name` into a display title plus, for custom
 * fields, the numeric id it came from.
 *
 * Custom fields surface as bare numeric strings ("8315335133079"), which are
 * meaningless in a summary. We resolve them to titles but keep the id, since
 * that is exactly what zd_update_ticket's `custom_fields` needs to write back.
 */
function fieldFor(
  fieldName: string | undefined,
  opts: SummarizeOptions
): { field?: string; field_id?: number } {
  if (!fieldName) return {};
  if (!/^\d+$/.test(fieldName)) return { field: fieldName };
  const id = Number(fieldName);
  const title = opts.resolveField?.(id);
  return title ? { field: title, field_id: id } : { field: fieldName, field_id: id };
}

/** Field names whose values are lists, so they are worth diffing rather than echoing whole. */
const LIST_VALUED_FIELDS = new Set(["tags", "collaborator_ids", "follower_ids", "email_cc_ids"]);

function summarizeChange(
  event: RawAuditEvent,
  base: Omit<SummarizedEvent, "kind">,
  opts: SummarizeOptions
): SummarizedEvent {
  const resolved = fieldFor(event.field_name, opts);
  const isList =
    LIST_VALUED_FIELDS.has(event.field_name ?? "") ||
    Array.isArray(event.value) ||
    Array.isArray(event.previous_value);

  if (isList) {
    const { added, removed } = diffList(event.previous_value, event.value);
    const out: SummarizedEvent = { ...base, kind: "change", ...resolved };
    if (added.length > 0) out.added = added;
    if (removed.length > 0) out.removed = removed;
    return out;
  }

  return {
    ...base,
    kind: "change",
    ...resolved,
    from: event.previous_value ?? null,
    to: event.value ?? null,
  };
}

/**
 * Flattens audits into a chronological list of meaningful events.
 *
 * Comments are reduced to body-less stubs on purpose: dropping them entirely
 * would leave gaps in the timeline ("status went to pending" with no visible
 * reply), while keeping the bodies would duplicate the `comments` array. The
 * stub carries `comment_id` so a caller can join back to the full text.
 *
 * Unrecognized event types are emitted as bare stubs rather than dropped, so a
 * new Zendesk event type shows up as a known unknown instead of vanishing.
 */
export function summarizeAudits(
  audits: RawAudit[],
  opts: SummarizeOptions = {}
): SummarizedEvent[] {
  const out: SummarizedEvent[] = [];

  for (const audit of audits ?? []) {
    const actor = actorFor(audit, opts);
    const events = audit.events ?? [];
    const fromAudit: SummarizedEvent[] = [];
    // Creation lands as one `Create` event per initial field value; collapsed
    // into a single entry so a new ticket costs one line, not ten.
    const created: Record<string, unknown> = {};

    for (const event of events) {
      const type = event.type ?? "Unknown";
      if (NOISE_EVENT_TYPES.has(type)) continue;

      // A Change event can carry its own `via` (the trigger that fired it);
      // otherwise it inherits the audit's.
      const base: Omit<SummarizedEvent, "kind"> = {
        at: audit.created_at,
        actor,
        via: describeVia(event.via ?? audit.via),
        audit_id: audit.id,
      };

      switch (type) {
        case "Create": {
          const resolved = fieldFor(event.field_name, opts);
          created[resolved.field ?? event.field_name ?? "unknown"] = event.value ?? null;
          break;
        }
        case "Change":
          fromAudit.push(summarizeChange(event, base, opts));
          break;
        case "Comment":
        case "VoiceComment":
          fromAudit.push({
            ...base,
            kind: type === "VoiceComment" ? "voice_comment" : "comment",
            public: event.public,
            comment_id: event.id,
          });
          break;
        case "AgentMacroReference":
          fromAudit.push({ ...base, kind: "macro_applied", macro: event.macro_title });
          break;
        case "EmailCcChange": {
          const { added, removed } = diffList(event.previous_email_ccs, event.current_email_ccs);
          fromAudit.push({ ...base, kind: "cc_change", added, removed });
          break;
        }
        case "FollowerChange": {
          const { added, removed } = diffList(event.previous_followers, event.current_followers);
          fromAudit.push({ ...base, kind: "follower_change", added, removed });
          break;
        }
        case "KnowledgeLinked": {
          const body = event.body as { title?: string; html_url?: string } | undefined;
          fromAudit.push({ ...base, kind: "knowledge_linked", article: body?.title ?? body?.html_url });
          break;
        }
        default:
          // Known-unknown stub: type is preserved, any body is not.
          fromAudit.push({ ...base, kind: type });
          break;
      }
    }

    // `Create` events are collected across the whole audit, so the collapsed
    // entry is prepended here rather than pushed inline — otherwise ticket
    // creation would sort after the first comment it arrived with.
    if (Object.keys(created).length > 0) {
      out.push({
        at: audit.created_at,
        actor,
        via: describeVia(audit.via),
        audit_id: audit.id,
        kind: "created",
        values: created,
      });
    }
    out.push(...fromAudit);
  }

  return out;
}

/** Collects the distinct, resolvable author ids across a set of audits. */
export function collectAuthorIds(audits: RawAudit[]): number[] {
  const ids = new Set<number>();
  for (const audit of audits ?? []) {
    const id = audit.author_id;
    if (typeof id === "number" && id > 0) ids.add(id);
  }
  return [...ids];
}

/** True when any Change/Create event references a custom field by numeric id, meaning a ticket-fields lookup is worth making. */
export function hasCustomFieldChanges(audits: RawAudit[]): boolean {
  for (const audit of audits ?? []) {
    for (const event of audit.events ?? []) {
      if (event.type !== "Change" && event.type !== "Create") continue;
      if (event.field_name && /^\d+$/.test(event.field_name)) return true;
    }
  }
  return false;
}
