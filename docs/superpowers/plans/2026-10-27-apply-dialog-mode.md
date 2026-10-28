# Apply dialog mode plan

Spec: [2026-10-27-apply-dialog-mode-design.md](../specs/2026-10-27-apply-dialog-mode-design.md)

## Bounded tasks
1. In `desktop/test/apply-dialog-mode.test.js`, add behavior coverage for mode rendering/dispatch, count validation, cancel, and no apply call for unsupported modes. Verify the tests fail before implementation.
2. In `desktop/renderer/apply-dialog-model.js`, `desktop/renderer/pages/jobs.js`, `desktop/renderer/index.html`, `desktop/renderer/components.css`, and `desktop/lib/apply-handlers.js`, replace the legacy mode radios and blanket submission claim with a live saved-mode summary. Keep the count and cancel controls. On Start, validate count, dispatch check mode to the existing `window.pilot.apply` batch path, and explain unsupported saved modes without dispatching. Resolve the saved mode in the main process after the first-choice gate before mapping check to the legacy Chrome runner.
3. Render fictional before/after screenshots of the Jobs dialog using the normal `npm run shot` path. Run focused test, lint changed JS, and the repository fast gate; inspect diff against spec.
4. Commit with required trailers and open a `[d17]` PR via `tools/ship.sh`; keep its watcher active and report CI/review state until owner merge.

## Exact files
- `desktop/renderer/index.html`
- `desktop/renderer/apply-dialog-model.js`
- `desktop/renderer/pages/jobs.js`
- `desktop/renderer/components.css`
- `desktop/lib/apply-handlers.js`
- `desktop/lib/apply-choice-gate.js`
- `desktop/test/apply-dialog-mode.test.js`
- `desktop/test/apply-with-claude-hidden.test.js`
- `docs/superpowers/specs/2026-10-27-apply-dialog-mode-design.md`
- `docs/superpowers/plans/2026-10-27-apply-dialog-mode.md`

## Dependencies and review focus
No runner dependency exists in fetched `origin/main` or visible active branches. Review: stale saved settings on dialog reopen, unsupported mode dispatch, manual-review copy, cancel and invalid count, first-choice gate, fake-runner realism. No broad local suites, real applications, submissions, or paid model calls.

## Rework (28 Oct 2026, owner)
1. Tests first in `desktop/test/apply-dialog-mode.test.js` and `apply-settings.test.js`: unbuilt mode not selectable, "Apply to N jobs", one writer, `built` ↔ `BATCH_RUNNER`.
2. `MODES[].built` + `modeBuilt` (apply-settings-model.js); shared `modeCards` draws unbuilt modes disabled with "Coming soon"; `applyOf` returns only built modes; `MODE_TODAY` removed.
3. Dialog wiring moved from `pages/jobs.js` (464 lines) to `pages/jobs-apply.js`; count first, cards second, no saved badge.
4. Side-by-side `r17-apply-dialog.png`, owner's yes, one `/code-review`, push to `apply-dialog-mode`.
