# Data ownership: one copy of everything, behind the store interface

Read before adding any stored field, file, setting or table. Linked from CLAUDE.md. Why each rule exists: [why.md](why.md#data).

## The one rule (owner, 9 Oct 2026)
- The user's data lives behind **one store interface**, `src/stores/` (`open_stores()`). Adapters: `sqlite` (the default for new users),
  `notion` (the Notion code behind the interface), more later. Every adapter passes `tests/store_contract.py`.
- **One copy.** The active store is a setting; a user moves to Notion only when they choose ("Move my data to Notion": one-way, never a sync).
  **Always on needs Notion.**
- **New stored data goes through the interface and every adapter**, never straight to Notion.
- Spec and owners: `docs/superpowers/specs/2026-10-09-store-adapters.md`.
- **A reader of an old shape that lives in stored data (Notion, config, store) is removed only once that data is migrated**, never because every install is past a version: the data stays old after the app updates (17 Oct 2026: telemetry showed 3 active installs and still no reader was safe to drop).
- The sections below are the **Notion adapter's** rules (what "store" means when the active store is Notion). They are not a second data model.

## Where a piece of data lives
- **The active store** (Notion when the user is on Notion): anything the user reads, edits, or would want on another device: statuses, run
  results, profile/answers, open questions, contact details, learned form notes, search settings, transcripts. The code reads it from the store;
  it never keeps a second editable copy.
- **The Mac / runner**: only keys (encrypted), large files and caches that can be deleted and rebuilt from the store or a crawl (`jobs.sqlite`,
  `config/*.json` as the cache of ⚙️ Search settings, `runs.json`). A cache is refreshed *from* the store; writes go to the store first, and if it
  refuses, nothing changes locally and the user is told.
- No new "local fallback" copies of user data, and **no cache-only fields**: if a screen or command needs a field, it is a store column.

## On Notion (the Notion adapter)
- **A reset never touches Notion; a fresh profile always starts a new workspace** (owner, 16 Oct 2026): a reset clears this Mac only, and a Notion connect
  on a profile with no saved workspace never discovers or reuses an existing Jobadabra page: it builds a new one in an empty shared page and leaves the
  old one as it is (`connectWorkspace(..., {fresh})`; guard `desktop/test/notion-fresh.test.js`).
- A new database, column or page is added to Notion *and* to `config/notion_schema.json` (`tools/notion_schema.py snapshot`, or edit it), so every
  workspace can be rebuilt and repaired (`desktop/lib/schema.js`, at connect and start-up). Existing rows get the value backfilled.
  `tests/test_notion_schema_coverage.py` fails when the code uses a column the schema lacks, `tests/test_notion_docs_coverage.py` when a schema
  column isn't in `docs/notion-schema.md`: after adding one, run `python3 tools/notion_schema.py docs` and write its Notes.
  (`config/notion_template.json` lists only the columns checked at connect; don't add optional ones there.)
- Files: the CV (every version, Profile → "📎 CV") and tailored CVs (Applications → "Tailored CV") are uploaded too (`desktop/lib/files.js`,
  ≤ 5 MB on Notion's free plan). What's too big (call recordings) is only on the Mac and in the weekly backup (`desktop/lib/backup.js`: iCloud
  Drive or Documents, last 4, no keys).
- **"Trying" without a store connected** (3 Oct 2026, `docs/superpowers/specs/2026-10-03-notion-later.md`): tracking actions answer
  `notionGate.needs(reason)` (`desktop/lib/notion-gate.js`) and the window opens the connect prompt (`renderer/pages/notion-connect.js`). The store
  interface removes these gates as its pieces land; until a gate is gone, it still applies. `lib/migrate.js` moves `profile.md`, `answers.md` and
  the search config into Notion at connect (delete the local copy only after Notion confirmed it has it, with a test).
- **Job Matches = what a search found and scored; Applications = every job you pursue** (found, or added by hand / from a recruiter, with its fit
  columns): added jobs and leads get no Job Matches row (30 Sep 2026).
- The desktop Jobs list is built from the store (Job Matches + Applications, `Tracker.notion_jobs`); the cache only adds jobs a search couldn't
  write yet (marked).

## Runs
- Every run (search, Gmail check, kit, review, insight, report, find employers) leaves a row in ⏱️ Search runs, wherever it ran (the Mac, the
  user's GitHub repo, a Telegram button): opened at the start (Status Running, `cron_runs.begin`, a ⏳ progress line in Summary), completed with its
  report, its **Result** (the message it sent or showed) and a **Technical log** toggle. That row is the one run history: Recent activity
  (`desktop/lib/run-history.js`) and Telegram /status read it; `runs.json` is only a cache.
- Background jobs run in exactly one place: the user's GitHub repo when **Always on** is on, else this Mac. Only what needs the Mac
  (recording/transcribing, Apply with Claude, form filling, Google sign-in) or an instant answer runs locally. Always on never moves data.

## The employer index is product data, not user data
The central scout (private repo `jobadabra-lab`) publishes feeds + quality + last verified to our website (`GET /api/index`,
`api/employers.js`; install token, capped per install a day, `shared/guard.js`; `INDEX_GATE=soft` in `workers/www/wrangler.toml` would reopen it; all in the private repo `jobadabra-web`).
Every run downloads it (`src/employer_index.py`, cache `data/employer_index.json`, about hourly; the scout publishes every 6 h) and merges it with
the starter `config/sources.json`; a run crawls only feeds matching the user's `search.json` (`employer_index.relevant`). It never lives in a
user's store, and nothing about a user is sent to get it.

## Wrong data
Fix the root cause in code first (with a regression test), push, then repair the owner's rows by hand through the Notion MCP (read them, change
only what is wrong, say what changed). Never one-off repair code for one edge case. Product code every user needs is fine (a new column + its
backfill, runtime guards).

## Big features
A short spec in `docs/superpowers/specs/` with a "Data ownership" section (store vs cache) before code; link it from the Notion Decision Log when it records an owner decision.
