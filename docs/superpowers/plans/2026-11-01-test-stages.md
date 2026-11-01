# Test stages: the 5 PRs of the stages sketch

> **Verdict:** the owner said "Yes, all 5 (Recommended)" on 1 Nov 2026 to the test-stages sketch. The beta is where the time goes (68 of 90 by-hand betas and 16 of 21 nightly betas red in 24 days, median 30.6 min); each PR below moves a check to the stage that proves it, or fixes the stable canary.

## Progress

- [ ] 1/5 The beta Build jobs skip "Unit tests · desktop app" when main's build.yml was green on the same commit (measured: Mac 9.5 min, Windows 4.1 min per beta)
- [ ] 2/5 The beta runs the 13 journeys; the other suites move to the night (measured: e2e job-minutes per beta 151-161 → 77-87)
- [ ] 3/5 The night drops its 3 scheduled "E2E check" runs, after 3 green burn-in nights (measured: 56-107 wall min a night)
- [ ] 4/5 A beta starts only on a commit the night proved and reuses its build: first a read-only spike (estimate 3-5 min, not verified)
- [ ] 5/5 The stable canary says what its red is, instead of crashing (the verdict script had no checkout; the workflow's own tools come from its own commit; a guard loops over every workflow)

The owner's open decision, not a PR: whether a beta stops at its first red journey (the repo rule says a red by-hand beta runs to the end).

Where the numbers come from: the 141-row inventory of every check by stage (GitHub runs and jobs, the push gate's own log), 1 Nov 2026. A median of 3-6 sampled runs is indicative, not exact.
