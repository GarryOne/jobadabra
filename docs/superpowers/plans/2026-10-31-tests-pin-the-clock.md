# Tests and e2e stop depending on the day

Owner, 31 Oct 2026: "No test reads the real date/clock unpinned; add a guard for new ones." A calendar suite went red on one day of the year (#2718); the measurement that followed moved the clock under 94 unit test files and found 4 that flip.

## PRs
1. **Tests no longer read the real clock unpinned, with a guard**: the 4 flipped files fixed at their cause; `tools/unpinned-clock.mjs` with a debt list that only shrinks.
2. **E2E pins the app's clock**: `JOB_PILOTTO_NOW` read by `desktop/lib/clock.js` and `src/clock.py`, plus the date shift for calendar, interviews and any suite the flip list names. The real clock stays the default.

## Progress
- [x] Calendar date picks proven for every day of the year (#2728) (proof: desktop/e2e/test/interview-data.test.mjs @3531606)
- [ ] 1/2
- [ ] 2/2
