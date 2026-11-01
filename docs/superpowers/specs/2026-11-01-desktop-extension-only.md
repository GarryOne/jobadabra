# jobadabra = desktop app + extension only (1 Nov 2026)

> **Verdict:** 🟢 Owner picked "A: shared code renamed, shells move". The code the app runs stays here under a non-server name (`desktop/engine/`); only
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
- **Engine** = `worker/src` + `worker/test` as a pure move to `desktop/engine/{src,test}`; the staged copy becomes `desktop/shared/engine`. One commit, one PR, alone.
- **Bot Worker** `sre-job-pilotto-bot` deploys from `jobadabra-web/workers/bot/`: its `wrangler.toml` (same name, crons, vars, bindings), `package.json`, `check-secrets.mjs`, a deploy workflow. `main` points at the engine, which the workflow checks out from public `jobadabra` (private reads public). Secrets stay in Cloudflare (same Worker name). Its GitHub token still dispatches jobadabra workflows.
- **Hosted** `ready-fill` shared files move to `desktop/ready-fill/`; the image builds in web from a jobadabra checkout.
- **Scout**: nothing under `src/` moves. `central-scout.yml` and `product-brain.yml` go to `jobadabra-lab`, `ai-cost-billed.yml` to `jobadabra-web`.

## Workflows (verdict and target)
| Workflow | Verdict | Target |
|---|---|---|
| `worker.yml` (deploy) | moves | web, PR 4 (switch by day) |
| `tests-worker.yml` | stays, renamed `tests-engine.yml`, paths updated | PR 2 |
| `ready-fill-image.yml` | moves | web, PR 5 |
| `central-scout.yml` | moves | lab, PR 6 |
| `product-brain.yml` | moves | lab, PR 6 |
| `ai-cost-billed.yml` | moves | web, PR 6 |
| `schedule-watchdog.yml`, `self-heal-stats.yml`, `desktop.yml`, `e2e.yml` and every other | stay (they watch or run jobadabra's own runs; only path strings change) | PR 2 |

## Plan (titles `[rs] n/6 <what>`)
| n | Repo | What | Removes from the allowlist |
|---|---|---|---|
| 1 | jobadabra | Rule + guard + this spec | none (adds the list) |
| 2 | jobadabra | Pure move `worker/{src,test}` → `desktop/engine`, `stage.mjs`, `tests-engine.yml`, every reader; shell left in `worker/` with `main` repointed | part of `worker` |
| 3 | web | Bot Worker shell + deploy workflow (dispatch only; nothing deploys on merge) | none |
| 4 | jobadabra | Delete the shell + `worker.yml`; the switch happens first, by day, a8 names the hour | `worker`, `worker.yml` |
| 5 | web, then jobadabra | `hosted/` split | `hosted`, `ready-fill-image.yml` |
| 6 | lab + web, then jobadabra | the three server workflows | the other 3 workflows |

Order per move: the private side lands first, then the jobadabra removal. Before deleting, grep `jobadabra-web` and `jobadabra-lab` for readers (#2832).

## Worker switch (PR 3 → 4), conditions from a8
- Only by day, outside 21:00-05:30 UTC; no by-hand beta or main `build.yml` running; a8 names the hour and gives its yes.
- Before and after: the `*/10` trigger still fires; the next NIGHT_SLOTS slot starts "Night burn-in n/5". Proof of done = one night slot started by the web-deployed Worker.
- Then tell nm (jobadabra-ad): its heartbeat lands in `jobadabra-web/workers/bot`.

## Open decisions (asked when their PR starts)
1. How web learns the engine changed (today a push to `worker/src` deploys): pin a jobadabra SHA in web and bump it by PR (recommended: deterministic), or poll main hourly (GitHub cron is unreliable).
2. `central-scout.yml` left `jobadabra-lab` on 21 Oct 2026 because lab's Actions minutes were not payable. Check that is still true before PR 6; if so it goes to web (also private, runs workflows) instead of lab.

## Progress
- [x] Import graph and reader inventory
- [ ] 1/6 rule + guard + spec
- [ ] 2/6 engine rename
- [ ] 3/6 web shell
- [ ] 4/6 switch + delete shell
- [ ] 5/6 hosted split
- [ ] 6/6 server workflows
