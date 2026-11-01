# Prune audit plan (1 Nov 2026)

**Verdict:** the audit found most push-gate stops are form, not bugs; the owner approved a delete group and three merges. Sketch: https://claude.ai/artifact/TvZA9Kd6WY8XtbXmP4bVqC

Owner, 1 Nov 2026: "Yes, delete Group 1 (Recommended)"; "First 3 rows (Recommended)"; "Yes, list them (Recommended)" (trailers table, read-only). The other five Group 2 rows are not approved. The freeze holds: no new check.

## Progress
- [ ] 1/4 Group 1: pr-gate step that cannot fail, "new e2e steps" and JS architecture off the local push, 4 one-off workflows, 3 uncalled tools
- [ ] 2/4 Nine trailer and comment checks become one commit-message check that lists every refusal together (every rule stays)
- [ ] 3/4 The workflow-paths family of 5 checks becomes 1
- [ ] 4/4 The three ratchets (`timing`, `ai-misses`, `replay`) become one baseline file
- [ ] Read-only: a table of each trailer rule, its stops in 30 days, its real catches and its origin; the owner decides per rule

## Rules for each PR
- One PR per item through `tools/ship.sh`; its body names the guard's last real catch ("none in 30 days" where true).
- Safety steps and critical journeys are never touched.
