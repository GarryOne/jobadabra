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

**E · The expectation rule.** A PR that changes what a backbone or tolerant test expects (an expected value, a threshold, a tolerance, a wait), or skips, deletes or moves a
backbone test to a tolerant lane, carries one of:
- `Expect-changed-by: <sha or the owner's request>`: the deliberate behaviour change (`2625cef` → `e2d7df8` passes);
- `Test-was-wrong: <why>`: shown to the owner in the PR summary.
Without one the PR cannot go green. A real fix in product code leaves the test untouched and never meets this rule. `5395279` ("allowance for model noise
(1 in 9)") is the case it refuses.

**F · The plumbing brake.** Every e2e workflow (the list in `tools/e2e-reliability-check.mjs`; label, mail and site workflows have no e2e job) and e2e harness module carries one `Job:` line naming which of the design's jobs it does (run the backbone, serve
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
that one suite or step (the owner's memory is tight). A check earns its place on push only if it runs in seconds. Measured 28 Oct 2026 on #2367's change (420 desktop
unit-test files, 2459 tests): the affected unit tests take 108 s here (`node --test` 88 s, stage and lint about 15 s, the Mac loaded) against 2.3 min for CI's
`desktop (ubuntu)` job, so running them on a PR push saves about one CI round per red and costs 1–1.8 min on each of the day's 43 PRs. None of that day's 4 unit-test
reds was a direct importer (3 named the changed file in their text, 1 scanned the tree). Not done: the owner's 12 Oct rule (PR suites on CI) stands.

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

## PR plan
Named from the start (owner, 28 Oct 2026: "when we follow a plan, we should know from the beginning the name of the PRs"): each PR's title reads `[a8] n/29 <what it does>`, and its body carries a "Plan progress" block (done, this PR, left). The total moves only with a reason written in the PR that moves it.
**29 PRs: 13 merged, 16 to go** (this one included). Why the total is 29 and not 34: the owner chose to bundle by plan step (28 Oct 2026, answering "bundle by step?"), so 21 one-per-box PRs became 16. Two calendar items are no PR: the owner reads one week of the weekly summary; acceptance 14 days after step 6. Not counted: four PRs for the green beta, outside the plan (#2378, #2380, #2391, #2393).
Who builds what: the verdict session takes rows 16-17 and the push-checks session rows 15 and 18 (owner's yes, 28 Oct 2026); `fl` keeps the backbone itself and the rest.

| n | PR | Step | State |
|---|---|---|---|
| 1 | Spec and plan | 0 | ✅ #2336 |
| 2 | Grey a PR suite that fails exactly as main does | 2 | ✅ #2349 |
| 3 | A PR runs each suite whole | 2 | ✅ #2359 |
| 4 | Press only the control the probe vetted | 0 | ✅ #2360 |
| 5 | A local run records Electron calls | 7 | ✅ #2363 |
| 6 | Shell stand-ins in one place | 7 | ✅ #2367 |
| 7 | Changed files from git, not the API | 0 | ✅ #2369 |
| 8 | Scorecard and the "Where e2e work goes" card (private repo) | 1 | ✅ web#210 |
| 9 | Weekly Telegram message and GitHub issue (private repo) | 1 | ✅ web#211 |
| 10 | Lane registry first cut | 2 | ✅ #2376 |
| 11 | Plan checklist where the progress tool reads it | 0 | ✅ #2379 |
| 12 | A test app ends with its runner | 7 | ✅ #2384 |
| 13 | Rule E on lane entries | 2 | ✅ #2398 |
| 14 | Renderer class tests on push | 9 | ✅ #2400 |
| 15 | Rule E for test edits (citation check, Gitar review file) and rule F (`Job:` lines, harness-PR trailer) | 3 | 🔨 #2419 |
| 16 | Health greys: AI credit, runner, install | 2 | ✅ #2415 |
| 17 | At most 5 suites picked by reach, and the suspension tool for a red-then-green flip | 2 | 🔨 #2421 |
| 18 | `tools/revert-red.sh` wired to a backbone red | 8 | push-checks session |
| 19 | Stored AI answers keyed by question; no live AI call in the backbone | 4 | fl |
| 20 | quality cut at the seam; the AI rate as a number in the check summary | 4 | fl |
| 21 | applyflows: state waits, hang caps, Notion stubbed, races as issues | 5 | fl |
| 22 | settings the same way | 6 | fl |
| 23 | apply the same way | 6 | fl |
| 24 | The rest by scorecard (one PR here; counted when the scorecard lists them) | 6 | fl |
| 25 | Beta gate on tolerant rates, and speed medians in the weekly summary | 7 | fl |
| 26 | Outside-world suite nightly | 7 | fl |
| 27 | Bug Tracker "escaped e2e" field, and retire `e2e_weekly.py` after the first Monday post | 1 | fl |
| 28 | Harness shrink, first half (module count before and after) | 10 | fl |
| 29 | Harness shrink, second half | 10 | fl |

## Progress
One `###` per plan step, one box per thing that lands; a box is ticked only with the hash it landed in (`tools/ladder-progress.mjs --spec <this file>` draws the bars).

### 0. Measured, agreed, and fixed on the way
- [x] Measured 14 days of reds by cause, harness churn, suites per PR. (proof: none: numbers in this spec, from D1 and git on 28 Oct 2026)
- [x] Design discussed and approved by the owner in session `fl`. (proof: none: the owner's answers in the session, 28 Oct 2026)
- [x] Wander's probe presses only the control it vetted, not a stale id. (proof: desktop/e2e/test/interact.test.mjs @a0226a3)
- [x] A PR's changed files for page cases come from git, not the rate-limited API. (proof: tests/test_page_cases_workflow.py @ff10cbf)

### 1. Measure in one place
- [x] Scorecard and the "Where e2e work goes" card on /admin/operations/e2e. (proof: none: jobadabra-web test/admin/e2e-intel.test.js @e4ecceb, web#210, private repo)
- [x] Weekly Telegram message and GitHub issue from the site's one classifier. (proof: none: jobadabra-web test/admin/e2e-intel.test.js @bed82a7, web#211, private repo)
- [ ] Retire the public `tools/e2e_weekly.py` and `e2e-weekly.yml` after the first Monday post (bisect keeps only its fact check).
- [ ] Bug Tracker "escaped e2e" field.
- [ ] One week of the weekly summary read by the owner.

### 2. Lanes and the PR verdict
- [x] Main's own red shows grey on a PR. (proof: tests/test_pr_verdict_main_red.py @ecc6310)
- [x] A PR runs each picked suite whole (G2). (proof: desktop/e2e/test/pr-suites-whole.test.mjs @4ed6376)
- [x] Lane registry first cut (`quality`, `notion-real`): the verdict greys a tolerant or suspended suite, the registry read from the base branch (#2376). (proof: tests/test_pr_verdict_lanes.py @7eba931)
- [x] Rule E on edits to `lanes.json`: a named input and why, or the push is blocked (`tools/lanes-check.mjs`, run by the push script and the PR gate). (proof: desktop/test/lanes-check.test.js)
- [x] Health greys: AI credit, runner, install; the verdict names the reason (the install case is a reconstructed fixture: no recorded install red exists yet). (proof: tests/test_pr_verdict_health.py)
- [x] At most 5 suites on a PR, picked by how strongly the diff reaches them; the other reached suites run after the merge (rule G). (proof: desktop/e2e/test/pr-suites-cap.test.mjs)
- [ ] Catch-weighted picking: a PUBLIC snapshot of the scorecard feeds `pr-suites.mjs --catches` (the scorecard is private, so today's ties go to reach, then name; the site session owns the snapshot).
- [ ] Suspension: a red-then-green flip on one commit suspends the check, with an owner issue. The tool is built and dry-run by default (`tools/suspend-flip.mjs`, test `desktop/e2e/test/suspend-flip.test.mjs`); this box is ticked when a workflow calls it after a re-run.

### 3. Expectation rule and plumbing brake
- [x] Rule E: a PR that changes what a backbone test expects carries its citation (mechanical check plus `.gitar/review/e2e-reliability.md`). (proof: desktop/test/e2e-reliability-check.test.js)
- [x] Rule F: a `Job:` line on new/changed workflows and e2e harness modules; `Harness-job:` or `Fixes-backbone-red:` on a harness PR; untouched inventory stays in step 10. (proof: desktop/test/e2e-reliability-check.test.js)

### 4. quality cut at the seam
- [ ] Stored answers keyed by question in the backbone, not by request hash; no live AI call in a backbone run (asserted by a harness test).
- [ ] The AI rate is tolerant, with the PR's AI number in the check summary.

### 5. applyflows
- [ ] State waits and hang caps, Notion stubbed, its races as owner issues.

### 6. settings and apply
- [ ] settings the same way.
- [ ] apply the same way.
- [ ] The rest by scorecard.

### 7. The outside world
- [x] A test run reaches nothing of the owner's computer: one list of doors, checked at launch (G3). (proof: desktop/test/e2e-host.test.js @94d1931)
- [x] The shell stand-ins live in that one list only. (proof: desktop/test/e2e-hidden.test.js @2658e2c)
- [x] A test run leaves nothing running on the owner's computer: its app ends when the runner that started it is gone, even a killed one (owner, 28 Oct 2026, load 52: four orphaned test apps, 5 to 7 h at ~15% CPU each; added after the fact, the box should have come first). (proof: desktop/test/e2e-runner-watch.test.js)
- [ ] Beta gate on tolerant rates: an AI rate below main's band blocks the beta.
- [ ] Speed medians in the weekly summary.
- [ ] Outside-world suite nightly.

### 8. Revert, don't fix forward
- [ ] `tools/revert-red.sh` wired to a backbone red after merge.

### 9. Pure checks on push (rule H)
- [x] Measured the affected desktop unit tests on a PR push: 108 s here against 2.3 min in CI; not done, the owner's 12 Oct rule stands. (proof: none: measured 28 Oct 2026 with tools/check.sh on #2367, numbers in rule H)
- [x] The renderer class tests (no-question-mark, solid-buttons) run on push when a renderer file changes (#2322 class; seconds): seven files, 0.4 s, chosen from 34 measured reds. (proof: desktop/test/renderer-class-push.test.js)

### 10. Harness shrink
- [ ] Delete what the design replaced, one step at a time, the module count measured before and after.

### 11. Acceptance
- [ ] 14 days after step 6: the acceptance numbers read from the J card and the scorecard, reported to the owner.
