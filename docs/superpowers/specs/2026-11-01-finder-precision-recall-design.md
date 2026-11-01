# Finder: more real bugs, fewer false ones (tg's 4 recommendations, measured first)

> **Verdict:** measured on origin/main `47580bb`, 2 of the 4 recommendations in tg's triage report (§7) are mostly done already. The value left is recall:
> `mutants.json` is empty since the 1 Nov integration moves, so /self-heal's "Planted code bugs caught" has no bugs to count. Plan: 3 PRs, with no new gate and no AI spend.

**Owner's words (1 Nov 2026):** "https://claude.ai/artifact/J28raLPjNjvx3YSsYcZ144 let's start an Opus session to do the recommendations": the yes to tg's §7, item 4 included
(mac-07, 1 Nov 2026: "the freeze does not hold it. Keep it report-only: no new gate, no schedule").
**Who gets what:** the owner gets a recall figure on /self-heal again (n of 12 planted code bugs caught, where it now shows nothing), and the layout checks' closed
mistakes become tests, so a rule change that brings one back fails on its PR.
Sketch: https://claude.ai/artifact/2awFgSdXeAY4oLvpdkKxau

## The 4 items, measured

### 1. Failed test steps, 28% precision: no code (dropped, mac-07 1 Nov 2026)
- 28% is an all-time figure: 7 real, 18 false. All 18 false ones were filed 3–11 Oct. Since 12 Oct the detector filed 9: 3 real, 0 test mistakes, 6 not seen again.
- Causes of the 18: 6 a step expected the old screen after a deliberate change, 6 test data or environment, 5 read too early, 1 the probe pressed Restart.
- On main: **0 of 18 can happen again**. 5 are fixed in a test still on e2e (#76 `d3e984c`, #75 `547a444`, #78 `d948d1c`, #350 #484, #84 `0e9132f`), 11 moved to integration
  tests on 1 Nov (the Finder files nothing from those), and 2 steps no longer exist (#300, #305).
- `lib/signatures.mjs` learned none of them: it needs 3 closures with the same error text, and all 18 texts differ. A list of the 18 texts would never match a new mistake,
  and a "replay the 18" test would pass on main with no change, so there is no PR (rule "No outcome, no PR"). a8 has the table.

### 2. Layout and DOM checks, 42% precision: fixtures for every closed mistake ([fr] 1/3)
| Closed as a detector mistake | On main | Test |
|---|---|---|
| #288 rows of one list | rule since `0dae8ce` (5 Oct) | existed |
| #284, #281 page behind the open activity panel | rule since `0dae8ce` | #284 existed; **#281 added** |
| #282, #283 a card and its own log | rule since `b70232e` | existed |
| #1170 no icon rail at 80% zoom | fixed `0e909b2` (22 Oct) | existed (`narrow.test.mjs`) |
| #1169 late shift "first at span#activity-meta" | rule unchanged; the bar filling its words shifts the page by 0.0035, under the 0.05 bar | **added**, with a card pushing the page as the positive control |
| #1951, #1712 two email fields + news opt-ins | **not a mistake**: the owner judged the same pair real in #1711 and fixed it (`8e0d6e7`, 27 Oct) | **added as a real bug that stays caught** |

- The #2857/#2864 shapes are prose for the AI judges; the layout checks are code, so the same closed issues become fixtures, not prompt text, and no rule changed
  (no fixture fired on main). An exact repeat was never re-filed anyway (`fp:<id>` label).
- Data: #1951 and #1712 should carry `resolution:duplicate` (of #1711), not a false positive. With that: Layout precision 10 / 24 = 42% → 10 / 22 = 45% (all time).

### 3. Judge changes measured on 2 runs ([fr] 2/3)
One line where judge prompts change: the triage skill's step 4 and the `BY_DESIGN_SHAPES` Why in `desktop/e2e/lib/vision.mjs`: two review-eval runs, and a gain counts only
beyond the flips between them (about ±8 of 39). Memory `feedback-eval-bar-needs-noise` already holds it. No CI check.

### 4. Planted code bugs on unit and integration tests ([fr] 3/3, JOB-177)
- `mutants.json`: 12 mutants on 31 Oct, 2 at the last run (1 Nov 07:13, 0 caught: their e2e suites stayed green), `[]` on main. All 12 still apply to main's code.
- A mutant names a `test:` (a unit or integration test file) where it named a `suite:`. `mutation.yml` plants it, runs `node --test <file>` (seconds, not an e2e
  dispatch), red = caught, puts it back; each test also runs unplanted (red there = unknown). `mutation-result.json` keeps its shape, so /self-heal reads it unchanged.
- Each plant that no test catches gets one test that fails while it is planted (as #2879 did for failed-run-ticked). Report only: no new gate, the weekly schedule stays.
- Before → after: "Planted code bugs caught" 0 of 2 (and nothing from next Sunday) → n of 12.

## Progress
- [x] Measure the 4 items on origin/main (this spec, the sketch) (proof: docs/superpowers/specs/2026-11-01-finder-precision-recall-design.md)
- [x] Item 1: table to a8; no code (mac-07, 1 Nov 2026) (proof: none: a decision sent to a8 and mac-07, no file changes)
- [x] [fr] 1/3 layout fixtures (#281, #1169, #1711 pair) + this spec (proof: desktop/e2e/test/pool/uicheck.test.mjs @deb7e00)
- [x] #1951, #1712 relabelled `resolution:duplicate` (proof: none: GitHub labels the owner set on 1 Nov 2026; the scorecard reads Layout and DOM checks 42% to 45%, overall 53% to 54%)
- [ ] [fr] 2/3 the 2-run line in the triage skill and `lib/vision.mjs`
- [x] [fr] 3/3 planted code bugs on unit and integration tests; /self-heal shows n of 12 (proof: desktop/e2e/mutate-tests.mjs)
- [ ] Before/after precision and recall to mac-07
