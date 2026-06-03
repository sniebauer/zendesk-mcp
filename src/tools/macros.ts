import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createZendeskClient, withZendeskError } from "../zendesk.js";

const macroId = z.number().int().positive().describe("Zendesk macro ID");
const ticketId = z.number().int().positive().describe("Zendesk ticket ID");

export const listMacrosInput = z.object({});

export const searchMacrosInput = z.object({
  query: z
    .string()
    .min(1)
    .describe("Substring to match against macro titles/descriptions"),
});

export const getMacroInput = z.object({ id: macroId });

export const applyMacroToTicketInput = z.object({
  ticket_id: ticketId,
  macro_id: macroId,
});

export function registerMacroTools(server: McpServer) {
  server.tool(
    "zd_list_macros",
    "List all available Zendesk Macros (saved ticket-action templates). Returns each macro's id, title, description, and whether it's active.",
    listMacrosInput.shape,
    async (raw) => {
      listMacrosInput.parse(raw);
      const client = createZendeskClient();
      // node-zendesk v5: client.macros.list() returns Promise<any[]>
      const macros = await withZendeskError(() => client.macros.list());
      return {
        content: [{ type: "text", text: JSON.stringify(macros, null, 2) }],
      };
    }
  );

  server.tool(
    "zd_search_macros",
    "Search Zendesk Macros by title/description substring.",
    searchMacrosInput.shape,
    async (raw) => {
      const { query } = searchMacrosInput.parse(raw);
      const client = createZendeskClient();
      // node-zendesk v5: client.macros.search(query) returns {response, result: Array<object>}
      const { result } = await withZendeskError(() =>
        client.macros.search(query)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "zd_get_macro",
    "Fetch a single Zendesk Macro by ID, including all of its actions.",
    getMacroInput.shape,
    async (raw) => {
      const { id } = getMacroInput.parse(raw);
      const client = createZendeskClient();
      // node-zendesk v5: client.macros.show(id) returns {response, result}
      const { result } = await withZendeskError(() => client.macros.show(id));
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "zd_apply_macro_to_ticket",
    "Preview the effect of applying a Macro to a specific ticket. Returns the resulting ticket+comment changes WITHOUT persisting — call zd_update_ticket / zd_add_ticket_comment to actually apply the changes.",
    applyMacroToTicketInput.shape,
    async (raw) => {
      const { ticket_id, macro_id } = applyMacroToTicketInput.parse(raw);
      const client = createZendeskClient();
      // node-zendesk v5: client.macros.applyTicket(ticketID, macroID) hits
      // GET /api/v2/tickets/{ticket_id}/macros/{macro_id}/apply.json
      // and returns the macro "replica" — the would-be ticket+comment changes
      // without persisting them. Returns {response, result}.
      const { result } = await withZendeskError(() =>
        client.macros.applyTicket(ticket_id, macro_id)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
