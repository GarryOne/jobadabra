# jobadabra = desktop app + extension only (1 Nov 2026)

> **Verdict:** 🟢 Owner picked "A: shared code renamed, shells move". The code the app runs stays here under a non-server name (`app-core/`); only
> deploy shells and server-only workflows leave. 6 PRs, session **rs**. The Worker switches to `jobadabra-web` by day only, with a8's yes.

Owner, 1 Nov 2026: "jobadabra should have no web, no worker" · "it should be strictly desktop and extension". Rule in `CLAUDE.md`, guard
`tests/test_desktop_extension_only.py` (allowlist that only shrinks).

## What the import graph showed (origin/main ab4a7a5)
The first plan moved three folders whole. Each one is also code the shipped app or extension runs:

| Folder | Server-only part (moves) | Code the app runs (stays, renamed) |
|---|---|---|
| `worker/` (22 src, 164 test files) | `wrangler.toml`, `package.json` deploy script, `scripts/check-secrets.mjs`, `scripts/watchdog.mjs`, `worker.yml` | all of `worker/src`: `desktop/scripts/stage.mjs:29` copies it to `desktop/shared/worker`; `server-env.js` (extension.js, cv-facts.js), `telegram.js` (index.js: Telegram handlers, imports scheduler/watchdog/report); ~164 tests of extension + app logic |
| `hosted/` (14 files) | both `Dockerfile`s, `ready-fill/main.mjs`, `image-check.mjs`, `package.json`, `ready-fill-image.yml` | `ready-fill/{extension-copy,extension-storage,live,fill-job,night,no-submit,stand-in,fill-video}.mjs`: staged into the app (`stage.mjs:59`), imported by `cdp-session.js`, `extension/background-submit.js`, the e2e harness and ~10 app tests |
| scout (`src/scout*.py`, `digest.py`) | `central-scout.yml` (runs the public engine with no user data) | every module: `python -m src scout` is the app's "Find new employers" (`pipeline-tasks.js:64`); `scout_paste/probe/notion/index/kind_counts` are imported by the app and the engine |

## Design
- **Engine** = `worker/src` + `worker/test` as a pure move to `app-core/{src,test}` (same folder depth as `worker/`, so the relative `../../extension`, `../../desktop`, `../../tools` imports of 113 files stay valid; `desktop/engine/` would add one `../` to each); the staged copy becomes `desktop/shared/app-core`. One commit, one PR, alone.
- **Bot Worker decommissioned** (owner, 1 Nov 2026: "SRE Job Pilotto Worker is an old telegram bot which should be decommissioned"; asked which way, answered "Timers to site Worker, delete bot"). The Worker `sre-job-pilotto-bot` did two jobs: the Telegram webhook (owner commands, digest buttons) and the on-time starts. The webhook ends; the starts move to the site Worker (`www`) as `jobadabra-web/shared/timers.js`, which only decides which `CRONS` entry a site trigger stands for: `*/5` for every cron that fires on its tick, `47 21,23,1 * * *` as a trigger of its own (a8, Option A: `CRONS` unchanged, so the GitHub-side watchdog, the run-name tests and the Schedules page keep reading `app-core/src/scheduler.js`). The code the app bundles (`app-core/src/index.js` Telegram handlers, `extension.js`) stays: the app deploys its own copy into the user's Cloudflare account, never the owner's Worker.
- **Hosted** `ready-fill` shared files move to `desktop/ready-fill/`; the image builds in web from a jobadabra checkout.
- **Scout**: nothing under `src/` moves. `central-scout.yml` and `product-brain.yml` go to `jobadabra-lab`, `ai-cost-billed.yml` to `jobadabra-web`.

