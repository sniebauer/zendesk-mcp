import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchArticles, getArticle, listSections } from "../help-center.js";

const locale = z.string().min(2).default("en-us").describe("Help Center locale, e.g. 'en-us'. Defaults to en-us.");

export const hcSearchInput = z.object({
  query: z.string().min(1).describe("Search query for Zendesk Help Center articles"),
  locale,
});

export const hcGetArticleInput = z.object({
  id: z.number().int().positive().describe("Help Center article ID"),
  locale,
});

export const hcListSectionsInput = z.object({ locale });

export function registerHelpCenterTools(server: McpServer) {
  server.tool(
    "zd_hc_search",
    "Full-text search across published Zendesk Help Center articles. Returns up to 25 hits with id, title, URL, and snippet. Use zd_hc_get_article to fetch full article body.",
    hcSearchInput.shape,
    async (raw) => {
      const { query, locale } = hcSearchInput.parse(raw);
      const results = await searchArticles(query, locale);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );

  server.tool(
    "zd_hc_get_article",
    "Fetch a single Zendesk Help Center article by ID. Returns title, URL, section, updated_at, body_html and body_markdown. Use body_markdown for readable text.",
    hcGetArticleInput.shape,
    async (raw) => {
      const { id, locale } = hcGetArticleInput.parse(raw);
      const article = await getArticle(id, locale);
      return { content: [{ type: "text", text: JSON.stringify(article, null, 2) }] };
    }
  );

  server.tool(
    "zd_hc_list_sections",
    "List Zendesk Help Center sections (use to discover the structure of the docs when search misses).",
    hcListSectionsInput.shape,
    async (raw) => {
      const { locale } = hcListSectionsInput.parse(raw);
      const sections = await listSections(locale);
      return { content: [{ type: "text", text: JSON.stringify(sections, null, 2) }] };
    }
  );
}
