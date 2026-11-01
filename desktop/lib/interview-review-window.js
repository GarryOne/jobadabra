// Owns: the rule that one interview is reviewed at most once in a short window, whoever asks (the ⋯ Review again press, Save & review, a second click).
// Guarded by: test/interview-review-window.test.js. Used by lib/interview-handlers.js (ivReview).
// Why (R2, 1 Nov 2026): testable without the main process; it was inline in the ivReview handler, where only an e2e step could reach it. No behaviour change.

// One review costs ~$0.25 and takes about a minute, so a second ask for the same interview inside this window is a duplicate: 1 Oct 2026 produced two GitHub runs 38 s apart, two Notion
// rows and two different reviews of one transcript. The window is short enough that a deliberate "Review again" later still runs.
export const REVIEW_WINDOW_MS = 2 * 60 * 1000;

/**
 * True when a review of `id` may start now: it was not started in the last `windowMs`. `started` maps an interview's page id to when its review was last started (the caller sets it on
 * a start and deletes it when the review failed, so a retry starts at once). `now` is injected so a test needs no clock.
 */
export const mayStart = (started, id, now = Date.now(), windowMs = REVIEW_WINDOW_MS) => now - (started.get(String(id)) || 0) >= windowMs;
