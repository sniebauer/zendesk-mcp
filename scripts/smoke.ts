import "dotenv/config";
import { createZendeskClient, withZendeskError } from "../src/zendesk.js";
import { searchArticles, getArticle, listSections } from "../src/help-center.js";

async function main() {
  console.log("=== Support API smoke ===");
  const client = createZendeskClient();

  console.log("1. zd_search: type:ticket status:open (limit 3) ...");
  const { result } = await withZendeskError(() => client.search.query("type:ticket status:open"));
  const tickets = result as { results: Array<{ id: number; subject: string }> };
  console.log(`  -> got ${tickets.results.length} results`);
  for (const t of tickets.results.slice(0, 3)) console.log(`     #${t.id}: ${t.subject}`);

  console.log("\n=== Help Center smoke ===");

  console.log("2. zd_hc_search: 'session replay' ...");
  const hits = await searchArticles("session replay", "en-us");
  console.log(`  -> got ${hits.length} hits`);
  for (const h of hits.slice(0, 3)) console.log(`     ${h.id}: ${h.title}`);

  if (hits[0]) {
    console.log(`3. zd_hc_get_article: ${hits[0].id} ...`);
    const article = await getArticle(hits[0].id, "en-us");
    console.log(`  -> title: ${article.title}`);
    console.log(`  -> markdown length: ${article.body_markdown.length} chars`);
  }

  console.log("4. zd_hc_list_sections ...");
  const sections = await listSections("en-us");
  console.log(`  -> ${sections.length} sections`);

  console.log("\nSmoke test passed.");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
