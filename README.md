# @sniebauer/zendesk-mcp

Local [MCP](https://modelcontextprotocol.io/) server that exposes Zendesk Support, Macros, attachments, and Help Center reads to Claude Desktop or Claude Code.

24 tools across Support API (search, tickets, users, organizations, macros, attachments, reporting) and the Zendesk Guide Help Center (search, articles, sections).

## Install

### Claude Desktop (Enterprise, Team, Pro, Free)

1. Open your Claude Desktop config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

   Create the file if it doesn't exist.

2. Add a `zendesk` entry under `mcpServers`:

   ```json
   {
     "mcpServers": {
       "zendesk": {
         "command": "npx",
         "args": ["-y", "@sniebauer/zendesk-mcp"]
       }
     }
   }
   ```

   (If you already have other `mcpServers`, merge the `zendesk` entry alongside them.)

3. Capture your Zendesk credentials. Run this once from any terminal:

   ```bash
   npx -y @sniebauer/zendesk-mcp setup
   ```

   You'll be prompted for:
   - **Zendesk subdomain** — the part before `.zendesk.com` (e.g. if your help URL is `acme.zendesk.com`, enter `acme`).
   - **Your Zendesk email** — the address tied to your Zendesk account.
   - **API token** — generate one at `https://<your-subdomain>.zendesk.com/admin/apps-integrations/apis/api-tokens`.

   Credentials are written to `~/.config/zendesk-mcp/config.json` with mode `0600` (readable only by you).

4. Restart Claude Desktop. The `zendesk` server should connect on launch and the new tools appear under it.

### Claude Code

Same as above, but the config file is `~/.claude.json` (and the equivalent project-scoped path), and Claude Code reloads MCP servers on session restart rather than full app restart.

### Updating credentials

Re-run `npx -y @sniebauer/zendesk-mcp setup` anytime. The CLI offers `(unchanged)` defaults for fields you've already configured.

## Tools (24)

**Search / read**
- `zd_search` — generic Zendesk search (e.g. `type:ticket status:open`)
- `zd_get_ticket` — ticket + comments + attachment metadata
- `zd_list_ticket_fields` — list ticket fields (system + custom) with ids, titles, types, and dropdown/multiselect options; use it to resolve a field name to the id needed by `zd_update_ticket`
- `zd_get_user`, `zd_get_organization`

**Write tickets**
- `zd_create_ticket`, `zd_update_ticket`, `zd_add_ticket_comment`
- `zd_update_ticket` supports `custom_fields: [{id, value}]` for direct custom-field updates (preferred over tag-based workarounds; use `null` to clear a field). Use `zd_list_ticket_fields` to look up a field's id by name.

**Reporting**
- `zd_list_view_tickets`, `zd_incremental_tickets`

**Users / organizations**
- `zd_search_users`, `zd_create_user`, `zd_update_user`
- `zd_search_organizations`, `zd_create_organization`, `zd_update_organization`

**Macros**
- `zd_list_macros`, `zd_search_macros`, `zd_get_macro`
- `zd_apply_macro_to_ticket` — preview of macro effect on a ticket (does not persist)

**Attachments**
- `zd_get_ticket_attachment` — fetch a comment attachment by `content_url`. Image content-types return a native MCP image block (Claude can see the image directly); other types return base64 + metadata.

**Help Center (Guide)**
- `zd_hc_search`, `zd_hc_get_article`, `zd_hc_list_sections`

## Verify

After install, in Claude Desktop or Claude Code, ask:

> Search Zendesk for open tickets assigned to me

If you see results, the integration is working.

For developers, after cloning the repo:

```bash
npm install
npm test          # unit tests (schemas + error wrapper + HTML→Markdown)
npm run smoke     # end-to-end against the real API (requires credentials)
```

## Caveats

- **Credentials precedence.** `ZENDESK_SUBDOMAIN` / `ZENDESK_EMAIL` / `ZENDESK_API_TOKEN` env vars override the config file. Useful for CI / multi-account testing.
- **`zd_apply_macro_to_ticket` is a preview.** Zendesk's apply endpoint returns the would-be ticket state; nothing is persisted until you call `zd_update_ticket` / `zd_add_ticket_comment`.
- **`zd_get_ticket_attachment` only fetches from the configured Zendesk host.** The host is checked exactly against `<subdomain>.zendesk.com`; URLs pointing elsewhere are refused so credentials don't leak to a different host.
- **`zd_list_view_tickets` has no pagination.** `node-zendesk` v5 doesn't expose a page arg.
- **429 retries.** `withZendeskError` retries once on HTTP 429 (honoring `Retry-After`). Safe for reads. For mutations the duplicate-write risk is low (Zendesk fires 429 before processing) but non-zero.
- **Smoke test is reads-only.** Doesn't exercise mutation paths.

## License

MIT — see `LICENSE`.
