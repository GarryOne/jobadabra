# Apply dialog follows saved mode

## Intent
The Jobs “Apply to jobs” dialog must show the same saved Apply mode as Settings → Apply and only start work that mode can actually run. Today the dialog has a separate legacy Chrome/Claude selector, while the saved setting is `settings.apply.mode`.

## Approaches
- Keep legacy radios and translate them to settings: rejected because it leaves two mode sources and can reset the saved choice.
- Add full background fill and unattended submission here: rejected because the current runner does not implement either path and this would broaden scope into a new automation platform.
- Read the canonical saved mode and dispatch only supported work: chosen because it fixes the dialog within scope and fails honestly for unsupported modes.

## Observable behavior / mode-state table
| Saved mode | Dialog description and Start | Execution / submission policy |
|---|---|---|
| `check` | Show manual review behavior; Start enabled for a valid count | Existing batch runner opens jobs in Chrome, extension fills, candidate reviews every tab and submits manually |
| `fill` | Explain background-fill runner is not available in this build; Start disabled after the mode is confirmed. Before the first-choice gate, Start opens the existing confirmation flow. | No execution for the unsupported saved mode, no visible Chrome launch |
| `auto` | Explain Full automation runner is not available in this build; Start disabled after the mode is confirmed. Before the first-choice gate, Start opens the existing confirmation flow. Do not imply unattended submission is active. | No execution for the unsupported saved mode, no visible Chrome launch or submission |
| missing/unsupported | Resolve through canonical `applyOf` fallback (`check`) and describe the actual check path; do not show an unsupported mode as Full automation | Manual-review runner only |

## Constraints and non-goals
- `settings.apply.mode` remains the sole mode source; opening the dialog never changes it.
- Preserve the first-choice gate, dialog cancel, count bounds, and existing start guards.
- Do not implement background filling or unattended submission, submit any form, open real applications, or call paid models.
- Browser processes may exist for supported work; make no claim that background mode means no browser process.

## Acceptance criteria
- The modal reflects the currently persisted canonical mode when opened, without a second selector.
- Starting `check` routes through the existing batch `apply` path with the validated count and preserves manual review.
- `fill` and `auto` cannot route to the visible Chrome fallback; their explanation accurately says the execution path is unavailable.
- Missing/invalid values use the model's honest `check` fallback.
- Tests cover each mode, invalid count, cancel, and actual start dispatch / no dispatch for unsupported modes.
- Fictional before/after dialog screenshots and focused tests, changed-JS lint, and the fast gate are recorded.

## Progress
- [x] Trace Settings mode source and batch runner on fetched `origin/main` and active branches. (proof: desktop/renderer/apply-dialog-model.js, desktop/lib/apply-handlers.js)
- [x] Capture fictional baseline screenshot. (proof: none: PNG uploaded as the PR's before image)
- [x] Add failing behavioral regressions and observe the initial missing-module failure. (proof: desktop/test/apply-dialog-mode.test.js)
- [x] Wire dialog to saved mode and supported runner. (proof: desktop/renderer/pages/jobs.js, desktop/lib/apply-handlers.js)
- [x] Capture after screenshots. (proof: none: PNGs uploaded as the PR's after images)
- [x] Run focused verification. (proof: desktop/test/apply-dialog-mode.test.js)
- [ ] Run the fast gate and review the committed diff.
- [ ] Ship review PR and track current-head CI/review/owner merge.
