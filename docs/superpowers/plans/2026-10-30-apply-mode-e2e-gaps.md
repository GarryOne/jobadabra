# Apply-mode and triage e2e gaps G2–G5 (30 Oct 2026)

> **Verdict:** the apply suite plays the modes' hidden-browser work but not four things the person does in the window: Full automation's confirmation, Stop on the card,
> the triage progress bar with Cancel, and a chip for each read verdict. One PR each, in this order; each is an `apply` suite step, no new AI ask.

**Owner (30 Oct 2026, via d3):** "add e2e to close all the gaps … apply in different modes, triage, and so on". Placed by a8 (owner of e2e); session g2.

## PRs
1. **[g2] 1/4 Full automation's confirmation in the real window**: Settings → Apply: Full automation opens the one dialog; "Not now" keeps the old mode and saves no `autoConfirmedAt`;
   "Turn on Full automation" saves it. A mode `auto` saved without the stamp makes `window.pilot.apply` return the controller's refusal; nothing is filled or sent.
   Also: the restart steps lose their inline caps (the step's hang cap is the only clock; the watch past a due time comes from the extension's alarm period).
2. **[g2] 2/4 Stop pressed on the live card** (Background and Full automation): the app's verdict, no POST, and in Full nothing pressed past the due time plus one alarm.
3. **[g2] 3/4 The triage progress bar and Cancel during a real read**: the bar moves per job; Cancel stops the run, hides the bar, fills and sends nothing, leaves no session.
4. **[g2] 4/4 A chip for each read verdict**: one fixture form per verdict the reader can return; each chip shows that verdict's words, read from the renderer's constant.

## Progress
- [ ] 1/4 confirmation steps (proof: desktop/e2e/lib/apply-confirm-steps.mjs)
- [ ] 2/4 Stop on the card
- [ ] 3/4 triage bar and Cancel
- [ ] 4/4 chip per verdict
