# Test stages: the 5 PRs of the stages sketch

> **Verdict:** the owner said "Yes, all 5 (Recommended)" on 1 Nov 2026 to the test-stages sketch. The beta is where the time goes (68 of 90 by-hand betas and 16 of 21 nightly betas red in 24 days, median 30.6 min); each PR below moves a check to the stage that proves it, or fixes the stable canary.

## Progress

- 1/5 folded into 4/5: main has no Mac unit run (c27-test-stages, build.yml run 41254459746); the beta's Mac unit step stays until a beta reuses the night's build with its unit results
- [ ] 2/5 The beta runs 12 journeys (J3 "Find jobs using your browser" is off the beta: owner, 1 Nov 2026, "this is not critical" and "Move all 3 to integration"); the other suites move to the night (measured: e2e job-minutes per beta 151-161 → 77-87). A PR that changes `desktop/e2e/lib` runs every journey suite (owner, 1 Nov 2026: "Yes, all 13 journeys")
- [ ] 3/5 The night drops its 3 scheduled "E2E check" runs, after 3 green burn-in nights (measured: 56-107 wall min a night)
- [x] 4/5 Dropped: #2772 is closed; the owner reversed "only on a proved commit" (1 Nov 2026). A beta starts on any commit again (proof: none: dropped, nothing was built; #2772 closed unmerged)
- [ ] 5/5 The stable canary says what its red is, instead of crashing (the verdict script had no checkout; the workflow's own tools come from its own commit; a guard loops over every workflow)

Decided, 1 Nov 2026 (owner, as relayed by the coordinator):
- Betas: "Safety strict, rest tolerant" and "Auto-retry in betas only" (slot 2's PR: a beta retries a non-safety step once and releases, listing it; safety and data never retry).
- A PR runs each e2e step once: PR step burn-in and suite admission are dropped (owner, exact option "Drop it entirely, now"; PRs #2773 and the admission PR). Journey steps get five first tries back later, in 2/5 (owner, "Yes, journeys only (Recommended)").

Decided (owner, 1 Nov 2026, exact option "A: keep running to the end (Recommended)"): a red beta by hand still runs to the end and its reds are fixed in one batch; no PR stops a beta at its first red.

Where the numbers come from: the 141-row inventory of every check by stage (GitHub runs and jobs, the push gate's own log), 1 Nov 2026. A median of 3-6 sampled runs is indicative, not exact.
