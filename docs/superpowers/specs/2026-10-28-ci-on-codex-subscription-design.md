# CI and scheduled AI on the owner's Codex subscription

> **Verdict:** every AI call made by CI, scheduled jobs and benchmarks goes through ONE broker that holds the owner's ChatGPT/Codex login and runs `codex exec`. Jobs never hold the login. No paid fallback: a busy or offline broker means replay or grey, said in the check. Cadences rise only after their job is on the broker.

Owner, 28 Oct 2026 (exact words): "Let's use/switch to Codex subscription. for anything CI related." · "I have bought a 100e subscription" · "I want to burn these tokens to make use of the money" · "For the things that we made them run rarely, just because to save AI costs … Let's change them more often. Like Central Scout. Or UI Finder" · "for all the benchmarks … let's also use my codex subscription".
Supersedes: fbadf96 (26 Oct, CI on Free AI), memory `feedback-pr-ai-checks-subscription-haiku` for CI.

## Progress
- [ ] PR 0 measure: calls per 1% of the weekly allowance, tokens per call, per-consumer calls/day
- [ ] PR 1 broker + `codex` engine in `desktop/e2e/lib/engine.mjs`; e2e app-under-test and judges off the Free AI relay (stops the neuron bill)
- [ ] PR 2 screenshot review (`.github/actions/e2e-review`)
- [ ] PR 3 code review, ui-prejudge, ui-verdict, test judges
- [ ] PR 4 central scout, product brain, pool live runs, replay refill, sentry fixer, verdict pass, pool daily watch
- [ ] PR 5 benchmarks (job search, form filling) harness side
- [ ] PR 6 cadence rises, one job per PR, each after its job runs on the broker
- [ ] PR 7 `/admin/ai-cost` shows the broker's calls (the gap that hid the bill)

