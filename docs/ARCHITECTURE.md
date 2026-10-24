# Jobadabra — architecture

Read this once at the start of a session. Then find the file the task names with `node desktop/scripts/codemap.mjs <words>`. Workflow detail, only if the task touches one: `docs/HOW-IT-RUNS.md`.

Jobadabra is a personal job-search system: it finds jobs, scores them, tracks them in Notion, and can fill application forms. It never clicks Submit.

The public repo at `~/jobadabra` is the engine plus the Mac/Windows app. A user's private GitHub repo only holds schedules and secrets, and calls this engine. Prompts and the product brain live in the private sibling `~/jobadabra-lab`.

## How a job moves

```text
sources → crawl → SQLite cache → AI → Notion + Telegram → you submit → learn
```

1. **Discover.** Employer feeds (Greenhouse, Lever, Ashby, Workable, and others) plus jobs.ch and TechTree. A shared employer index is checked about hourly (`GET /api/index`, a 304 when unchanged; the central scout publishes every 6 h); a run crawls only feeds that match the user's places. LinkedIn, Glassdoor, levels.fyi, and Reddit are never scraped.
2. **Cache.** `data/jobs.sqlite` remembers what was already seen. It is a cache, not the record.
3. **Read and rank.** Stage 1 (Haiku) extracts facts from the posting. Stage 2 (Sonnet) scores fit against the Notion profile. Top matches get an application kit (cover letter and form answers).
4. **Deliver.** A ranked Telegram digest, plus rows in Notion. Every run writes a row in Search runs.
   Until Notion is connected the desktop app only *tries* (search, scores, Jobs list, Strategy); tracking asks to connect (`desktop/lib/notion-gate.js`, spec `docs/superpowers/specs/2026-10-03-notion-later.md`).
5. **Act, locally.** The desktop app and the Chrome extension fill the form. The owner reviews and submits. How an application starts, who fills, and what is still open: [docs/apply-flow.md](apply-flow.md).
6. **Learn.** Read-only Gmail and Calendar update stages. Interview recordings are transcribed on the machine. A daily insight and a Monday report go back to Telegram.

The core crawl and printed digest need no accounts. Everything else turns on when its keys exist, and `JOB_PILOTTO_DISABLE` can switch a feature off. The registry is `src/features.py`.

## Five runtimes, one engine

| Piece | Path | Role |
|---|---|---|
| Python engine | `src/` | The pipeline. Entry: `python -m src <check\|scout\|discover\|feeds\|enrich\|doctor>`. `src/daily.py` orchestrates a jobs check (`daily` is the old name). |
| Desktop app | `desktop/` | Electron cockpit (v0.5). `start.js` → `main.js`. The window is one module per page under `desktop/renderer/pages/`. `desktop/lib/pipeline.js` shells out to the same Python engine. |
| Chrome extension | `extension/` | Fills a form from the kit. Talks to the app on `127.0.0.1` (`desktop/lib/server.js`). Never submits. |
| Website worker | private repo `jobadabra-web` (`site/` there) | One Cloudflare worker: the site, Notion sign-in, the employer index, telemetry, license/trial, fill-failure intake. Its routes the app calls are listed in `docs/site-routes.json`; see [docs/rules/private-site.md](rules/private-site.md). |
| Telegram bot | `worker/` | Commands and buttons. The app long-polls it locally. "Always on" uploads a bundle to the user's own Cloudflare account so buttons work while the Mac is off. |

`desktop/lib/github.js` is the "Always on" path. The user creates `<user>/jobadabra-personal-always-on` (made before 24 Oct 2026: `job-pilotto-private`) from a public starter. That repo's workflows (`templates/github-actions/`, scheduled every 4 hours for jobs, optional scout, mail three times a day) call the reusable workflows in this repo: `daily.yml`, `scout.yml`, `mail.yml`, by the name GitHub gives this repo now (`lib/engine-repo.js`: a renamed repo's `uses:` is not redirected). Those workflows have no schedule of their own, so the public repo never runs on anyone's data.

