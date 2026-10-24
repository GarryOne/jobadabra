# Scheduled runs in your own private repo

These three files are what keeps Jobadabra working while your Mac is off. They live in a
**private** repository of yours, created from the public starter template
(GarryOne/job-pilotto-starter), and each one calls the matching workflow in this public repo, which runs
the code with *your* repository's secrets and variables. Your logs, job database and results
never touch the public repo, and every fix released here reaches your runs automatically.

The files ship without a schedule, so nothing runs before your keys are in place; the Jobadabra app
adds the times you choose (Settings → How often). Defaults:

| File | When | What |
|---|---|---|
| `daily.yml` | every 4 hours | crawl, score, Telegram digest, Notion sync; also started by the bot's buttons |
| `scout.yml` | off (optional: 06:15 when you turn it on) | finds new employer job feeds of your own; the shared index is downloaded anyway |
| `mail.yml` | 05:00, 10:00, 16:00 | Gmail + Calendar → Notion and Telegram (read-only) |

Your private repo needs:
- **Secrets:** `ANTHROPIC_API_KEY`, `NOTION_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and
  optionally `SERPAPI_API_KEY`, `ADZUNA_APP_ID` + `ADZUNA_APP_KEY`, `JOOBLE_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.
- **Variables:** your Notion IDs (`NOTION_APPLICATIONS_DB`, `NOTION_MATCHES_DB`, … — see
  `.env.example`), and the feature switches you use (`JOB_PILOTTO_SCORE_MODEL`, …).

By hand: create a private repo from the starter template, add a `schedule:` to each file, then add the secrets
and variables in its Settings → Secrets and variables → Actions.