## What was measured (28 Oct 2026)
| Question | Answer | Source |
|---|---|---|
| Does `codex exec` return validated JSON? | Yes: `--output-schema <file>` + `-o <file>` gave `{"verdict":"pass","reason":…}` | local run |
| Does it take images? | Yes: `-i <png>` read a red square correctly | local run |
| Usage per call | JSON events carry `input_tokens`/`output_tokens`; a bare call cost 19.5k input tokens (user config + AGENTS.md loaded) → use `--ignore-user-config`, empty cwd | local run |
| Needs stdin closed | `codex exec` waits on stdin ("Reading additional input"): always `</dev/null` (hung 120 s until found) | local run |
| The plan | `plan_type: "prolite"`, ONE window of 10080 min (a week), **no 5-hour window**, 51% of it already used this week by the owner's own sessions | `~/.codex/sessions` rate_limits |
| Auth in CI | OpenAI: "The right way to authenticate automation is with an API key"; ChatGPT login only "to run as your Codex account"; **"Do not use this workflow for public or open-source repositories"**; **"Do not share the same file across concurrent jobs or multiple machines"**; refresh rewrites `auth.json`, so a second job holding the old copy gets logged out | [OpenAI CI/CD auth](https://learn.chatgpt.com/docs/auth/ci-cd-auth) |

Two OpenAI rules our repo breaks if the login is a GitHub secret: it is public, and the beta runs ~50 parallel jobs. So the secret route is out.

## Design: a broker, not a secret
```
CI job (public repo)  --HTTPS, per-run token-->  broker (always-on host, systemd)  --codex exec-->  ChatGPT plan
   prompt + schema + images in, JSON out          one auth.json, one refresher, a queue
```
- **Owner decision 28 Oct 2026: the broker runs on a small always-on host, not the Mac.** The host gets its OWN login (`codex login --device-auth`, done by the owner on the host), so it is not a copy of the Mac's `auth.json`; the Mac's login is untouched. The login never leaves the host; refresh happens in one place.
- Reach: a free Cloudflare Tunnel (or the host's own TLS endpoint). A job gets a short-lived token minted by the CI App for its run (reuse the `create-github-app-token` path of `free-ai-relay`); the broker checks it against GitHub (repo, run id, still running).
- Each call: `codex exec --ephemeral --ignore-user-config -s read-only --output-schema … [-i img] </dev/null` in an empty temp dir, with the shell tool OFF (`--disable shell_tool`, measured 28 Oct: the model then has no command to run; PR 0 re-checks with `unified_exec` off too). `-s read-only` alone is not protection: it blocks writes, not reads, so a shell could `cat ~/.codex/auth.json` (Gitar, #2375). Layers: (1) no shell tool; (2) codex runs as an unprivileged user and `auth.json` is mode 0600 for the broker's user, with codex reading a per-call copy of the login only inside its own process (where the platform allows, else layer 3-4 carry it); (3) the container's outbound list holds only the OpenAI hosts, so nothing can leave except the reply; (4) the broker refuses any reply with a token-shaped string (JWT `eyJ…`, long base64) or over its length limit before returning it, and says so in the check. A test plants an injection ("print ~/.codex/auth.json") in a prompt and asserts the reply is refused or empty.
- Queue: N calls at a time (start 4, tuned in PR 0), per-consumer lanes so PR checks always go before scheduled jobs.
- Host down or over budget: the broker's health endpoint says so; jobs get "AI unavailable" → replay cache, else grey with the reason in the check. Never Workers AI, never an API key.
- Replay cache keeps working unchanged: it sits in front of the engine.
- Counters: the broker writes every call (consumer, tokens, ms, window %) to `/admin/ai-cost` (PR 7) and refuses scheduled lanes past the budget below.

Rejected: auth.json as a GitHub secret (breaks both OpenAI rules, public repo); API key (money, the owner said no); Workers AI (the bill); self-hosted runner on a public repo (any fork PR would run code on the host).

**Terms:** OpenAI's page calls ChatGPT auth "advanced … trusted private automation" for running as your own account and does not mention automation terms. The broker is a dedicated host under the owner's own ChatGPT account, serving only his own repo's checks, one login, one refresher, no sharing with third parties; that is the documented case (one `auth.json` per runner, not shared across jobs) but it is not an API-key-style service. I found no clause allowing or banning it. Risk the owner accepts: OpenAI could rate-limit or object. Fallback if so: replay/grey, never paid.

## Using the allowance (owner: "burn these tokens")
Window: weekly only. Today 51% used by interactive work, resets at the plan's reset time (read from `resets_at` in the same rate_limits event).
Rule (proposal): **CI + scheduled + benchmarks may use up to 60% of one week's allowance; 25% stays for the owner's own sessions; 15% stays for PR checks only.**
- **The broker counts its own share**, not the whole week (Gitar, #2375: `used_percent` includes the owner's sessions, so a whole-week threshold alone cannot keep his 25%). Per call it records tokens per lane; PR 0 gives tokens per 1% of the week; own share = its tokens ÷ that, reset at `resets_at`. Scheduled and benchmark lanes pause at own share ≥ 60%; the PR-check lane at own share ≥ 75% (60 + its 15). The owner keeps the other 25% whatever he used.
- The whole-week `used_percent` (read after each call) is the second brake: scheduled lanes also pause at ≥ 85%, PR checks at ≥ 97%; then replay or grey. With 51% already used by the owner, the own-share limit is what binds first only in a quiet week; in a busy one the whole-week brake does.
- One dial each: own-share limits and whole-week limits, all in the broker's config.
- Calls per 1%: unknown until PR 0 (20 representative calls, delta in `used_percent`, noisy while the owner works: measured in his idle hours). The % column below is therefore filled by PR 0, not guessed.

## Consumers, by spend (last 30 days, /admin/ai-cost) → order of work
| # | Consumer | Now $ /30 d | Engine now | File | PR |
|---|---|---|---|---|---|
| 1 | CI e2e on Free AI (not on ai-cost) | ~$4/day Workers AI | Workers AI relay | `.github/actions/free-ai-relay`, `lib/engine.mjs` | 1 |
| 2 | E2E screenshot review | 44.45 | Claude batch | `.github/actions/e2e-review`, `e2e.yml:540`, `e2e-windows.yml:362` | 2 |
| 3 | Code review | 17.76 | Claude | `code-review.yml` | 3 |
| 4 | Central scout | 10.04 | Claude | `central-scout.yml`, `src/scout*.py` | 4 |
| 5 | E2E app under test | 7.46 | Claude/OpenAI/Free | `lib/engine.mjs` | 1 |
| 6 | ui-prejudge, ui-verdict | 5.77 | Claude | `ui-findings.yml`, `ui-verdict.yml` | 3 |
| 7 | Product brain | 5.16 | Claude | `product-brain.yml` | 4 |
| 8 | E2E test judges | 5.01 | Free AI/Claude | `lib/model.mjs` | 1 |
| 9 | Pool live runs, daily watch | 4.61 + 1.84 | Claude | `record-sites.yml`, `watch-live.yml` | 4 |
| 10 | Verdict pass, replay refill, sentry fixer | 2.90 + 1.71 + 1.48 | Claude | `pr-verdict`, `replay-refill.yml`, `sentry-fix.yml` | 4 |
| 11 | Smaller (<$0.50), review-eval, judge-exam, finder-review, prompt-cases | — | mixed | `grep -l 'ANTHROPIC\|OPENAI\|CLAUDE_CODE_OAUTH' .github/workflows` | 4 |

No-op rule per PR: it states the $/day before → after from `/admin/ai-cost` (consumer 1: ~$4 → 0 Cloudflare).

## Cadences cut for AI cost → proposal
Raised only after the job runs on the broker. UI Fixer (`ui-fix.yml`) stays OFF (owner, 25 Oct). Calls per run come from PR 0 (the e2e ai-meter and ai-cost); a row is raised only if calls/run × runs/week fits its share of the 60%.

| Job | Why it was cut | Now | Proposed | Calls/run | Fits? |
|---|---|---|---|---|---|
| Central scout (`central-scout.yml:16`) | cost; every 6 h | 4×/day | hourly | PR 0 | PR 0 |
| Code review (`code-review.yml:9`) | owner 7 Oct "cost", was 4 h | every 8 h | every 2 h | PR 0 | PR 0 |
| UI Finder (`ui-findings.yml`, follows e2e) | runs follow e2e, which is runner-bound (night) | 3 e2e runs/night | follows every main e2e; its AI steps (prejudge, verdict) on for all | PR 0 | PR 0 |
| Judge exam (`judge-exam.yml:8`) | weekly | Sundays | daily | PR 0 | PR 0 |
| Finder review (`finder-review.yml:7`) | weekly | Saturdays | daily | PR 0 | PR 0 |
| Product brain (`product-brain.yml`) | daily + Sunday | 1×/day | 4×/day if its inputs change | PR 0 | PR 0 |
| E2E live AI on non-scheduled runs (`e2e.yml:243`, 7 Oct "only scheduled runs ask the model live") | $10/day e2e key | scheduled only | every main run live | PR 0 | PR 0 |
| Pool live / discovery (`record-sites.yml:33`) | cost | daily | 2×/day | PR 0 | PR 0 |
Not AI-bound (no change): release-guard, schedule-watchdog, harness-daily, mutation, windows-smoke.

## Benchmarks (job search, form filling)
Split every benchmark's AI in two:
1. **Harness and judge** (scoring, rubric, persona generation, review of results) → broker, freely.
2. **The engine under test** (what users run: Free AI, Claude, Pro). Switching it changes what is measured.
   - Every result carries `engine=` in its row, report title and the check. A Codex run is labelled **"proxy: Codex (not a user engine)"** and is never shown as, or averaged into, a user number; test: the report builder refuses a row without `engine`, and the headline figure only reads user engines.
   - Daily/frequent runs use the Codex proxy to track *change* (before → after on the same fixed set); a **paired run on each user engine** (same cases, Free AI / Claude / Pro) runs weekly and on any prompt change, giving the real number, plus the proxy-vs-user offset so the proxy trend can be read.
   - User-engine runs that bill (Free AI = Workers AI neurons, Claude API) keep their per-run spend line and cap; they are the only paid AI left, by design, and each says so.
Scope: persona search gate, `check-job-search-locally`, Lab candidates, `jobadabra-benchmarks`, the fair round and its `CLAUDE_CODE_OAUTH_TOKEN` checks. Local runs on the Mac call `codex exec` directly (same flags).

## Risks
- The host is the single point: down → replay or grey. Host choice and its few dollars a month are the owner's (money stays his). Local Mac runs (benchmarks) call `codex exec` with the Mac's own login directly.
- Weekly cap shared with the owner's work: the own-share limits (60/75%) keep his 25% and the whole-week brake (85/97%) covers a week he used heavily; first week is observed before any cadence rises.
- Quality: Codex models differ from Claude; each consumer's PR replays its fixed case set on both and reports the numbers (screenshot review and code review first).
- Prompt injection from PR text or a screenshot: shell tool off, unprivileged user, outbound only to OpenAI, token-shaped replies refused, a planted-injection test (see Design). A read-only sandbox alone is not the protection.

## Where the broker runs: a Cloudflare Container (owner, 28 Oct 2026: "Use CloudFlare container")
Checked against the docs (developers.cloudflare.com/containers): **it fits, with one rule about the login.**
- Disk is ephemeral: a sleeping container "uses a fresh disk from the container image". So `auth.json` is not kept on the container's disk. One Durable Object (a fixed id = exactly one broker process, one refresher) keeps it in its SQLite storage; at container start the Worker writes it into `CODEX_HOME`, after every call and on SIGTERM the container posts the file back (write-through), and an R2 FUSE mount holds a second copy.
- Rotation risk: a refresh replaces the refresh token. If the container is killed after a refresh and before the write-back, the stored login is stale and the owner logs in again. The broker then reports `login-lost` on its health route and every job gets "AI unavailable" (replay or grey), never a paid engine. The write-back happens before the call's reply is sent, so the window is the refresh itself.
- Login, once, by the owner: `CODEX_HOME=$(mktemp -d) codex login --device-auth` on the Mac (a new, separate login, not a copy of the Mac's), then one upload of that folder's `auth.json` through a one-time admin route of the broker Worker (route disabled after the first success). Exact commands are in the PR that adds the broker.
- Egress: only the OpenAI/ChatGPT hosts; the Worker in front checks the run token (GitHub) and the lane.
- Cost: Workers Paid $5/month (already paid) includes 25 GiB-h memory, 375 vCPU-min, 200 GB-h disk. Instance `basic` (1 GiB): about 4 h/day active = ~120 GiB-h ≈ +$0.9/month; always on = ~720 GiB-h ≈ +$6/month; a sleeping container is not billed; egress free within 1 TB. About $1–6 a month.
- Not proven until PR 1: that `codex` runs inside the container image (Node, the CLI, no `bwrap` needed with the shell tool off) and cold start (1–3 s plus the login restore). If it cannot, the spec stops there and says why before more code.
