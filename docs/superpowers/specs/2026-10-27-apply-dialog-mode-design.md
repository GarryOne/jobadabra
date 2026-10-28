# Apply dialog follows saved mode

> [!NOTE]
> **Verdict (28 Oct 2026, owner-approved rework):** Jobs' "Apply to jobs" applies to jobs. It shows Settings → Apply's three cards; only a built mode can be picked; the others are disabled "Coming soon" cards; the button reads "Apply to N jobs".

## Intent
The owner (28 Oct 2026) on the first version: you could pick and save Background or Full automation, which then said "not available in this build" next to a green "saved" badge, and the button read "Confirm Apply mode". The dialog had turned into a settings editor that offered choices that did nothing.

## Design: states, their one owner, the verdicts that change them
- **One owner of the mode:** `settings.apply.mode`, read through `applyOf` (renderer/apply-settings-model.js) and written only by Settings → Apply's `save` (pages/apply-settings.js), which the Jobs dialog and the first-Apply dialog call too.
- **Built or not:** `MODES[].built` is the only switch. A mode not built is drawn disabled with a "Coming soon" pill (shared `modeCards`, on every surface), cannot be picked, and `applyOf` never returns it: an older save of it reads as Standard automation, so the cards and the runner always agree.
- **Runner:** `BATCH_RUNNER` (lib/apply-handlers.js) maps each built mode to its batch runner (`check` → the visible Chrome extension batch). A test fails when `built` and `BATCH_RUNNER` disagree, so a mode cannot be marked built without a runner and never falls back to visible Chrome.
- **Verdicts:** a card press on a built mode (save), Start (main reads the mode again after the first-choice gate), Close/Esc (nothing).

| Mode | Jobs dialog | Start |
|---|---|---|
| Standard automation (`check`) | Selected, selectable | Visible Chrome batch; the person reviews and submits |
| Background automation (`fill`) | Disabled, "Coming soon" | Cannot be the saved mode |
| Full automation (`auto`) | Disabled, "Coming soon" | Cannot be the saved mode |

## Constraints and non-goals
- No background filling or unattended submission is built here; nothing submits.
- Keep: same cards and descriptions as Settings → Apply, count 1–10, Close, the first-choice gate, the duplicate-start guard.

## Acceptance criteria
- Order: "How many jobs" (an inline count field), then "How Jobadabra applies" with the three shared cards, then one primary button "Apply to N jobs" ("Apply to 1 job"; "Apply to jobs" while the count is invalid).
- Background and Full automation are disabled "Coming soon" cards in the Jobs dialog, Settings → Apply and the first-Apply dialog; pressing one writes nothing.
- A pick of a built mode saves through Settings → Apply's writer and keeps `chosenAt`; no "saved" message in the dialog.
- An older save of an unbuilt mode reads as Standard automation in the cards and the runner alike.
- Start sends the validated count; invalid counts and Close start nothing; a second press or a count edit while starting cannot start a second batch.
- Not chosen yet: Start opens the first-Apply dialog, then main runs the mode chosen there.
- Guard: `desktop/test/apply-dialog-mode.test.js`, `desktop/test/apply-settings.test.js`.

## Progress
- [x] First version: Jobs reuses Settings → Apply's cards and writer; main resolves the mode after the gate. (proof: desktop/lib/apply-handlers.js)
- [x] Duplicate-start guard, including count edits while starting. (proof: desktop/test/apply-dialog-mode.test.js)
- [x] Rework tests first: unbuilt not selectable, button label, one writer, `built` ↔ `BATCH_RUNNER`. (proof: desktop/test/apply-dialog-mode.test.js)
- [x] `built` flag and Coming soon cards on every surface; `MODE_TODAY` line removed. (proof: desktop/test/apply-settings.test.js)
- [x] Dialog wiring moved to pages/jobs-apply.js; "Apply to N jobs". (proof: desktop/renderer/pages/jobs-apply.js)
- [x] Side-by-side r17 approved by the owner (28 Oct 2026). (proof: none: image in the PR body)
- [ ] Background automation runner: flip `built` and add its `BATCH_RUNNER` entry in that PR.
- [ ] Full automation runner, with its checks and receipts: same.
