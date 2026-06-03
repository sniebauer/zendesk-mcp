import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTools } from "./tools/search.js";
import { registerTicketTools } from "./tools/tickets.js";
import { registerUserTools } from "./tools/users.js";
import { registerOrgTools } from "./tools/orgs.js";
import { registerReportingTools } from "./tools/reporting.js";
import { registerHelpCenterTools } from "./tools/help-center.js";
import { registerMacroTools } from "./tools/macros.js";
import { registerAttachmentTools } from "./tools/attachments.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "zendesk-mcp",
    version: "0.1.0",
  });

  registerSearchTools(server);
  registerTicketTools(server);
  registerUserTools(server);
  registerOrgTools(server);
  registerReportingTools(server);
  registerHelpCenterTools(server);
  registerMacroTools(server);
  registerAttachmentTools(server);

  return server;
}
