# Agent coding page: how the agent codes, ships and verifies (design)

> **Verdict:** one new admin page, `/admin/operations/agent-coding`, report only, that shows five numbers about our own way of working: where the push gate stops us, what really fixed a red, how much of our work is CI/tooling, where fixes circle, and how long CI makes a push wait. It never blocks anything.

## Problem, in the owner's words (1 Nov 2026)
- "Is any stats here worth to have it live under /admin/agent-coding or /admin/push-checks" (about the prune-audit sketch).
- "basically is mostly about the way our agent is coding, is shipping and is verifying".
- Decision: **"New page incl. push gate"**, with an upload of the push-gate log from this Mac. An explicit owner exception to the "no new guard, gate, CI check or harness feature until 3 green nights" freeze. The page is a report: **no new gate, no new check that can go red or block a push**.

**Who gets what:** the owner sees, weekly and without asking a session, whether the way we work is getting cheaper or going in circles (outcome: the numbers the 31 Oct "267 of 356 PRs changed CI" count was done by hand).

## Address and neighbours
- `/admin/operations/agent-coding`, group Operations, icon 🧭, question "How does our agent code, ship and verify, and where does it go in circles?"
- The per-check table already lives on `/admin/operations/pr-checks` (`admin/pr-checks.js`). This page does **not** repeat it: a link at the top ("Per-check scorecard →").

## The five stats (definitions)
Window: the last 8 ISO weeks (Monday start, UTC), newest first; stats 1 is also shown for "last 7 days".

1. **Stopped pushes: form vs real.** Source: the push-gate log. A *push* is one `# <ts> push gate total=<s>s` header; its step lines are `<secs> <exit> <step>`. A push is *stopped* when any step has exit ≠ 0. Per step: runs, stops, seconds. Class of a stopped push, by its failed steps only:
   - **form** if every failed step is in TRAIL (recorded cases, rung trailer, e2e cause trailer, owner report, spec proof, why comments, new code comments, prompt cases, e2e issue links) or LISTS (workflow paths, registry lists, harness test sets, stale expectations, new e2e steps, e2e reliability, file size);
   - **real** if a failed step is a suite (desktop / python / worker / site clean checkout, e2e unit tests, renderer class tests, journey gate, ladder gate, places check);
   - **other** otherwise. Shown as a stacked bar per week plus seconds spent in each class. The three sets are a table in one file (`tools/gate-stats.mjs`), the same sets as the prune audit.
2. **What fixed a red.** For each red Actions run on a PR branch whose PR later merged, the first later commit of that PR that is green is the *fix commit*; it is classed **product** (touches `src/ desktop/ extension/ worker/ site/ prompts/` with more than 6 changed lines), **test/harness drift** (only `tests/ desktop/test/ desktop/e2e/ desktop/integration/`), **CI config or tools** (`.github/ tools/ docs/` or `lanes.json`-style registries) or **form** (the subject says trailer, comment, baseline, ratchet, lint, count, size, wording... and at most 60 changed lines). Reds with no later green on a merged PR are counted as "no fix seen". A **heuristic, ±10 points**, and the page says so.
3. **Share of PRs that change CI or tooling.** Merged PRs per week where at least one file is under `.github/`, `tools/` or the `desktop/e2e/` harness (not `desktop/e2e/` suites' test names: the same path list as `tools/pr-check-scorecard.mjs`'s `TEST_PATH` keeps docs out). Shown as `n of N (x %)` per week.
4. **Fix PRs per area per week; 3+ is a circle.** *Fix PR* = merged PR whose title starts with or contains "fix" (case-insensitive word) or whose branch starts with `fix`. *Area* = the first two path segments of its product files (e.g. `desktop/renderer`, `src/ai`, `extension`), a PR counts once per area it touches. An area with **3 or more fix PRs in one week** is flagged 🌀, which is the owner's going-in-circles rule applied to a week.
5. **CI wall minutes per push.** Per week: Actions runs of `pull_request` events, `wall = updated_at − run_started_at`, summed per head sha ("a push"), median and p90 per push, share of minutes in cancelled runs, and **queue minutes** = `run_started_at − created_at` summed per push (waiting for a runner). Not billed minutes.

## Data flow
```
this Mac:  .git/gate-timing.log ──(tools/gate-stats-upload.mjs, ≤1×/day, from ship.sh)──┐
GitHub:    Actions API + git history ──(.github/workflows/agent-coding-stats.yml, daily)──┤  PUT, Bearer
                                                                                            ▼  SELFHEAL_PUBLISH_KEY
jobadabra-web:  /agent-coding/data  (kind=gate | kind=ci)  →  D1 table agent_coding_days  →  /admin/operations/agent-coding
```
- **Gate numbers** (`kind: "gate"`): `tools/gate-stats-upload.mjs` reads the log, builds per **day**: `{day, pushes, stopped, totalSecs, steps: {<fixed label>: {runs, fails, secs}}}` for the last 35 days and PUTs them. Idempotent: the same day replaces its row. Only counts, seconds and the fixed step labels leave the Mac: **never** a branch, path, commit text or the raw log. The uploader names each step by its fixed label and classes it (form / real / other) on the Mac; the Worker keeps at most 80 labels of at most 60 characters from a safe character set and clamps every number. The key is read from the Keychain item `job-pilotto.site.selfheal_publish_key` at run time; no file, no env copy in the repo.
- **How it runs (owner choice, pending mac-07):** recommended = `tools/ship.sh` calls the uploader as a best-effort tail (5 s cap, `|| true`, a stamp file keeps it to once a day, `GATE_STATS_UPLOAD=0` off). No launchd job, no daemon.
- **CI numbers** (`kind: "ci"`, stats 2–5): a daily workflow (`agent-coding-stats.yml`, schedule through the Worker scheduler if GitHub cron proves unreliable, see memory `feedback-github-cron-unreliable-use-worker`) runs `tools/agent-coding-stats.mjs` with the workflow's own `GITHUB_TOKEN` (its quota, not the owner's shared 5,000/h). It reads the last 3 days of runs and merged PRs, folds them into per-day rows, and PUTs them; a manual run with `days=35` backfills. Pure counting by structure (shas, paths, conclusions, timestamps): no AI, $0.
- **Worker** (`jobadabra-web`, `admin/agent-coding.js`, same shape as `admin/pr-checks.js`): `ingest` (Bearer `SELFHEAL_PUBLISH_KEY`, 404 without it, size cap, shape check that clamps every number and cuts every string, table `agent_coding_days(kind, day, card, updated_at)` primary key `(kind, day)`), `view` (owner cookie as the other admin pages), `page(rows)` renders the five sections. Routes added in `workers/www/index.js`, the page in `admin/admin.js` PAGES, a headline in `admin/headlines-ops.js`.