### Design: who owns the timers (owner, 1 Nov 2026)
| State | Its one owner | Verdict that changes it |
|---|---|---|
| Which workflow starts at which minute | `app-core/src/scheduler.js` (`CRONS`, `jobsFor`, `NIGHT_SLOTS`) | a PR to that file + `scheduler.test.js` |
| Which Cloudflare trigger runs it | the site Worker `www` (`wrangler.toml` triggers `*/5` and `47 21,23,1 * * *`) | the day-time switch (4b) |
| Whether it is on | `TIMERS=on` + the secret `TIMERS_GITHUB_TOKEN` on `www` (the owner's to set) | the switch |
| Whether it ran | `schedule-watchdog.yml` on GitHub's cron (unchanged) | it files "⏰ On-time starts missing" |
- **What dies with the bot:** the Telegram webhook and every inline button family the webhook answers (`pick:<code>:<n>` in `src/digest.py`, `opick:<n>:<page>` outcome buttons on application rows, `ins:<u|n|a>:<page>` insight feedback). The Python digest workflows (`daily.yml`, `mail.yml`, `scout.yml`) have not run since 1 Oct 2026; the owner accepted this via mac-07. The `TELEGRAM_BOT_TOKEN` GitHub secret is only ever used to send (`sendMessage` from the workflows), so those workflows still send; only the taps on their buttons go unanswered.
- **Failure of a start** no longer pages Telegram; it fails the trigger (Cloudflare cron history) and comments on the watchdog's GitHub issue.
- **The account has 5 cron triggers, all used** (www 2 + bot 3): the swap removes the bot's three first, then adds `47 21,23,1 * * *` to `www`, by day and finished before 21:00 UTC.

## Workflows (verdict and target)
| Workflow | Verdict | Target |
|---|---|---|
| `worker.yml` (deploy) | deleted with the bot Worker | PR 4c (after the switch by day) |
| `tests-worker.yml` | stays; file and job names unchanged (they are required-check names), paths and working-directory point at `app-core/` | PR 2 |
| `ready-fill-image.yml` | moves | web, PR 5 |
| `central-scout.yml` | moves | lab, PR 6 |
| `product-brain.yml` | moves | lab, PR 6 |
| `ai-cost-billed.yml` | moves | web, PR 6 |
| `schedule-watchdog.yml`, `self-heal-stats.yml`, `desktop.yml`, `e2e.yml` and every other | stay (they watch or run jobadabra's own runs; only path strings change) | PR 2 |

## Plan (titles `[rs] n/6 <what>`)
| n | Repo | What | Removes from the allowlist |
|---|---|---|---|
| 1 | jobadabra | Rule + guard + this spec | none (adds the list) |
| 2 | jobadabra | Pure move `worker/{src,test,package*.json,scripts/stage-shared,scripts/watchdog}` → `app-core`, `stage.mjs`, tooling + every reader (area key `worker` kept, JOB-193); shell left in `worker/` with `main` repointed | part of `worker` |
| 3 | web | Bot Worker shell + deploy workflow (dispatch only; nothing deploys on merge): merged as web #274, deleted again in 4c | none |
| 4a | web | `shared/timers.js` on `www`: the bot's starts, off until `TIMERS=on` | none |
| 4b | web | The switch, by day (a8 names the hour): bot crons off, `www` gets the 47 cron, `TIMERS=on`; proof = one night slot started by `www` | none |
| 4c | jobadabra + web | Delete the Worker `sre-job-pilotto-bot` (crons, webhook, script; **irreversible, mac-07 told first**), `worker/`, `worker.yml`, `index.js`'s `scheduled`, the web shell | `worker`, `worker.yml` |
| 5 | public 5a, web 5b, public 5c | `hosted/` split: 5a shared files to `desktop/ready-fill/` (public #2891), 5b the container shell + `ready-fill-image.yml` to web, 5c delete `hosted/` | `hosted`, `ready-fill-image.yml` |
| 6 | lab + web, then jobadabra | the three server workflows | the other 3 workflows |

Order per move: the private side lands first, then the jobadabra removal. Before deleting, grep `jobadabra-web` and `jobadabra-lab` for readers (#2832).

## Worker switch (4b), conditions from a8
- Only by day, outside 21:00-05:30 UTC, finished before 21:00 UTC; the earliest is 06:30 UTC on 2 Nov 2026. No by-hand beta or main `build.yml` running (check `gh run list` for `desktop.yml` and `build.yml` right before). a8 names the hour.
- Order, so two Workers never dispatch at once: (1) remove the bot's three crons; (2) deploy `www` with the `47 21,23,1 * * *` trigger and `TIMERS=on`; (3) check the five triggers via the Cloudflare API.
- Before and after: the `*/10` trigger still fires; the next NIGHT_SLOTS slot starts "Night burn-in n/5". Proof of done = one night slot started by `www`.
- The dispatch token: `TIMERS_GITHUB_TOKEN`, a secret the owner sets (mac-07 checks what `job-pilotto.github.dispatch-token` can do on `GarryOne/jobadabra` first, without printing it).

## Open decisions (asked when their PR starts)
1. ~~How web learns the engine changed~~ Settled: the bot Worker is deleted, so nothing deploys it; `www` already bundles `app-core/src` files and `public-watch.yml` hashes `app-core/src` for the site deploy.
2. (mac-07: the scout fix for the stuck teamtailor reads must land first, then move the fixed code.) `central-scout.yml` left `jobadabra-lab` on 21 Oct 2026 because lab's Actions minutes were not payable. Check that is still true before PR 6; if so it goes to web (also private, runs workflows) instead of lab.

## Progress
- [x] Import graph and reader inventory (proof: none: analysis only, the findings are the table above)
- [x] 1/6 rule + guard + spec (proof: tests/test_desktop_extension_only.py @fc869fb)
- [x] 2/6 engine rename (proof: app-core/package.json)
- [x] 3/6 web shell (proof: none: merged as jobadabra-web#274, e8a1907; deleted again in 4c)
- [x] 4a/6 timers on the site Worker, off (proof: none: merged as jobadabra-web#279, 5e8a58f)
- [x] 4b-0/6 the bot Worker's GitHub calls follow a repo move (a 301 re-sends the POST) (proof: app-core/test/github-fetch.test.js)
- [x] 4b/6 the timers switch: www starts the on-time workflows, the bot has 0 triggers (proof: none: jobadabra#2935 + jobadabra-web#305; Cloudflare read-back www 3 triggers / bot 0; sweeps 01:10 and 01:20, Night burn-in 3/5 at 01:30:57 started by workflow_dispatch)
- [x] 4c-1/6 delete `worker/`, `worker.yml` and the dead `scheduled` export here (proof: tests/test_desktop_extension_only.py)
- [x] 4c-2/6 delete the bot shell in jobadabra-web (`workers/bot`, `release-bot-worker.yml`, its test) (proof: none: jobadabra-web#311 merged c58169e, deleted files only)
- [x] 4c-3/6 delete the Cloudflare Worker `sre-job-pilotto-bot` (the webhook url was already empty, mac-07) (proof: none: Cloudflare read-back 2 Nov 2026 01:55 UTC, script gone, www still 3 triggers)
- [x] 5a/6 shared ready-fill files to desktop/ready-fill (proof: desktop/ready-fill/night.mjs @5a58de5)
- [x] 5b/6 container shell + ready-fill-image.yml to web (proof: none: merged as jobadabra-web#280, 67b76e8)
- [x] 5c/6 delete hosted/ and ready-fill-image.yml (proof: tests/test_desktop_extension_only.py)
- [x] 6a/6 `ai-cost-billed.yml` to web (proof: tests/test_desktop_extension_only.py)
- [x] 6b-1/6 the central scout and the product brain in lab, switched off (proof: none: merged as jobadabra-lab#65, 6d5ec76)
- [x] 6b-3/6 first by-hand scout in lab: AI calls answered, no "oidc" (proof: none: jobadabra-lab run 41376186747, 2 Nov 2026 02:09-02:33 UTC: 40 broker calls answered by claude-haiku-5-5 (codex ran out), 0 failed, 0 oidc lines, 12 SerpApi searches, 3871 feeds published)
- [x] 6b-4/6 the switch: public deletes both workflows and the tests that read them, lab turns the schedule on (proof: none: jobadabra#2962 + jobadabra-lab#74 + jobadabra-web#320 merged 2 Nov 2026 03:11-03:13 UTC; public main has neither workflow; lab's two workflows are active with `schedule:`; Cloudflare read-back: www BRAIN_REPO = jobadabra/jobadabra-lab, 3 triggers unchanged)
