# Test stages: the 5 PRs of the stages sketch

> **Verdict:** the owner said "Yes, all 5 (Recommended)" on 1 Nov 2026 to the test-stages sketch. The beta is where the time goes (68 of 90 by-hand betas and 16 of 21 nightly betas red in 24 days, median 30.6 min); each PR below moves a check to the stage that proves it, or fixes the stable canary.

## Progress

- 1/5 folded into 4/5: main has no Mac unit run (c27-test-stages, build.yml run 41254459746); the beta's Mac unit step stays until a beta reuses the night's build with its unit results
- [x] 2/5a The journey registry: `desktop/e2e/critical-journeys.json` holds the critical journeys (J0-J2, J4-J12 and the tier additions J14-J18; J3 "Find jobs using your browser" is out: owner, 1 Nov 2026, "this is not critical" and "Move all 3 to integration") and the safety or data steps kept in their own group; a test checks every registry step exists in its suite (a rename fails it). Each journey has a tier (owner's test for tier 1: "it blocks the user's flow"): tier 1 runs after every merge and blocks the beta, tier 2 runs only in the night burn-in, reported, never blocking; the test requires a tier on every journey. NOT built, replaced by the owner's later answer (exact option "No e2e on PRs (Recommended)", "I'd like to avoid e2e at the PR at all / Cause they're very slow"): a `desktop/e2e/lib` change running every journey on its PR, and five first-try PR legs for a changed safety or data step. PRs run unit + integration only; the journeys run after each merge on main (main-steps.yml, a red merge reverted by e2e-revert.yml), and the night burn-in repeats them. (proof: desktop/e2e/test/critical-journeys.test.mjs @3324063)
- [ ] 2/5a-2 PRs run no e2e (owner, 1 Nov 2026, exact option "No e2e on PRs (Recommended)": "I'd like to avoid e2e at the PR at all / Cause they're very slow"): `pr-suites.yml` is deleted and the PR verdict no longer waits for an e2e run; journeys run after each merge (`main-steps.yml`), a red merge is reverted. The code that only read PR e2e runs is left for the cleanup PR (jobadabra-0d).
- [ ] 2/5b After the move PRs (#2766, #2763, #2770) merge: the beta runs only the registry's suites (the other suites move to the night; measured: e2e job-minutes per beta 151-161 → 77-87), and a guard fails when an e2e step is in no registry entry.
- [ ] 3/5 The night drops its 3 scheduled "E2E check" runs, after 3 green burn-in nights (measured: 56-107 wall min a night)
- [x] 4/5 Dropped: #2772 is closed; the owner reversed "only on a proved commit" (1 Nov 2026). A beta starts on any commit again (proof: none: dropped, nothing was built; #2772 closed unmerged)
- [ ] 5/5 The stable canary says what its red is, instead of crashing (the verdict script had no checkout; the workflow's own tools come from its own commit; a guard loops over every workflow)

Decided, 1 Nov 2026 (owner, as relayed by the coordinator):
- Betas: "Safety strict, rest tolerant" and "Auto-retry in betas only" (slot 2's PR: a beta retries a non-safety step once and releases, listing it; safety and data never retry).
- A PR runs each e2e step once: PR step burn-in and suite admission are dropped (owner, exact option "Drop it entirely, now"; PRs #2773 and the admission PR). The five first tries for journey steps that 2/5 was to bring back are not built either: the owner chose "No e2e on PRs (Recommended)"; repeats are the night burn-in's.

Decided (owner, 1 Nov 2026, exact option "A: keep running to the end (Recommended)"): a red beta by hand still runs to the end and its reds are fixed in one batch; no PR stops a beta at its first red.

Where the numbers come from: the 141-row inventory of every check by stage (GitHub runs and jobs, the push gate's own log), 1 Nov 2026. A median of 3-6 sampled runs is indicative, not exact.
