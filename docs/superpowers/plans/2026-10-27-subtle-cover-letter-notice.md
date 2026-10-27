# Plan: subtle cover-letter notice

**Goal:** Calm and align both missing-draft and delivery-failed extension-panel notices without changing queue or application behavior.

**Architecture:** Keep the shared notice in `extension/panel-markup.js`; map state copy in `extension/letter-notice.js` and leave detection, setup routing, and manual recovery in `extension/review.js`.

**Tech Stack:** Existing extension shadow-root HTML/CSS and JavaScript; no new dependency.

**Spec:** `docs/superpowers/specs/2026-10-27-subtle-cover-letter-notice-design.md`

## Global Constraints

- No business-logic, queue, priority, count, or readiness changes.
- Navigation must not trigger AI drafting.
- Preserve delivery-failure explanation and manual form recovery.
- Keep keyboard focus visible, contrast usable, and layout overflow-free when narrow.
- Do not edit frozen workflow, ship-tool, or e2e harness-library files.

## Review Focus

- Missing usable draft: link invokes only the existing Profile → Cover letter navigation route.
- Delivery rejected or not retained: recovery copy remains accurate and “Show on form” still focuses the failed control.
- Light and dark themes: neutral surface and text remain readable.
- Narrow panel: message wraps and action remains reachable without horizontal overflow.
- Existing high-priority queue item/readiness: unchanged.

## Tasks

### Task 1: Shared panel notice

**Files:**
- Modify: `extension/panel-markup.js`
- Modify: `extension/panel-files.js`
- Add: `extension/letter-notice.js`
- Modify: `extension/review.js`
- Test: `desktop/test/journeys-cover-letter-notice.js`, `worker/test/cover-letter-priority.test.js`
- Verify: focused cover-letter priority and panel route checks; fictional browser render at normal and narrow widths.

- [x] Replace the oversized shield/amber visual treatment with a compact neutral notice, a small icon, sentence-case heading, readable body text, and responsive inline link styling with visible focus.
- [x] Keep missing-draft navigation on `panelOpenApp` with `session: "setup:cover-letter"`; keep delivery failure on `flash(letterRejected.el)` and concise truthful recovery copy.
- [x] Verify rendered missing-draft and delivery-failed states, setup navigation without generation, manual recovery, keyboard focus, dark/light readability, and normal/narrow screenshots.
- [x] Add and run the journey guard for the Profile route and manual failure recovery.
- [x] Run changed-JS lint and focused tests; fast gate/ship pending.
- [x] Update the rendered-panel integration expectation for the calmer copy; focused tests pass 59/59 desktop and 36/36 worker.
- [x] Fix the `.verify` cascade, test the production status-copy helper once, and guard against partial helper injection; rerender and inspect fictional normal/narrow dark/light screens.
- [ ] Run the complete fast gate on the reviewed PR head; owner merges manually.
