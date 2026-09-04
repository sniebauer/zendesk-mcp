import type { ZendeskConfig } from "./zendesk.js";

/**
 * Tags stamped on tickets this MCP touches, for adoption tracking.
 *
 * - {@link REVIEWED_TAG} — the MCP read/inspected the ticket.
 * - {@link ACTIONED_TAG} — the MCP actually wrote to the ticket.
 *
 * A ticket that was written to has usually been read first, so it will
 * typically carry both. To count review-only tickets, exclude the other tag:
 * `tags:ai_reviewed -tags:ai_actioned`.
 */
export const ACTIONED_TAG = "ai_actioned";
export const REVIEWED_TAG = "ai_reviewed";

/**
 * PUT to Zendesk's additive tags endpoint (PUT /tickets/{id}/tags.json with
 * {tags:[...]}), which APPENDS the given tags without replacing the ticket's
 * existing ones.
 *
 * We deliberately do NOT use node-zendesk's client.tickets.addTags: in v5 it
 * routes the PUT through requestAll(), which drops the request body, so the
 * call returns 200 but silently adds nothing.
 */
function putTags(
  cfg: ZendeskConfig,
  id: number,
  tags: string[]
): Promise<Response> {
  const auth = Buffer.from(`${cfg.email}/token:${cfg.token}`).toString("base64");
  return fetch(
    `https://${cfg.subdomain}.zendesk.com/api/v2/tickets/${id}/tags.json`,
    {
      method: "PUT",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tags }),
    }
  );
}

/**
 * Additively add `tags` to a ticket, returning the ticket's resulting tag list.
 *
 * Unlike {@link stampTag} this is the caller's actual request, so failures
 * throw: a tag call that quietly adds nothing is exactly the failure mode this
 * exists to avoid.
 */
export async function addTags(
  cfg: ZendeskConfig,
  id: number,
  tags: string[]
): Promise<string[]> {
  const resp = await putTags(cfg, id, tags);
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(
      `Zendesk rejected adding tags to ticket ${id}: HTTP ${resp.status}${
        detail ? ` ${detail}` : ""
      }`
    );
  }
  const body = (await resp.json()) as { tags?: string[] };
  return body.tags ?? [];
}

/**
 * Best-effort: additively stamp `tag` on a ticket the MCP just touched.
 *
 * Never throws: the primary action already succeeded, so a tagging failure must
 * not turn a successful call into an error — failures are logged to stderr.
 */
export async function stampTag(
  cfg: ZendeskConfig,
  id: number,
  tag: string
): Promise<void> {
  try {
    const resp = await putTags(cfg, id, [tag]);
    if (!resp.ok) {
      console.error(
        `[zendesk-mcp] failed to stamp '${tag}' on ticket ${id}: HTTP ${resp.status}`
      );
    }
  } catch (err) {
    console.error(
      `[zendesk-mcp] failed to stamp '${tag}' on ticket ${id}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Merge `tag` into a caller-supplied tag list without duplicating it.
 *
 * Used by ticket creation, which can carry the tag inline in the create payload
 * — cheaper than a follow-up tags call and it avoids a second audit entry on a
 * brand-new ticket.
 */
export function appendTag(
  tags: string[] | undefined,
  tag: string
): string[] {
  const existing = tags ?? [];
  return existing.includes(tag) ? existing : [...existing, tag];
}
