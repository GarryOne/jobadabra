# Activityfailures approved-design repair plan

> For agentic workers: use superpowers:executing-plans inline; do not delegate implementation. Owner continues applyflows.

**Goal:** Make the activityfailures backbone deterministic and ensure failed guards cannot be accepted as a timing retry.
**Architecture:** Reuse stored semantic answers, the suite runner/artifact writer, fake services, stand-in store and existing state poller. Preserve every behavioral assertion; move only inherently variable measurements to their existing proper seam when necessary.
**Spec:** docs/superpowers/specs/2026-10-28-e2e-reliability-design.md, rules A/B/C/E/F/G2/G3/H; owner follow-up /private/tmp/activityfailures-companion-redesign-followup.txt.
**Constraints:** No live AI, Submit, merge, forced beta, assertion weakening, blanket timeout increases, retry-until-green, new polling framework or broad harness refactor.

## Evidence and boundaries

1. **Truthful missing-answer proof (this PR).** Run 40996297795 on 5fe23fa had five missing decide-answer refusals after all steps. lib/suite-main.mjs wrote [] to suite-failures before checking those refusals; flaky-proof.mjs accepted the empty array after a clean retry. Keep post-close refusal collection (it catches late background work), record it as a failed harness step, then write final failure artifacts. Reject empty/unreadable first-try proof. Red-first tests exercise the real artifact writer and proof CLI; full CI/siblings after ship.
2. **Deterministic inputs/fault ownership (separate PR).** Trace captured changing place requests to their seed/cache/background producer before selecting a fix. Pin test inputs at the current fixture boundary; do not author a growing list for uncontrolled strings. Prove each fault was consumed; restore temporary idle/proxy configuration and settle background work. Inspect all conditional/fault/retry/teardown paths.
3. **State waits/hang caps (separate PR).** Replace restart's 3 s/4 s sleeps and helper sleeps used as evidence with observable states. Remove silence's aggregate elapsed assertion (150 s, stale message 30 s, configured idle 10 s), retaining timer-contract unit coverage and actual stop behavior. Use measured caps and the existing poller. Shared-helper siblings run whole on CI.

## Review focus

- Late background refusal must survive close-down and appear in suite-failures, not only stderr.
- No failed suite may prove timing using missing, empty or malformed evidence.
- Explicit declared faults/refusals remain valid stored outcomes.
- Independent failures are preserved and no paid/live transport is introduced.
- Main evidence after owner merges is required before calling the whole suite redesigned.

## Progress

- [x] Narrow geo repair merged as c567ff9, no owner merge performed by this agent. (proof: desktop/e2e/test/activityfailures-backbone-no-live-ai.test.mjs @5fe23fa)
- [x] Read full first/retry CI artifacts and identify vacuous retry proof. (proof: none: run 40996297795, original refusals=5 and suite-failures=[])
- [ ] Truthful refusal artifacts and nonempty retry proof: red/green regressions, review, full CI.
- [ ] Deterministic input and lifecycle audit, evidence-based fix and CI.
- [ ] State waits, measured hang caps and CI.
- [ ] Fresh main evidence after owner merges; full redesign claim only then.