## Page layout (5–10 s rule)
Verdict band first (three lines, each with a status chip icon+word): "Push gate: x % of stops were form" · "Fixes: y % product" · "Circles: z areas with 3+ fixes this week". Then five cards, each a bar/table of the last weeks, details in `<details>`. Fictional-data render before any commit of the page: admin pages are dark only (no light theme exists, the light shot is byte-identical), so the image shows desktop 1440 | phone 390.

## Edge cases
- No data yet for a kind: card says "No upload yet" with the command to run, never zeros.
- The gate log missing or empty (CI, another Mac): the uploader exits 0 and prints one line.
- A day uploaded twice: replaced. A day with 0 pushes: absent, drawn as a gap.
- Force-pushed branches lose their commits: their reds are "no fix seen", counted and shown.
- GitHub rate limit: the workflow stops below 300 remaining and publishes what it has; the page shows each day's "as of" time.
- Honest labels: stats 2 and 4 carry "heuristic" text; stat 5 says "wall, not billed".

## Non-goals
- No gate, check, threshold or alert; no Telegram message (a later decision).
- No per-check table (it lives on PR checks).
- No raw log, branch, path or commit text stored centrally.
- No AI.
- Backfill beyond 35 days; the prune audit's one-off numbers stay in its sketch.

## v2, not in these PRs: the SDLC tab (owner, 1 Nov 2026)
Owner: "look on the entire harness/workflow of our development ... agents writing first lines of code → first gates → push checks → PR checks → main checks → beta/nightly/e2e", "to understand if our speccing is bad or missing, if our plan is bad, if our build is bad, if the maintain is bad", "probably a separate tab. SDLC".
- A tab on this page: one funnel row per layer (runs, reds by class product / form / flaky, minutes, product bugs caught, product bugs that got past to later layers) and one row per phase (spec, plan, build, maintain) with 2-3 proxy signals each (PRs with no spec, plans closed unmerged, reds and fix commits per PR, fixes after merge in the same area, reverts, red-main days).
- Layers 2-4 need only more GitHub runs (push on main, schedule, dispatch); layer 0 (the agent's hooks, commit-msg) needs a counter written by the hooks (any change to `~/.claude/hooks` or settings is the owner's own yes); layer 5 (bugs the owner saw) reads GitHub issues and Sentry. Attribution of a late red to the PR that caused it is a heuristic (about ±10 points), labelled on the page.
- Own spec and preview, after v1's uploads have run for a few days.

## Tests (named files only)
- `jobadabra-web/test/admin/agent-coding.test.js`: ingest key/shape/clamp/replace, page empty state and rendered cards, escape of strings, menu entry, headline.
- `jobadabra/tests/gate-stats.test.mjs`: form/real/other classes from a fixture log, steps bucketed, no branch text in the output; stamp file once a day; no key = no upload.
- `jobadabra/tests/agent-coding-stats.test.mjs`: weekly bucketing, fix-commit join, area counting with the 3+ flag, queue/wall minutes, from recorded input (`--runs`, `--prs`) so no network.
- A workflow-contract test entry for the new workflow (existing `tests/test_workflow_contract.py`).

## Progress
- [x] Owner decision and exceptions recorded (above) (proof: docs/superpowers/specs/2026-11-01-agent-coding-page-design.md)
- [x] Read pr-checks page, scorecard tool and prune-audit scripts (proof: none: reading leaves no file)
- [x] Upload path agreed: B, once a day from ship.sh (owner, 1 Nov 2026: "Once a day from ship.sh (Recommended)") (proof: tools/gate-stats-upload.mjs)
- [x] Spec written (this file) (proof: docs/superpowers/specs/2026-11-01-agent-coding-page-design.md)
- [x] Page, ingest, table and demo seed built in `jobadabra-web` (proof: none: the code is in the jobadabra-web PR #248)
- [x] Preview (fictional data, desktop | phone) and owner's yes ("Yes, build it (Recommended)") (proof: none: the owner's answer, relayed by mac-07; the image is in the web PR)
- [x] `jobadabra-web` PR opened: ingest, table, page, menu, tests (Operations row limit 8 → 9, owner pick) (proof: none: jobadabra-web PR #248)
- [ ] `jobadabra` PR: `tools/gate-stats.mjs` + uploader + `tools/agent-coding-stats.mjs` + workflow + tests
- [ ] Menu split into 🧪 Testing and 🤖 Agents (own web PR after this one; owner pick "2 groups")
- [ ] v2: the SDLC tab (own spec and preview, designed on real numbers)
- [ ] Both PRs READY (checks green, Gitar approved, no open comment)
- [ ] First upload and first CI run seen on the live page
