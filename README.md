# @sniebauer/zendesk-mcp

Local [MCP](https://modelcontextprotocol.io/) server that exposes Zendesk Support, Macros, attachments, and Help Center reads to Claude Desktop or Claude Code.

25 tools across Support API (search, tickets, users, organizations, macros, attachments, reporting) and the Zendesk Guide Help Center (search, articles, sections).

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

5. **Verify.** Start a new chat and check the tools/connector icon near the message box (or **Settings → Developer**) — `zendesk` should show as connected with 25 tools.

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

## Tools (25)

**Search / read**
- `zd_search` — generic Zendesk search (e.g. `type:ticket status:open`)
- `zd_get_ticket` — ticket + comments + `events` (full change history) + attachment metadata
- `zd_list_ticket_fields` — list ticket fields (system + custom) with ids, titles, types, and dropdown/multiselect options; use it to resolve a field name to the id needed by `zd_update_ticket`
- `zd_get_user`, `zd_get_organization`

**Write tickets**
- `zd_create_ticket`, `zd_update_ticket`, `zd_add_ticket_comment`
- `zd_add_ticket_tags` — add tags **additively**, leaving the ticket's existing tags in place
- `zd_update_ticket` writes `status`, `priority`, `assignee_id`, `group_id`, `type`, `problem_id`, `ticket_form_id`, `tags`, and `custom_fields`
- `zd_update_ticket` supports `custom_fields: [{id, value}]` for direct custom-field updates (preferred over tag-based workarounds; use `null` to clear a field). Use `zd_list_ticket_fields` to look up a field's id by name.

### Problems and incidents

`zd_update_ticket` can write the fields that link tickets together, which is what an escalation flow needs:

| Field | Use |
| --- | --- |
| `type` | `question` / `incident` / `problem` / `task`. Set `problem` to turn a ticket into a Problem other tickets hang off. |
| `problem_id` | The Problem ticket an incident belongs to. Pass `null` to detach. |
| `group_id` | Reassign the ticket to a group. |
| `ticket_form_id` | Switch the ticket's form. |

Zendesk only accepts `problem_id` on an incident, so set both in one call when converting a ticket:

```json
{ "id": 275807, "type": "incident", "problem_id": 274924 }
```

Passing `problem_id` alongside any other `type` is rejected up front rather than coming back as an opaque `RecordInvalid`. Changing `ticket_form_id` changes which fields are required — set any newly required field in the same call, or Zendesk will reject the update.

### Adding tags without losing the existing ones

`zd_update_ticket`'s `tags` **replaces** the ticket's entire tag set: anything not in the list is removed. That is Zendesk's behavior, and it is an easy way to silently wipe a ticket's tags. Use `zd_add_ticket_tags` instead when you mean "add":

```json
{ "id": 275807, "tags": ["escalated", "val_filed"] }
```

It goes through Zendesk's additive endpoint (`PUT /tickets/{id}/tags.json`) and returns the ticket's resulting tag list. Unlike the automatic usage tagging below, a failure here is surfaced as an error — a tag call that quietly adds nothing is the failure mode this exists to prevent.

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

## Ticket history (`zd_get_ticket`)

`zd_get_ticket` returns three things: the `ticket` fields, all `comments`, and `events` — a chronological log of everything else that happened, derived from Zendesk's [Ticket Audits API](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_audits/). Comments alone only ever show what people *said*; `events` shows what was *done*: status, priority, assignee and group changes, tag and CC changes, macros applied, and custom field edits — each with who did it and which trigger or automation drove it.

```json
{
  "at": "2026-08-10T22:24:40Z",
  "actor": "Kevin Sooter",
  "via": "web",
  "audit_id": 42621164872727,
  "kind": "change",
  "field": "status",
  "from": "new",
  "to": "open"
}
```

`via` names the responsible rule when one fired (`"trigger: Assign new tickets created without a Group selected to the Support group"`), which is usually the answer to "why did this ticket move?". Custom fields resolve to their title plus a `field_id` you can feed straight back to `zd_update_ticket`'s `custom_fields`.

**Raw audits are summarized, not passed through.** The unfiltered payload is dominated by noise — on one real 86-audit ticket it was 657KB, mostly rendered HTML email bodies from `Notification`/`FollowerNotification` events and whole-list echoes on every `tags` change. The summary drops notification and webhook events, diffs list-valued fields to just what changed, and strips comment bodies (already returned in full under `comments`, and cross-referenced by `comment_id`). That ticket's history comes back as 69KB instead of 657KB.

Two flags control this:

| Flag | Default | Effect |
| --- | --- | --- |
| `include_events` | `true` | The summarized history. Set `false` to skip the audits call entirely — output and latency then match the pre-audits behavior exactly. |
| `include_raw_audits` | `false` | Adds the unfiltered `audits` array as Zendesk returns it. Large; use only when you need notification bodies or an event type the summary drops. |

Unrecognized event types are passed through as bare `{at, actor, via, kind}` stubs rather than dropped, so a new Zendesk event type shows up as a known unknown instead of silently vanishing.

If the audits call itself fails, the ticket and its comments are still returned and the failure is reported as `events_error` — history is an enrichment, so losing it never costs you the read, and a missing history is never mistaken for an uneventful ticket.

## Usage tagging

Tickets this server touches are tagged automatically, so adoption can be measured from Zendesk itself:

| Tag | Applied by |
| --- | --- |
| `ai_reviewed` | `zd_get_ticket`, `zd_apply_macro_to_ticket` |
| `ai_actioned` | `zd_update_ticket`, `zd_add_ticket_comment`, `zd_add_ticket_tags`, `zd_create_ticket` |

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