**What lives on the user's side, and how it stays in step** (8 Oct 2026). At every app start: the repo's workflow files are rewritten,
pinned to the app's own release (`desktop-v<version>`); our retired ones (first line `# Jobadabra`) are deleted, the user's own kept;
secrets and variables (models included) are sent again when their fingerprint changed (`github.js` `updateRepo`); the Telegram Worker is
redeployed when its code or settings changed (`telegram-cloud.js` `refresh`). Model IDs are data: `JOB_PILOTTO_SMALL_MODEL` and the stage
variables (`src/ai/models.py`), so a new model needs no engine release. Not synced: a secret removed on the Mac stays in the repo
(a failed Keychain read must never wipe Always on), except the explicit sign-outs (`removeRepoSecrets`). A repo whose app is never opened
keeps its last release: old engine tags must keep working against our site's API.

What stays on the Mac: recording, transcription, Apply with Claude, form filling, and Google sign-in.

**One AI seam per runtime** (9 Oct 2026). Every AI call, in the engine and in the app, goes through one factory: `src/ai/engine.py`
`client()` and `desktop/lib/ai/index.js` `client()`. Four engines sit behind one contract (`src/ai/providers/contract.py`,
`desktop/lib/ai/contract.js`): Anthropic API (`api`), the user's Claude Code (`cli`), OpenAI API (`openai`), the user's Codex (`codex`).
Callers send the same Anthropic-shaped `messages.create` and get the same shape back; each adapter translates (schemas, images, PDFs,
web search, effort, refusals, usage and price). Models are tiers (`src/ai/models.py`, `desktop/lib/ai/models.js`): a Claude id becomes
the same tier on OpenAI. Nothing switches by itself; a plan engine may fall back to its own family's API key on the user's tick. The
user-visible word for the AI comes from the chosen engine (`providers.who()`, `renderer/ai-name.js`), tested by ratchets in both runtimes.
Claude-only: Apply/Read with Claude (Claude Code driving Chrome) ; hidden for OpenAI engines (`renderer/claude-help.js`).

## Where the code sits

```text
src/
  daily.py, digest.py, store.py, scout.py, paths.py, features.py
  sources/     ats.py (feed adapters), feeds.py, boards.py, google.py, google_jobs.py
  ai/          enrich, score, kit, mail, inbox, interviews, prep, insights, budget
  notion/      client, matches, ledger, cron_runs, funnel, search_settings
desktop/
  main.js, preload.cjs          main process; the window has no Node and no secrets
  lib/                          pipeline, Notion, GitHub, Telegram, apply, schema, logs
  renderer/pages/               focus, jobs, sessions, strategy, settings, interviews, activity
config/                         search.json, sources.json, notion_schema.json (workspace as code)
extension/                      MV3; content scripts on Greenhouse, Lever, Ashby, Workday, …
tools/                          worktrees, form fast-path, schema snapshot, release
.github/workflows/              CI, desktop release, site deploy, and the user-called engine workflows
```

The code map (`node desktop/scripts/codemap.mjs <words>`) is read live from each file's first comment. Use it before opening a file.

## Data ownership

Notion is the source of truth for anything the user reads or would want on another device: applications, matches, profile, answers, search settings, run history, transcripts.

The Mac keeps only keys (Keychain), large files, and rebuildable caches (`jobs.sqlite`, `config/*.json`, `runs.json`). Writes go to Notion first. If Notion refuses, nothing changes locally.

Two Notion lists stay distinct. **Job Matches** is what a search found and scored. **Applications** is every job the user pursues, including ones added by hand or from a recruiter.

The employer index is product data on the website, not user data. Nothing about the user is sent to fetch it.

## Product loops around the engine

User runs and product runs are separate. The product side, described in `docs/HOW-IT-RUNS.md`, is a closed loop: apps send scrubbed telemetry and form-structure reports, those become GitHub issues, a daily job asks Claude for a tested fix on a branch, and the owner merges. A canary that stays healthy for 48 hours can become the stable desktop release.

## Constraints that shape the design

- Submit is never automated. Legal checkboxes stay with the owner.
- AI spend is gated. New models or large re-runs need a yes first. A monthly budget pauses optional AI steps.
- Several agents share this checkout and push to `main`. Code changes go in a worktree (`tools/worktree.sh`), then a normal fast-forward push. No force-push.
- Tests are three suites: `python3 -m unittest discover -s tests`, `cd worker && npm test`, `cd desktop && npm test`.
