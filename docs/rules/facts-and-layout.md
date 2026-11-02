# Facts that are easy to get wrong, and the code layout

Reference, read when the task touches these areas. Linked from CLAUDE.md. For any file: `node desktop/scripts/codemap.mjs <words>`.

## Facts that are easy to get wrong
- **A ⏱️ Search runs row's `Summary` is only the report's first line** (`src/notion/cron_runs.py`, `Summary: _text(lines[0])`). The rest (where a
  GitHub run's `Warning: …` lines are) is the page's Report bullets: `desktop/lib/run-history.js` `detail()` returns them as `report`, and
  `renderer/run-warnings.js` `runWarningLines()` reads log + report. A row can say `Status: Warnings` with no warning text on it, so a list's pill
  and a detail's card must agree by construction.
- **"Show exactly these jobs" is `showJobsIn(label, urls, from)`** (`desktop/renderer/pages/jobs.js`), matching on `fullKey(url)` (trim + one
  trailing slash). A "View all N" button must call it *and* count N with the same key (30 Sep: a card said 9, the page showed 8).
- **The digest has two item shapes**: "New since last run" lines end ` - 100%` (a title-match percentage); "Best matches" lines carry `· 🎯 83`
  (the fit score). `desktop/renderer/run-cards.js` parses both: the percentage beside the company, the fit in the pill.
- **Feed the warning helpers raw lines.** `limitedJobs` / `warningSummary` / `groupWarnings` read the pipeline's own wordings ("N job(s) not read
  by AI", "… left for the next check", "Skipped job <id>: …"); `humanError` is for what the owner reads. API JSON must never reach the UI.

## Layout
- Python package `src/` (`python -m src <check|scout|discover|feeds|enrich>`; `check` = the jobs check, also `daily`; `scout` = the employer finder, the last step of Find jobs):
  `daily.py` orchestrates a run; `digest.py` ranking/rotation/paging/layout/buttons; `telegram.py` sending; `store.py` SQLite cache; `scout.py`;
  `paths.py`; `features.py` optional-feature registry and `JOBADABRA_DISABLE` (only crawl + digest are required; new features are optional, on
  when their keys exist, and listed there). `src/stores/`: the store interface ([data-ownership.md](data-ownership.md)).
- `src/sources/` (`ats.py` feed adapters, `feeds.py` employer-feed crawl, `boards.py`, `google.py` Gmail/Calendar client).
- `src/ai/`: `enrich.py` stage 1 (Haiku), `score.py` stage 2 (Sonnet), `kit.py` application kit, `apply_batch.py`, `insights.py` daily insight +
  Monday report, `interviews.py` → 🎤 Interviews, `transcribe.py` local transcripts (add-on `requirements-transcribe.txt`), `mail.py` Gmail +
  Calendar → events/Stage/prep, `mail_triage.py`, `decide.py` + `meanings.py` (AI decisions with fixed answers), `opportunity.py` recruiter
  message → Recruiter lead, `inbox.py` "log anything" (`--propose` then `--reading`; confirmation step `renderer/lead-confirm.js`), `added.py`
  facts + fit for added jobs (LinkedIn/Glassdoor/Indeed are never fetched: `ledger.NO_FETCH`), `passwords.py`.
- `src/notion/`: `client.py`, `matches.py`, `ledger.py` (record frozen at Applied + 📈 Application Events), `funnel.py` (🎯 Pipeline, no AI).
- `config/`: `preferences.json`, `sources.json`, `scout_seeds.json` (a user's own additions only). Starting sources are central
  (`jobadabra-lab`), published in the employer index; old shipped lists are ignored (`src/legacy_lists.py`).
- `desktop/lib/interviews.js` + Interviews page: records (mic left, call audio right; consent box each time), drafts and recordings stay on the Mac.
- **Product vs personal.** Product (the owner's Cloudflare account): one worker `www`, its code in the private repo `jobadabra-web` (`site/` there) → https://www.jobadabra.top (website, Pro
  waitlist, Notion sign-in, `/report/fill-failure`). Personal (per user, set up in the app): their Telegram bot and scheduled runs (their private repo).
- `worker/` is the Telegram bot: run locally with long polling (`desktop/lib/telegram.js`), or uploaded to the user's own Cloudflare account
  (`desktop/lib/telegram-cloud.js`, `settings.telegramCloud`).
- Workflows `daily.yml`, `scout.yml`, `mail.yml` are reusable (`workflow_call`) with no schedule; schedules live in each user's private repo from
  `templates/github-actions/` (the owner's: `GarryOne/jobadabra-personal-always-on`).
- `desktop/lib/github.js`: **Always on** as a GitHub App on one repo (`<user>/jobadabra-personal-always-on`, older `job-pilotto-private`, from template `jobadabra/jobadabra-user-template` (`GarryOne/job-pilotto-starter` until the rename; the app asks the API which exists),
  published by `tools/publish-starter.sh`); the Jobs list then comes from the latest `jobadabra-jobs-db` artifact.
- Form-filling improvement: each fill logs to Agent Runs; `tools/fill-failures.py` groups what was left; skill `record-applying-sites`. Fill failures
  are fixed by recipes (the proposer and the canary); triage lives in `jobadabra-lab`.
- Notion IDs have no defaults in code: `.env`, repository variables, or the Desktop App.
- **The terminal follows the Desktop App only on request** (`src/paths.py` `follow_app`; owner, 18 Oct 2026): with the app set up and no `JOBADABRA_DATA_DIR` +
  `JOBADABRA_CONFIG_DIR`, any engine start that is not the app (terminal, test, agent) is REFUSED at import, before a file is opened. The owner's own run sets
  `JOBADABRA_FOLLOW_APP=1` (the app's Notion IDs and `data/` + `config/`); tests and agents set their own temp folders, or `=0` for the repo's example data.
  `.env` NOTION_* of another workspace switch it off. App and terminal take turns (`run_lock`). Guard: `tests/test_data_dir_guard.py` (loops over every entry point).
