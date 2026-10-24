---
name: notion-copy
description: Move or copy a Jobadabra job search from one Notion workspace (or set of databases) into another, e.g. real data into a fresh Desktop App workspace, or a copy for tests. Use whenever the owner asks to migrate, move, copy, clone or switch Jobadabra Notion data between workspaces, or to point the app/terminal/Telegram bot at another workspace.
---

# Copy a Jobadabra workspace (tools/notion_copy.py)

Copies every database row (all fields, the page body such as kits and cover letters, the links between
databases) plus the Profile, Standard answers and Form knowledge pages; writes ⚙️ Search settings from a
config folder. Re-running is safe: the source → target page map is in `data/notion-copy/<key>.json`, so rows
are updated, never duplicated. Not copied: people fields, formulas/rollups (Notion recomputes them), files
uploaded to Notion (expiring links), views.

## Before you start
- **Which workspace is which:** see the owner's map (memory `reference-notion-workspaces`); never write to the
  real job-search data unless that's the target the owner named.
- **One connection per Jobadabra page.** A Notion connection sees only the pages shared with it, and the app
  and this tool find databases *by title*. A workspace can hold several copies with the same titles (the real
  databases, the public template's source, a new copy), so the target's connection must see only the target
  page, and the source is named explicitly with `--from-ids <.env>` when it isn't alone.
- Tokens live in the Keychain (`job-pilotto.notion.token` = the terminal's; store others as
  `job-pilotto.notion-<name>.token` with `security add-generic-password -U -a job-pilotto -s <name> -w '<token>'`).
  Never print them.

## New workspace for the Desktop App, filled with existing data
1. **Fresh app profile:** quit the app; rename `~/Library/Application Support/Job Pilotto` to
   `Job Pilotto (<old workspace>)` (kept: start it again with `JOB_PILOTTO_USER_DATA=<that folder> npm start`).
2. **Setup wizard from scratch** (owner, in the app): Notion step → duplicate the template into the target
   Notion → new connection that can see only the new **Jobadabra** page → paste its token. The app adds any
   missing columns/pages from `config/notion_schema.json`. Finish the wizard (a first search may run; its rows
   are replaced below).
3. Owner gives you that same token → Keychain `job-pilotto.notion-app.token`.
   **Connected with "Connect with Notion"** (the app keeps that token encrypted, nobody has it): the owner adds the
   terminal's connection to the new page too (page ⋯ → Connections), then use `--to job-pilotto.notion.token`
   with `--to-ids "~/Library/Application Support/Job Pilotto/settings.json"` (and `settings --ids` the same),
   so the one token writes only into the app's workspace. The tool refuses when source and target are the same.
4. **Check, then copy:**
   ```
   python3 tools/notion_copy.py ids  --token job-pilotto.notion-app.token          # target found, only one copy?
   python3 tools/notion_copy.py copy --from job-pilotto.notion.token --from-ids ~/jobadabra/.env \
       --to job-pilotto.notion-app.token --dry-run                                  # row counts per database
   python3 tools/notion_copy.py copy --from job-pilotto.notion.token --from-ids ~/jobadabra/.env \
       --to job-pilotto.notion-app.token --replace                                  # the copy
   python3 tools/notion_copy.py settings --token job-pilotto.notion-app.token --config ~/jobadabra/config
   ```
   `--replace` sends the target's own rows (e.g. the wizard's first search) to Notion's trash (restorable 30 days)
   and replaces its Profile / Standard answers with the source's.
5. **Verify:** compare the dry-run counts with the target (Notion search or `ids` + a query), open a few
   Applications rows (kit body, Events linked), and the app's Jobs list (statuses come from Stage).

## Switching everything else to the new workspace (only when the owner asks)
- Terminal: `python3 tools/notion_copy.py ids --token job-pilotto.notion-app.token --env` → replace the
  `NOTION_*` lines of `~/jobadabra/.env`; keep the old token as `job-pilotto.notion-original.token` and store the
  new one as `job-pilotto.notion.token`.
- Telegram bot: `worker/wrangler.toml` `NOTION_*` vars → new IDs, `npx wrangler@4 secret put NOTION_TOKEN`, deploy.
- GitHub: the engine repo's `NOTION_TOKEN` secret (fill-failure intake) and, if cloud runs are on, the private
  repo's secret and `NOTION_*` variables (the app's Always on sets these itself).
- The old databases stay as an archive; say so in your report to the owner.
