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
         "args": ["-y", "--prefer-online", "@sniebauer/zendesk-mcp@latest"]
       }
     }
   }
   ```

   (If you already have other `mcpServers`, merge the `zendesk` entry alongside them.)

   `--prefer-online` makes npm check the registry on every launch and `@latest` pins to the newest published tag. Together they keep you current automatically — without both, npx can serve a cached copy and leave you on an old version indefinitely.

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

Run the credential setup from step 3 above, then register the server:

```bash
claude mcp add --transport stdio zendesk --scope user -- npx -y --prefer-online @sniebauer/zendesk-mcp@latest
```

`--scope user` makes it available in every directory rather than only the one you ran the command in. Claude Code reloads MCP servers on session restart rather than full app restart; run `/mcp` to confirm `zendesk` is connected.

### Updating credentials

Re-run `npx -y @sniebauer/zendesk-mcp setup` anytime. The CLI offers `(unchanged)` defaults for fields you've already configured.

## Updating to the latest version

If your config still uses the older bare `npx -y @sniebauer/zendesk-mcp` form, npx may keep serving a cached build and never pick up new releases. Switch to the auto-updating form once and you'll stay current from then on.

### Claude Desktop

1. **Open the config file.** In Claude Desktop: **Settings** → **Developer** (left sidebar) → **Edit Config**. That opens the folder containing `claude_desktop_config.json` — open that file in any text editor.
   - If "Edit Config" isn't there, the file lives at `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

2. **Find the `zendesk` entry** under `mcpServers`. It probably looks like this:

   ```json
   "zendesk": {
     "command": "npx",
     "args": ["-y", "@sniebauer/zendesk-mcp"]
   }
   ```

3. **Change only the `args` line** so it reads:

   ```json
   "zendesk": {
     "command": "npx",
     "args": ["-y", "--prefer-online", "@sniebauer/zendesk-mcp@latest"]
   }
   ```

   That's the whole change — adding `--prefer-online` and `@latest`. Leave other servers alone and keep the JSON valid (matching quotes, commas, braces).

4. **Fully quit and reopen Claude Desktop** — not just close the window (macOS: `⌘Q`, or Claude menu → Quit).

5. **Verify.** Start a new chat and check the tools/connector icon near the message box (or **Settings → Developer**) — `zendesk` should show as connected with 24 tools.

### Claude Code

```bash
claude mcp remove zendesk
claude mcp add --transport stdio zendesk --scope user -- npx -y --prefer-online @sniebauer/zendesk-mcp@latest
```

Restart Claude Code, then run `/mcp` to confirm `zendesk` is connected.

### Troubleshooting

- **`zendesk` errors or won't start.** Almost always means the app can't find `npx`. Install Node.js (LTS, from [nodejs.org](https://nodejs.org)), then fully restart the app.
- **It connects but the new tools are missing.** The npx cache is stale — run `npm cache clean --force`, then fully quit and reopen.

Updating does not touch authentication; your existing credentials keep working.

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

## Usage tagging

Tickets this server touches are tagged automatically, so adoption can be measured from Zendesk itself:

| Tag | Applied by |
| --- | --- |
| `ai_reviewed` | `zd_get_ticket`, `zd_apply_macro_to_ticket` |
| `ai_actioned` | `zd_update_ticket`, `zd_add_ticket_comment`, `zd_create_ticket` |

Count usage with a Zendesk search: `tags:ai_actioned`, or `tags:ai_reviewed -tags:ai_actioned` for tickets that were only read. A ticket that was written to has usually been read first, so it will normally carry both tags.

Tags are added through Zendesk's additive tags endpoint (`PUT /tickets/{id}/tags.json`), so existing tags are preserved — never replaced. Tagging is best-effort: a failure is logged to stderr and never turns a successful tool call into an error.

**Tagging is a write, including on reads.** `zd_get_ticket` and `zd_apply_macro_to_ticket` are otherwise read-only, but stamping `ai_reviewed` updates the ticket — bumping `updated_at`, adding an audit entry, and potentially firing triggers or automations and affecting SLA/activity reporting. Bulk tools (`zd_search`, `zd_list_view_tickets`, `zd_incremental_tickets`) deliberately do **not** tag, since they would mass-write to every result.

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
