# Apply dialog follows saved mode

## Intent
The Jobs “Apply to jobs” dialog must show the same three mode cards as Settings → Apply. Choosing a card saves the canonical `settings.apply.mode`; Start then routes only work that mode can actually run. The approved display names are Standard automation, Background automation, and Full automation; IDs remain `check`, `fill`, and `auto`.

## Approaches
- Keep legacy radios and translate them to settings: rejected because it leaves two mode sources and can reset the saved choice.
- Add full background fill and unattended submission here: rejected because the current runner does not implement either path and this would broaden scope into a new automation platform.
- Read the canonical saved mode and dispatch only supported work: chosen because it fixes the dialog within scope and fails honestly for unsupported modes.

## Observable behavior / mode-state table
| Saved mode | Dialog description and Start | Execution / submission policy |
|---|---|---|
| Standard automation (`check`) | Show selected card and manual-review behavior; Start enabled for a valid count | Existing batch runner opens jobs in a visible Chrome tab, extension fills, candidate reviews each form and submits manually |
| Background automation (`fill`) | Show selected card and honest unavailable state until hidden fill/session review is implemented; first-choice gate remains available | No unsupported-mode execution and no visible Chrome fallback |
| Full automation (`auto`) | Show selected card and honest unavailable state until hidden fill, saved-check submission and receipt handling are implemented; never imply active submission | No unsupported-mode execution, no visible Chrome fallback or submission |
| missing/unsupported | Resolve through canonical `applyOf` fallback (`check`) and describe the actual check path; do not show an unsupported mode as Full automation | Manual-review runner only |

## Constraints and non-goals
- `settings.apply.mode` remains the sole mode source. The three cards reuse the Settings → Apply choices and writer; selection updates the persisted mode and preserves the existing first-choice stamp.
- Preserve the first-choice gate, dialog cancel, count bounds, and existing start guards.
- Do not implement background filling or unattended submission, submit any form, open real applications, or call paid models.
- Browser processes may exist for supported work; make no claim that background mode means no browser process.

## Acceptance criteria
- The modal reflects the persisted mode when opened, using the existing mode-card UI and single canonical setting.
- Choosing one of the three cards immediately persists that mode to Settings → Apply, and the selection remains after reopening the dialog.
- Starting `check` routes through the existing batch `apply` path with the validated count and preserves manual review.
- `fill` and `auto` cannot route to the visible Chrome fallback; their explanation accurately says the execution path is unavailable.
- Hidden modes become startable only when the shared runner reports end-to-end readiness: Background automation reaches `ready_for_review`, while Full automation passes saved checks, stops for manual handoff on CAPTCHA/unknown states, and records `Applied` only from a receipt.
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
- [x] Run the fast gate and review the committed diff. (proof: none: fast gate passed on the PR update; see registered ship log)
- [x] Reuse Settings' three mode cards in Jobs and persist card selection to canonical settings. (proof: desktop/renderer/pages/jobs.js, desktop/renderer/apply-settings-model.js, desktop/test/apply-dialog-mode.test.js)
- [x] Capture current fictional before/after card screenshots, including a persisted Background automation selection. (proof: none: PNGs uploaded as the PR's before/after images)
- [ ] Integrate the shared hidden runner only after review confirms its end-to-end readiness contract.
- [ ] Run the fast gate on the combined final head, refresh screenshots/body, and track current-head CI/review/owner merge.
