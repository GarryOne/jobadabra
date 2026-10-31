# Predictable beta: a night burn-in, then only proven steps block

Owner, 31 Oct 2026: "I want predictability. If a test was green last time, it should be green this time as well, if the code didn't change on that area." Chosen: burn in all steps once; only proven steps block; spread the 5 burn-in passes over the night at different hours. Then: "Beta blocks only on your safety steps + steps proven ≥99.5% in night burn-in; every other suite runs, shows red, opens an issue, never blocks." Spec rows 37-39 (`docs/superpowers/specs/2026-10-28-e2e-reliability-design.md`, section 15).

## PRs
1. **Night burn-in**: five full e2e passes a night (21:00, 23:30, 01:30, 03:30, 05:30 UTC) on the Worker's ten-minute trigger, each the beta's own layout (every gate suite, both stores, Windows following) on the commit of pass 1, no paid AI; every list of "runs that are not main's check" knows the new title.
2. **Only proven steps block a beta** (`a8-two-flaky-steps`): safety steps, a red on code changed since the step's last green, and a red on a step proven by ≥ 99.5% over ~200 runs on unchanged code block; every other red reports and opens an issue. It owns the history file and the one writer after each run.
3. **After the first full night**: one PR suspends the steps under the threshold (not safety ones) with their issues; fix briefs per cause.

## Progress
- [ ] 1/3 Night burn-in
- [ ] 2/3 Only proven steps block a beta
- [ ] 3/3 After the first full night
