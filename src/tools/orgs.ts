import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createZendeskClient, withZendeskError } from "../zendesk.js";

const orgId = z.number().int().positive().describe("Zendesk organization ID");

export const getOrgInput = z.object({ id: orgId });

export const searchOrgsInput = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      "Prefix to match against organization names (Zendesk autocomplete is prefix-based)"
    ),
});

export const createOrgInput = z.object({
  name: z.string().min(1),
  domain_names: z.array(z.string()).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const updateOrgBase = z.object({
  id: orgId,
  name: z.string().min(1).optional(),
  domain_names: z.array(z.string()).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const updateOrgInput = updateOrgBase.refine(
  (v) =>
    v.name !== undefined ||
    v.domain_names !== undefined ||
    v.notes !== undefined ||
    v.tags !== undefined,
  { message: "Must set at least one of: name, domain_names, notes, tags" }
);

export function registerOrgTools(server: McpServer) {
  server.tool(
    "zd_get_organization",
    "Fetch a single Zendesk organization by ID, including domain_names, notes, and tags.",
    getOrgInput.shape,
    async (raw) => {
      const { id } = getOrgInput.parse(raw);
      const client = createZendeskClient();
      const { result } = await withZendeskError(() =>
        client.organizations.show(id)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "zd_search_organizations",
    "Find Zendesk organizations by name (uses the autocomplete endpoint, matches names that start with the query).",
    searchOrgsInput.shape,
    async (raw) => {
      const { name } = searchOrgsInput.parse(raw);
      const client = createZendeskClient();
      // organizations.autocomplete returns an array directly, NOT a {response, result} wrapper.
      const results = await withZendeskError(() =>
        client.organizations.autocomplete({ name })
      );
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  server.tool(
    "zd_create_organization",
    "Create a new Zendesk organization. Required: name. Optional: domain_names, notes, tags.",
    createOrgInput.shape,
    async (raw) => {
      const input = createOrgInput.parse(raw);
      const client = createZendeskClient();
      const payload = { organization: input };
      const { result } = await withZendeskError(() =>
        client.organizations.create(payload)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "zd_update_organization",
    "Update fields on an existing Zendesk organization. Must supply at least one mutable field (name, domain_names, notes, tags).",
    updateOrgBase.shape,
    async (raw) => {
      const parsed = updateOrgInput.parse(raw);
      const { id, ...fields } = parsed;
      const client = createZendeskClient();
      const { result } = await withZendeskError(() =>
        client.organizations.update(id, { organization: fields })
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
