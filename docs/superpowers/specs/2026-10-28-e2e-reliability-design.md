# E2E reliability: a stable backbone, tolerant suites, no fix circles

> [!NOTE]
> **Verdict (28 Oct 2026, designed with the owner in session `fl`):** a PR goes red only when its diff broke something, deterministically. Everything that is
> non-deterministic by nature (the AI's answer, the clock, the outside world) leaves the PR gate for tolerant suites that report a rate, never a red, and never
> ask a session for a fix PR. Rules a machine checks (the expectation rule, the plumbing brake) stop the "make it green" circles; a scorecard keeps the suites
> that catch bugs and drops the ones that don't. Plan: [2026-10-28-e2e-reliability.md](../plans/2026-10-28-e2e-reliability.md).

## Intent
The owner, 28 Oct 2026: *"I want to fix this flakiness, but treating this quickly, from a prompt, didn't seem to work so far… I'm going in circles with this
topic and it's never ending."* And: *"the flakiness and AI trying to fix it endlessly with tens of PRs I think is our nr1 problem. We lose more time to
fix/maintain the e2e than we benefit out of them."* The app and its tests are vibe-coded: AI writes every line, and when an e2e fails the owner says
"fix the red, make it green". So the design protects against what AI does with a red, not only against bugs.

**First principle:** in a human team a flaky test gets ignored; with agents a flaky test gets *fixed*, and every false red spawns a PR. The backbone aims at
zero false reds.

## Measured baseline (14 Oct – 28 Oct 2026)
| Number | Value | Source |
|---|---:|---|
| Red e2e runs | 149 (PRs 55 of 413) | D1 `e2e_fails`, /admin/operations/e2e |
| … of them a product bug | 19 (13%) | same, cause `product` |
| Biggest causes (runs) | AI 45 · flake 35 · unknown 33 · not fixed 32 · picker 15 | same |
| Commits touching harness, workflows, ship | 847 of 2,298 (37%) | `git log` |
| … of those, suite files (expectations) | 84 (10%) | same |
| … plumbing only (workflows, lib, tools, test-sets) | 604 (71%) | same |
| `e2e.yml` changes | 64 (≈4.5 a day) | same |
| Harness size | 753 e2e code files (284 lib, 327 self-tests, 31 suites), 69 workflows, 215 tools | `git ls-tree` |
| PRs running ≤ 5 suites (21–28 Oct) | 154 of 170 (91%) | e2e.yml run names |
| The CI freeze (27 Oct) | harness PRs 41% before, 43% after: no effect | coordinator |

<details><summary>What the measurement changed in the brief</summary>

- Both 27 Oct flakes were **not AI**: the fill check replays recorded pages with each case's stored answers (a race among 4 tabs); `test_ship_pr` hit a
  90 s subprocess timeout with 6 shards running.
- Most flake and timing reds read "the suite's 7-minute budget ran out (… split it)" or "Timeout 30000ms": a wall clock on a shared runner, and the message
  itself tells the next session to restructure workflows.
- A live AI keep/drop judgment ("keeps the Zebra Wrangler posting", strategy) was red on 8 betas and Windows runs, 17–28 Oct, owned by no gate.
- Suites sharing one real Notion workspace fail with "Notion did not connect" (storemove, failuresnotion).
- Two classifiers name the same reds differently: `tools/e2e_causes.py` (133 of 176 rows "check-failed") and `jobadabra-web/admin/e2e-causes.js`.
- Since 27 Oct ("Code gate + AI rate") the quality gate replays its AI answers: 3 quality AI reds on 27 Oct, 0 since.
- Product catches per suite, 7–28 Oct (195 red runs, 39 product): quality 12, apply 9, settings 6, failuresnotion 5, applycv 5 of 7 reds (most precise),
  applyflows 4 against 24 test-noise reds (noisiest). 9 suites caught nothing: interviews, recorded, focusdismiss, foryou, harness, updates, notion, pool, visitsauto.
</details>

## Design: states, their one owner, the verdicts that change them
A **check** (an e2e suite, later a step) is in exactly one state:

| State | Runs where | Its result | Owner of the state |
|---|---|---|---|
| **backbone** | PR (≤ 5 picked), main after merge, nightly, before beta | red / green; red = the diff | lane registry `desktop/e2e/lanes.json` |
| **suspended** | as backbone, never blocks | shown, counted, an owner issue | the one classifier's data (D1 `e2e_fails`) |
| **tolerant · ai / clock / outside** | main nightly, before beta; never on a PR | a rate vs main's baseline band | lane registry |
| **retired** | nowhere | kept in history | lane registry |

A run of any check can end **grey** ("didn't run": AI credit, runner lost, install, a step the picker named that does not exist). Grey is health, never red; it
has one owner (the coordinator's round-up) and never asks the PR's session for anything.

Verdicts that change a state (nothing else does):
- **backbone → suspended:** the classifier sees the check red then green on the same commit (a flip). Automatic, visible on the weekly summary with an owner
  issue. It is a bug (product or test race), never a reason to loosen the test. **suspended → backbone:** a PR that names its fix lands and the check passes
  main's next 3 runs.
- **backbone → tolerant:** a PR that names the non-deterministic input (`ai`, `clock` or `outside`) the test depends on. It is an expectation change (rule E).
  A test that cannot name one stays in the backbone: our own races are bugs, not tolerance.
- **any → retired:** the scorecard lists it (90 days, 0 catches, ≥ 1 false red) and the owner says yes on the weekly summary.
- **PR verdict:** red only from a backbone check the diff reaches; grey for health; tolerant results never appear as a check result.
- **Main red after merge (backbone):** revert, don't fix forward (`tools/revert-red.sh`); the PR comes back with its fix. The owner merges the revert.
- **Beta:** blocked when a tolerant AI rate is clearly below main's baseline band (the owner: "high reliability of my app for the beta").

## The rules
**A · AI answers.** In the backbone every AI call (the app's and the judges') is answered from answers stored with the test, keyed by the question
("page kind → form", "score → 82"), never by prompt bytes. No live AI call in a backbone run. A question with no stored answer fails the test that asked it:
a test bug, the PR's to fix. The gate tests "given the AI says X, the app does Y". A test that mixes both is **cut at the seam**: backbone "the app keeps
what the AI said keep", tolerant "the AI says keep".

**B · Clock.** Backbone steps wait on state (the row exists, the fill ended) with a cap of about 3× main's p95 that only catches hangs. No wall-clock limit is an
assertion in the backbone. User promises (Find jobs ≤ 3 min, Focus ≤ 20 s) live in the `clock` lane: the median of main's nightly runs vs the promise.

**C · Outside world.** Real Notion, the AI key's credit, real websites and runners are `outside`. The backbone stubs Notion; real Notion runs in one tolerant
outside-world suite, nightly and before beta.

**D · Where results are seen.**
| Where | What |
|---|---|
| A PR | backbone checks only; for a PR that changes what reaches the AI or a timed path, a **number in the check summary** ("AI rate 84%, main 86%, within noise"; "Find jobs 2m40, main median 2m10"), never red, **never a PR comment** (the owner's rule makes every comment a task) |
| Main, nightly | /admin/operations/e2e: one tolerant section (AI rate, speed medians, outside-world health) |
| Before a beta | tolerant rates decide with the baseline band |
| Weekly | Telegram + one GitHub issue, same numbers as the page, one decision for the owner if any |

**E · The expectation rule.** A PR that changes what a backbone test expects (an expected value, a threshold, a tolerance, a wait), or skips, deletes or moves a
backbone test to a tolerant lane, carries one of:
- `Expect-changed-by: <sha or the owner's request>`: the deliberate behaviour change (`2625cef` → `e2d7df8` passes);
- `Test-was-wrong: <why>`: shown to the owner in the PR summary.
Without one the PR cannot go green. A real fix in product code leaves the test untouched and never meets this rule. `5395279` ("allowance for model noise
(1 in 9)") is the case it refuses.

**F · The plumbing brake.** Every workflow and e2e harness module carries one `Job:` line naming which of the design's jobs it does (run the backbone, serve
stored answers, wait on state, pick the suites, run tolerant suites as rates, keep the scorecard, report health). A harness PR carries `Harness-job: <job>`
or `Fixes-backbone-red: <run>` (a backbone red seen twice on the same commit). A PR that answers a tolerant result, a red already gone, or names no job cannot
go green. Legitimate plumbing (a runner image, a new suite) names its job.

**G · Budget and picking.** A PR runs at most 5 suites, in parallel, within about 10 minutes. When a diff reaches more, the scorecard picks the 5 that caught the
most bugs for the files it touches; the rest run on main after merge. 10–20 suites run only on main, scheduled, or before a beta. Suites compete for the
budget: a new suite earns its place by covering a gap better than one already there.

**G2 · A suite is a journey; a PR runs it whole.** (owner, 28 Oct 2026: "journeys … I'm fine with that. I agree".) A step stands on the steps before it, so a PR never
runs a step alone: #2342's "Edit target" had no target, #2350's "Up next" no earlier state (15 of 149 red runs were picker reds). After a merge the picked steps still
run. A red names the first failing step; later ones did not run. Every PR suite job is under 8 minutes on a green run (medians 3.9–7.5 min, 28 Oct); a suite that
passes 8 is cut in two by journey, never picked. `recorded` is not run on PRs (page-cases.yml replays those cases there). Code: `lib/pr-suites.mjs stepLists`.

**G3 · A local run reaches nothing of the owner's.** (owner's safety rule; 28 Oct 2026: an interactions run put ch.indeed.com in their Chrome three times.) Every way the
app reaches the owner's computer is closed for every suite where the app starts, and asserted before step 1; a run that finds one open stops. The doors today: `open` on
PATH (`makeOpenShim`, `opensIntoSpool`, #2362), Electron's `shell.openExternal`, `openPath`, `showItemInFolder`, the clipboard and login items (`desktop/lib/e2e-host.js`,
checked by `lib/app.mjs`), the browser profile and backup folder (`openContext`), the Keychain (a step compares it before and after). CI cannot show an open door (a runner
has no owner's browser), so the check is at run start and a class test lists every host call in the app (`test/e2e-host.test.js`): a new call is a door or on its reviewed
list in the PR that adds it. Re-running a repro of a door incident locally waits until its door is closed, and the spool says what the app tried to open.

**H · Cheapest place.** A pure check that runs in seconds (no browser, no app, no e2e) runs on push when its files changed (`tools/pre-push-check.sh`); a CI red
that push could have caught is a harness bug (#2322: no-question-mark, solid-buttons). E2E suites never run on the Mac except one: fixing a real backbone red,
that one suite or step (the owner's memory is tight).

**I · One classifier, one scorecard.** The site's `admin/e2e-causes.js` (rules v3) is the only cause classifier; the weekly issue, Telegram and the page read
its data. The scorecard per check: catches (red, then the fix changed product code), false reds (red on the backbone for any other cause), minutes. Gaps:
the Bug Tracker gets an "escaped e2e" field for bugs found while e2e was green; the journeys with most escapes get the next tests.

**J · Where e2e work goes.** A card on /admin/operations/e2e, per week: commits split into product / test expectations / plumbing / other e2e, against the owner's
target of plumbing under 15%, plus fix PRs per harness area within 7 days (`tools/area-circles.mjs`). Same numbers in the weekly summary.

**K · Gitar too.** `.gitar/review/e2e-reliability.md` holds E, F and "tolerant results never get a fix PR"; the mechanical gates enforce the same, whatever Gitar
says. On one finding, after 2 rounds of disagreement with Gitar the session answers in the thread and the owner decides.

**L · Harness inventory, then shrink.** Every workflow and harness module is labelled needed (does a design job), replaced (the design's version supersedes it:
deleted when that lands) or neither (deleted). Likely early deletions: the AI cache's 3-day expiry and live fallback, the retry/intermittent machinery, the
"split the suite" advice, the second classifier. Each step keeps main's green suites green.

## Constraints and non-goals
- No retry that hides a symptom; suspension says plainly "this check does not protect you now" and has an owner.
- No rewrite in one PR; no new gate beyond those named here; no local e2e loops; the product's behaviour does not change.
- Live-AI checks cost money: any new nightly/pre-beta live volume states its measured cost first (CLAUDE.md "Ask before spending").
- Public repo never reads the private site's code; the weekly issue and Telegram come from the site's job (private reads public).

## Acceptance criteria
- 14 days after the backbone lands: **0** PR reds whose cause is not the diff (AI, flake, timing, picker, credit, runner, CI show grey or nowhere).
- Plumbing commits **under 15%** of all commits per week (37% harness / 26% plumbing-only at baseline), read from the J card.
- A PR runs **≤ 5 suites** and its e2e finishes in **≤ 10 min** at p90.
- A backbone run makes **0 live AI calls** (the AI proxy refuses an unstored question there and the test fails, asserted by a harness test).
- No backbone suite asserts a wall-clock limit (guard test over the backbone suites).
- The expectation check refuses a replay of `5395279` and passes `2625cef` with its citation (fixture test); the plumbing check refuses a PR answering a
  tolerant result (fixture test).
- /admin/operations/e2e, the weekly GitHub issue and Telegram show the same counts from one classifier.
- Tolerant suites never appear as a PR check result; a beta run is blocked by an AI rate below main's band (tested with a fixture night).
- The scorecard lists catches, false reds and minutes per suite; prune candidates and gap ranking appear in the weekly summary.
- Every workflow and e2e lib module has a `Job:` line; the module count is measured before and after each shrink step.

## Progress
- [x] Measured 14 days of reds by cause, harness churn, suites per PR. (proof: none: numbers in this spec, from D1 and git on 28 Oct 2026)
- [x] Design discussed and approved by the owner in session `fl`. (proof: none: the owner's answers in the session, 28 Oct 2026)
- [ ] 1 · Measure in one place: one classifier, scorecard, "Where e2e work goes" card, weekly Telegram + issue, Bug Tracker "escaped e2e".
- [ ] 2 · Lane registry; PR verdict red only from backbone; grey for health; ≤ 5 suites picked by the scorecard. Landed: main's own red is grey (#2349); a PR runs each picked suite whole (G2).
- [ ] 3 · Expectation rule + plumbing brake (mechanical + `.gitar/review/e2e-reliability.md`), `Job:` lines on every workflow and harness module.
- [ ] 4 · quality cut at the seam: stored answers by question in the backbone; AI rate tolerant; the PR's AI number in the check summary.
- [ ] 5 · applyflows: state waits + hang caps, Notion stubbed, its races as owner issues.
- [ ] 6 · settings and apply the same way; then the rest by scorecard.
- [ ] 7 · Beta gate on tolerant rates; speed medians in the weekly summary; outside-world suite nightly.
- [ ] 8 · Revert-don't-fix-forward wired to a backbone red after merge.
- [ ] 9 · Pure checks on push by changed files (#2322 class).
- [ ] 10 · Harness shrink: delete what the design replaced, one step at a time.
- [ ] 11 · 14 days after step 6: acceptance numbers read from the J card and the scorecard, reported to the owner.
