# Applyflows full redesign implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Apply every applicable reliability rule to applyflows, preserving its product journey assertions and Submit tripwires.

**Spec:** ../specs/2026-10-28-e2e-reliability-design.md (owner explicitly renewed full scope, 30 Oct 2026).

**Architecture:** Keep the real app and extension on local form fixtures. Use the existing semantic-answer proxy and state-poll helpers; isolate live measurement under LIVE. Product fixes already landed in #2557; this follow-up closes remaining test-design gaps without a new runner or lane changes.

**Tech stack:** Node test runner, Playwright, existing fixture proxy, Electron on CI.

## Audited boundaries

- AI: offlineAi/realAi block paid transport, but off-mode fallback silently refuses every unmatched question. CI does not yet select backbone answers for applyflows. Existing fixture answers are keyed by page path/field identity; the empty late form's digest is not answered explicitly. Unknown page paths currently default to form.
- Clock: measured per-step caps already exist; aggregateBudget=false. Most pauses are bounded polls of actual state. Four fixed waits still act as evidence: staggered apps (2s), refusal no-retry (12s), Claude readiness (6s twice), second-browser empty reports (35s).
- Outside: form server intercepts employer hosts; final host and Submit checks exist. Context alternates only SQLite and local Notion stand-in. Browser/profile/spool are isolated. LIVE is an explicit separate measurement.
- Inputs: variation is seeded and written to seed.json. Page-kind cache is intentional product state; the wrong-kind fixture has a unique shape regression. Test-owned fault/misclassification answers must not leak into unrelated fixtures.
- Lifecycle: inspect runApply cleanup and secondary-browser finally, settings mutations, callback restoration and pending requests before final no-live guard.

## Progress

### 1. Explicit AI ownership
- [ ] Add a regression showing unknown applyflows questions cannot be silently refused. (proof: none: pending)
- [ ] Select semantic backbone mode on both CI attempts; guard unsupported local mode before journey actions. (proof: none: pending)
- [ ] Store exact fixture answers for required digest/page questions; unknown identities fail, no blanket default. (proof: none: pending)
- [ ] Verify both provider seams, no cache/live escape, known-answer removal fails. (proof: none: pending)

### 2. State and event evidence
- [ ] Replace fixed stagger with observed first-session ownership. (proof: none: pending)
- [ ] Exercise refused-signin repeated reconsideration explicitly rather than waiting 12s. (proof: none: pending)
- [ ] Observe readiness refresh and repeated second-browser reports directly. (proof: none: pending)
- [ ] Preserve assertions and measured hang caps; focused regression proof. (proof: none: pending)

### 3. Lifecycle and full proof
- [ ] Restore modified settings/callbacks and close secondary resources on failure. (proof: none: pending)
- [ ] Review all AI, clock, outside, cache/seed and fault paths; document remaining gaps honestly. (proof: none: pending)
- [ ] Full applyflows and picked siblings green on final PR head; Gitar approved and no unresolved findings. (proof: none: pending)
- [ ] Fresh main proof after owner merge. (proof: none: pending)

## Execution order

First write and run red-first focused tests for explicit AI ownership, then implement using existing seams and open the PR through ship.sh so CI exposes any still-unowned question. Continue state/event and cleanup changes on the same redesign branch. Local checks remain isolated and under a minute; full journeys run on CI. No live model calls, new timeout budgets, shards, lane reclassification, weaker expectations or paid reruns.
