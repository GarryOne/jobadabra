# Activityfailures approved-design repair plan

> For agentic workers: use superpowers:executing-plans inline; do not delegate implementation. Owner continues applyflows.

**Goal:** Make the activityfailures backbone deterministic and ensure failed guards cannot be accepted as a timing retry.
**Architecture:** Reuse stored semantic answers, the suite runner/artifact writer, fake services, stand-in store and existing state poller. Preserve every behavioral assertion; move only inherently variable measurements to their existing proper seam when necessary.
**Spec:** docs/superpowers/specs/2026-10-28-e2e-reliability-design.md, rules A/B/C/E/F/G2/G3/H.

**Owner request (30 Oct 2026):** “fully redesign activityfailures to match the approved e2e reliability design, in FOLLOW-UP PRs. Keep your current missing-geo repair PR #2556 narrow; do not inflate it with the redesign.” Audit all AI/background/fault/retry paths, state waits and measured hang caps, outside inputs, deterministic seed/cache inputs and teardown. Each fix needs red-first regression proof and full relevant CI; fresh main evidence is required before claiming the whole suite redesigned.
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

### 1. Narrow repair and truthful failure proof

- [x] Narrow geo repair merged as c567ff9, no owner merge performed by this agent. (proof: desktop/e2e/test/activityfailures-backbone-no-live-ai.test.mjs @5fe23fa)
- [x] Read full first/retry CI artifacts and identify vacuous retry proof. (proof: none: run 40996297795, original refusals=5 and suite-failures=[])
- [x] Truthful refusal artifacts and nonempty retry proof: red/green regressions, review, full CI. (proof: desktop/e2e/test/no-real-ai.test.mjs @6cb36b4)
### 2. Deterministic inputs and fault lifecycle

- [ ] Deterministic input and lifecycle audit, evidence-based fix and CI.

### 3. State waits and measured hang caps

- [ ] State waits, measured hang caps and CI.

### 4. Fresh main proof

- [ ] Fresh main evidence after owner merges; full redesign claim only then.

## Isolation follow-up evidence

The launcher explicitly wrote shareEmployers:false but omitted shareEmployersChosen. The real openPoolShare startup migration reopens that value; background-handlers can then schedule contribution after 60 seconds. Record the harness opt-out as a choice, using the same setting as the product switch. A focused regression exercises launcher defaults and the real migration through restart; explicit suite overrides remain available. This fixes a demonstrated external-input leak, without asserting that it caused every missing question.

Finite semantic catalog and synthetic guard retry selection are separate PRs #2560 and #2566; both pass final-head CI with full Gitar approval. Full redesign still requires fault lifecycle, observable state waits, measured caps, CI and fresh main proof.
## Remaining A–F audit (state-wait follow-up)

| Rule | Evidence and implementation | Remaining proof |
|---|---|---|
| A: semantic AI | #2560 covers the finite seeded country/metro batches, six posting extractions and six separate role calls, alongside score/place/geo/refusal rows. Direct and HTTP Claude/OpenAI seams fail on missing keys before cache/transport. Post-close guard records unknown/background questions; #2566 retries their producing journey, never the synthetic guard name. | Full final-head CI and owner-controlled fresh main evidence. |
| B: clock | Activityfailures uses selected/shown/read-complete state, current-launch resume marker and active/new completed search. Restart first witnesses a pending delayed request. No aggregate clock verdict or silence elapsed assertion. Existing pipeline-run timer-contract unit test remains. Named caps are 3x nearest-rank p95, rounded up to 5s, 30s floor, from the two disclosed existing main first tries; no additional main run. | Full journey; cap baseline is n=2, not a claim of a stable long-term percentile. |
| C: inputs/lifecycle | Stand-in store, fake Google/Telegram, fixed feed content/date/location, fixed fixture sources/scout seeds, per-context repeating feed IDs, no owner profile/cache dependency. #2572 preserves the explicit employer-sharing opt-out through migration. #2573 captures request fault/responder at receipt, cancels delayed work on close, and requires own consumption/drain. Silence setup and restoration share one protected scope. | Shared helpers keep legacy waits for siblings; their ordinary behavior is preserved, not redesigned here. |
| D: truthful results | Missing/empty first-failure proof stays red. Full journey first-try versus retry is reported explicitly; no live AI or clock rate was measured or invented. | Read actual final artifacts and fresh main, not the step icon alone. |
| E: expectations | Owner's 30 Oct request authorizes the existing approved design. Behavioral error/status/row/lock/leak assertions remain. A new opt-in stopOnHang ends activityfailures on an uncancelled step hang; ordinary assertion failures keep collecting evidence. It does not retry or accept a hang. | Final review/CI. |
| F: scope | Existing runner, activity helper, proxy, stored-answer seams and state poller are reused. Changed modules declare one approved Job. No new polling framework, lane move, live model use, Submit, or agent merge. | Harness gates and final CI. |

Focused regressions cover deterministic IDs and real detail-state predicates, rejection of stale resume history, every measured cap using the real runner with a fake clock, stop-on-hang versus ordinary keep-going, and restoration after silence startup failure without late relaunch after closure.

Review resolved two lifecycle findings: every activityfailures AI step opts into stop-on-hang (ordinary assertions keep going), and temporary silence configuration is protected from installation onward. A deferred-launch regression also proves context teardown closes an app that finishes opening late instead of adopting it. No new module or polling framework was added.

## PR #2573 final boundary and exact first/retry evidence

CI41053809561 on81ffce0 failed both tries on the same two causes: `AI hang left 1 request(s) pending after its run ended`, and captured title sort key `default/app.title/a8034c8810b9/b36b0b3b7eb6d2d8830bdc0cac27f32e145b9674de19afce76cd5bb687728c2d`. The stopped Python task does not itself close its parent app's pending provider request. Close/restore the silence app first, then prove the captured fault scope drained. A local hanging proxy request regression reproduces the ordering failure; the behavioral stopped-run assertions remain.

The reviewed state-wait work is folded into #2573 so its own lifecycle scenario is complete, rather than publishing a dependent PR against a red parent. Six authored true title-sort verdicts cover the existing finite feed catalog for the exact seeded search. The captured context has six role words, intern/junior exclusions and no level; each accepted title explicitly contains one of those role words. Sort acceptance means the second-look rejection branch is not reached; unrelated contexts remain fail-closed. Exact refusal, reconstructed semantic context and provenance are preserved in the feed-asks fixture. Claude/OpenAI direct and HTTP seams each have independent red/green proof. No live calls, baseline cache borrowing or broad kind fallback.
