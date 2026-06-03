import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createZendeskClient, withZendeskError } from "../zendesk.js";

const userId = z.number().int().positive().describe("Zendesk user ID");

export const getUserInput = z.object({ id: userId });

export const searchUsersInput = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Zendesk user-search query (e.g. 'email:foo@bar.com', 'name:Jane')"
    ),
});

export const createUserInput = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["end-user", "agent", "admin"]).optional(),
  organization_id: z.number().int().positive().optional(),
});

const updateUserBase = z.object({
  id: userId,
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(["end-user", "agent", "admin"]).optional(),
  organization_id: z.number().int().positive().optional(),
});

export const updateUserInput = updateUserBase.refine(
  (v) =>
    v.name !== undefined ||
    v.email !== undefined ||
    v.role !== undefined ||
    v.organization_id !== undefined,
  { message: "Must set at least one of: name, email, role, organization_id" }
);

export function registerUserTools(server: McpServer) {
  server.tool(
    "zd_get_user",
    "Fetch a single Zendesk user by ID, including identity fields and organization.",
    getUserInput.shape,
    async (raw) => {
      const { id } = getUserInput.parse(raw);
      const client = createZendeskClient();
      const { result } = await withZendeskError(() => client.users.show(id));
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "zd_search_users",
    "Search Zendesk users using Zendesk's user-search syntax (e.g. 'email:foo@bar.com', 'name:Jane').",
    searchUsersInput.shape,
    async (raw) => {
      const { query } = searchUsersInput.parse(raw);
      const client = createZendeskClient();
      // users.search returns an array directly, NOT a {response, result} wrapper.
      const results = await withZendeskError(() =>
        client.users.search({ query })
      );
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  server.tool(
    "zd_create_user",
    "Create a new Zendesk user. Required: name + email. Optional: role ('end-user'|'agent'|'admin'), organization_id.",
    createUserInput.shape,
    async (raw) => {
      const input = createUserInput.parse(raw);
      const client = createZendeskClient();
      const payload = { user: input };
      const { result } = await withZendeskError(() =>
        client.users.create(payload)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "zd_update_user",
    "Update fields on an existing Zendesk user. Must supply at least one mutable field (name, email, role, organization_id).",
    updateUserBase.shape,
    async (raw) => {
      const parsed = updateUserInput.parse(raw);
      const { id, ...fields } = parsed;
      const client = createZendeskClient();
      const { result } = await withZendeskError(() =>
        client.users.update(id, { user: fields })
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
