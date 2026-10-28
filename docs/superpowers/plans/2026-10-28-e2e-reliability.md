# E2E reliability plan

Spec: [2026-10-28-e2e-reliability-design.md](../specs/2026-10-28-e2e-reliability-design.md) (rules A–L, states, acceptance criteria).

> [!NOTE]
> **Order:** measure in one place first (so every later step shows a before → after), then make a PR red mean "the diff" (lanes, rules E and F), then move the
> noisiest suites to the backbone/tolerant split, then delete what the design replaced. One concern per PR; every PR names who gets what (owner's "No outcome,
> no PR"); every e2e suite green on main stays green on each PR (CLAUDE.md "CI files: no freeze").

## Steps
Each step: tests first (watch them fail), then the change, then `tools/ship.sh --background`. Site steps land first when both repos change ("Private reads
public, never the reverse").

### 1 · Measure in one place (site first, then public)
- **Outcome:** the owner reads one set of numbers (causes, scorecard, where e2e work goes) on /admin/operations/e2e, in Telegram and in one weekly issue.
- `jobadabra-web`: `admin/e2e-causes.js` stays the only classifier; `jobs/e2e-intel.mjs` also stores per suite the catches, false reds and minutes (rule I) and
  the weekly commit split product / expectations / plumbing / other e2e + area circles (rule J); `admin/e2e-page.js` draws the scorecard and the
  "Where e2e work goes" card; the weekly job posts Telegram + the GitHub issue from the snapshot. Tests: `test/admin/e2e-*.test.js`.
- Public: retire `tools/e2e_weekly.py` and `.github/workflows/e2e-weekly.yml` once the site posts the issue; `tools/e2e_bisect.py` keeps only its fact check
  for "environment red, don't bisect" (credit, runner), no second cause list.
- Notion Bug Tracker: add the "escaped e2e" field (Notion MCP); the scorecard reads it for the gap ranking.
- Proof before → after: the page's counts equal the issue's and Telegram's for the same week.

### 2 · Lanes and the PR verdict
- **Outcome:** a PR is red only when a backbone check its diff reaches failed; health shows grey; at most 5 suites per PR.
- `desktop/e2e/lanes.json` (new): every suite → `backbone` | `tolerant:ai` | `tolerant:clock` | `tolerant:outside` | `retired`. Start: every suite `backbone`
  except the ones step 4–6 move.
- `desktop/e2e/pr-suites.mjs` + `desktop/e2e/lib/test-reach.mjs`: never pick a non-backbone suite; above 5 reached suites pick by the scorecard (step 1 data,
  a committed snapshot so the pick is deterministic), the rest listed as "runs after merge".
- `tools/pr-verdict.py`: AI credit, runner, install and picker failures are grey ("didn't run", reason), never red.
- Suspension (spec state): read from the classifier's flips; a suspended suite runs but never blocks.
- Tests: `desktop/e2e/test/pr-suites*.test.mjs`, `tests/test_pr_verdict*.py` (a credit failure is grey; a tolerant suite never picked; 7 reached → 5 picked).

### 3 · Expectation rule, plumbing brake, Gitar
- **Outcome:** "make it green" can no longer loosen a backbone test or patch plumbing without a named reason.
- `tools/expect-check.mjs` (new, pure, run by `tools/pre-push-check.sh` and CI fast checks): finds changed expectations, skips, deletions and lane moves in
  backbone suites; needs `Expect-changed-by:` or `Test-was-wrong:` (rule E). Harness files need `Harness-job:` or `Fixes-backbone-red:` (rule F).
- `Job:` line in every `.github/workflows/*.yml` and `desktop/e2e/lib/*.mjs` (the inventory of rule L, one pure commit), guarded by a test.
- `.gitar/review/e2e-reliability.md` (new) + a line in `.gitar/config/approve.md`; the 2-round cap stated there (rule K).
- CLAUDE.md "CI files" line points to rules E and F (owner's yes is this spec's approval).
- Tests: fixtures replaying `5395279` (refused) and `2625cef` (passes with its citation); a harness PR answering a tolerant result (refused).

### 4 · quality, cut at the seam
- **Outcome:** quality's 12 catches stay on PRs; its 31 AI/CI reds leave them.
- Backbone: stored answers by question for the app's and the judges' calls (rule A, extends #2210's replay); "the app stores and shows what the AI said".
- Tolerant `ai`: the live night (`desktop/e2e/lib/quality-rate.mjs`) as a rate vs main's band; a PR touching what reaches a prompt gets the number in its check
  summary (rule D), never a comment.
- `desktop/e2e/lib/ai-proxy.mjs`: in backbone mode an unstored question fails the asking test; 0 live calls asserted (`desktop/e2e/test/ai-meter.test.mjs`).
- Cost stated before the first live night that adds volume.

### 5 · applyflows
- **Outcome:** its 24 test-noise reds go; its 4 catches stay.
- Wall-clock asserts → state waits + hang cap (rule B); the 7-minute "split the suite" message removed; Notion stubbed (rule C).
- Each same-commit flip found becomes an owner issue (suspension), not a looser test.
- Guard: no wall-clock assertion in a backbone suite (`desktop/e2e/test/backbone-no-clock.test.mjs`, new).

### 6 · settings, apply, then the rest by scorecard
- Same moves as 4–5. Zebra Wrangler (strategy) is cut at the seam: backbone "kept when the AI says keep", tolerant "the AI says keep".
- The 9 suites with no catch in 3 weeks go to the owner as prune candidates on the weekly summary, not deleted by a session.

### 7 · Beta gate, speed, outside world
- `tools/beta-release.sh` / `desktop.yml`: the tolerant AI rate below main's band blocks the beta (fixture night test).
- Speed medians (Find jobs ≤ 3 min, Focus ≤ 20 s) in the weekly summary; one nightly outside-world suite with real Notion.

### 8 · Revert, don't fix forward
- A backbone red after merge opens a revert through `tools/revert-red.sh` (the owner merges it); the red-PR hook tells the PR's session to re-land with a fix.

### 9 · Cheapest place
- `tools/pre-push-check.sh` runs the pure tests whose files changed (renderer class tests: no-question-mark, solid-buttons; #2322); never a browser or e2e.

### 10 · Shrink
- From the step-3 inventory: delete what is replaced (AI cache 3-day expiry + live fallback, `desktop/e2e/lib/flaky-proof.mjs` retry/intermittent paths,
  duplicate classifier, unused workflows), one pure PR each, module count before → after in each PR.

### 11 · Read the result
- 14 days after step 6: the acceptance numbers from the J card and the scorecard, reported to the owner; a miss reopens the design, never a patch.

## Dependencies and review focus
- Step 1 before all (baseline). Step 2 before 4–6 (lanes exist). Step 3 any time after 2. Steps 4–6 one suite family per PR, quality first.
- Review: a tolerant result that still reaches a PR check or a hook; a backbone run that still calls live AI; a stored answer keyed by prompt bytes; a rule
  that a trailer alone satisfies without a real citation (the check verifies the cited commit touches product code the test covers).
