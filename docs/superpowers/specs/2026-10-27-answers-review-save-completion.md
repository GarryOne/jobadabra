# Application Answers save completion

## Problem and intent

A successful answer save can take several seconds to disappear from Profile → Application answers → Needs review because that list waits for the refreshed question queue. Show immediate, trustworthy feedback while the store refreshes.

## Observable behavior

- A successful, non-empty persisted answer immediately leaves the pending Needs review count and modal progress; its current list row briefly shows **Set**, then fades away after about 1–2 seconds.
- The acknowledgement is keyed to the question, survives redraws, filter changes and the queue reread, and cannot remove a different row or be cleared by an old timer.
- The saved answer remains in its canonical home and is available through the existing Saved/All surfaces. Reloads derive state from persistence; the animation itself is transient.
- Failed, empty or invalid saves remain in Needs review, preserve the entered value and show the existing error. No success acknowledgement is shown.
- Completing the last item shows the existing all-reviewed state. Reduced-motion settings suppress the fade transition.

## State transitions

`needs_review → saving → error → needs_review` on failure; `needs_review → saving → Set (count/progress decremented) → faded/removed` on successful persistence. A refresh during `Set` may update canonical data but must not reinsert or prematurely remove the acknowledged row. Explicit “Don’t keep” remains its existing distinct user choice and is never labeled Set.

## Approaches

1. Wait for the queue reread (current behavior): preserves store-derived UI but gives no fast feedback.
2. Optimistically mutate the durable queue: fast but risks diverging from persisted state and losing a row on failed/invalid saves.
3. Keep a transient, question-identity-keyed completion overlay after the successful write, while the store remains canonical (chosen; immediate feedback without persisting animation state).

## Constraints and non-goals

Root cause is shared across reusable-answer and Your details routes; do not special-case a field label. Do not change application/job status to Applied. Do not add or change persistence schema. Use fictional test data and no live user data. Keep edits clear of d9's profile-routing files and d14's typed-date controls; coordinate shared renderer files before landing.

## Acceptance evidence

Focused tests cover successful reusable and Your details completion, the immediate count/modal progression, failed and unusable answers, refresh/filter/rerender identity, and timer replacement. Render fictional before/after states for the PR.

## Progress

- [x] Trace persistence and queue refresh; confirm slow reread leaves the underlying page stale. (proof: desktop/renderer/pages/application-answers.js)
- [x] Add a focused failing behavior test for immediate completion and failure retention. (proof: desktop/test/answers-review-completion.test.js)
- [x] Implement transient completion state and reduced-motion fade. (proof: desktop/renderer/pages/application-answers.js)
- [x] Run focused behavior tests, changed-JS lint, and fictional light before/after screenshots. (proof: desktop/test/answers-review-completion.test.js)
- [x] Rebase on current main and run the complete fast gate. (proof: docs/superpowers/plans/2026-10-27-answers-review-save-completion.md)
- [ ] Ship PR and monitor current-head checks/comments through owner merge.
