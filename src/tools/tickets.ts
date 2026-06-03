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

const updateTicketBase = z.object({
  id: ticketId,
  status: ticketStatus.optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assignee_id: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional(),
});

export const updateTicketInput = updateTicketBase.refine(
  (v) =>
    v.status !== undefined ||
    v.priority !== undefined ||
    v.assignee_id !== undefined ||
    v.tags !== undefined,
  { message: "Must set at least one of: status, priority, assignee_id, tags" }
);

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
    "Update fields on an existing Zendesk ticket. Must supply at least one of: status, priority, assignee_id, tags. Use zd_add_ticket_comment to add a comment.",
    updateTicketBase.shape,
    async (raw) => {
      const { id, ...fields } = updateTicketInput.parse(raw);
      const client = createZendeskClient();
      const { result } = await withZendeskError(() =>
        client.tickets.update(id, { ticket: fields })
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
