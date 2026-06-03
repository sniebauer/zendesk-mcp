import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createZendeskClient, withZendeskError } from "../zendesk.js";

export const listViewTicketsInput = z.object({
  view_id: z
    .number()
    .int()
    .positive()
    .describe("Zendesk View ID (find it in the URL of the view in Zendesk)"),
});

export const incrementalTicketsInput = z.object({
  start_time: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Unix timestamp in seconds. Returns all tickets updated at or after this time."
    ),
});

export function registerReportingTools(server: McpServer) {
  server.tool(
    "zd_list_view_tickets",
    "List all tickets in a saved Zendesk View. Use this for view-based reports/dashboards. Note: this endpoint returns the View's default page size (no pagination control).",
    listViewTicketsInput.shape,
    async (raw) => {
      const { view_id } = listViewTicketsInput.parse(raw);
      const client = createZendeskClient();
      const result = await withZendeskError(() =>
        client.views.tickets(view_id)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "zd_incremental_tickets",
    "Zendesk incremental tickets export: returns tickets updated at or after start_time (Unix seconds). For bulk analytics. May return many records; pagination metadata is included.",
    incrementalTicketsInput.shape,
    async (raw) => {
      const { start_time } = incrementalTicketsInput.parse(raw);
      const client = createZendeskClient();
      // v5 idiom: use ticketexport.export(start_time) (replaces the
      // deprecated client.tickets.incremental / client.tickets.export).
      const { result } = await withZendeskError(() =>
        client.ticketexport.export(start_time)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
