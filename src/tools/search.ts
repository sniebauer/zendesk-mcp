import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createZendeskClient, withZendeskError } from "../zendesk.js";

export const searchInput = z.object({
  query: z.string().min(1).describe("Zendesk search query, e.g. 'type:ticket status:open requester:foo@bar.com'"),
});

export function registerSearchTools(server: McpServer) {
  server.tool(
    "zd_search",
    "Run a Zendesk search query against the Support API. Use the standard Zendesk search syntax (e.g. 'type:ticket status:open', 'type:user email:foo@bar.com'). Returns one page of search results.",
    searchInput.shape,
    async (raw) => {
      const { query } = searchInput.parse(raw);
      const client = createZendeskClient();
      const { result } = await withZendeskError(() => client.search.query(query));
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
