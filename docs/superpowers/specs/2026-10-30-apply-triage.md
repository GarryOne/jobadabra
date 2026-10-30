# Apply triage: see which jobs can apply automatically

Verdict: a button on the Jobs screen reads each job's application form once, in the hidden browser, and shows the highest apply mode that job can take as a chip. Nothing is filled or sent. Sketch approved for the spec: https://claude.ai/artifact/EBr2aYYEop6XqrtzdVGmwF (owner: to be confirmed by a yes).

## What the person sees
- **Button:** "See which jobs can apply automatically" (decision 1 below), on the Jobs screen.
- **Popup:** which jobs (first N by fit, or fit above a value), how many, and an estimate of time and AI credit, measured first on one real page.
- **Progress:** a bar and Cancel on the Applying card; each job's chip appears as its form is read.
- **Chip per job:** one of "Can apply automatically", "You review and submit", "Needs you" (with the reason), "Likely: you review" (a dashed early guess), or "Not checked".

## How the mode is chosen
The form read decides the highest mode:

| Form read says | Highest mode | Chip |
|---|---|---|
| No captcha, no login, every answer a saved fact | `auto` | Can apply automatically |
| No captcha, some answers drafted, not saved facts | `background` | You review and submit |
| Captcha, login wall, or asks to create an account | `check` (Standard) | Needs you, with the reason |
| Not eligible | none | Skipped |

The chip only orders and sorts jobs. The real checks at the click still run every time (opt-in, page proof, kit eligibility, Stop, the optional wait).

## Stages
- **Scoring:** knows posting, place, fit. Sets "Not checked".
- **Kit (hidden, at Apply):** knows eligibility and whether answers must be drafted. Sets "Likely" at most.
- **Form read (button, or first at Apply for an unread job):** knows real fields, captcha, account creation, login, saved facts. Sets the final value and its reason. A chip can only go down after a read, never up.

## Rules it keeps
- No captcha solving, no login walls, no account creation; detect only.
- No retry of 401, 403 or 429.
- Hidden browser only; a cap per run with Cancel.
- Each value is marked with the time it was read and refreshed when the saved details or the form change.

## Decisions (owner)
1. **Button name:** recommended "See which jobs can apply automatically".
2. **"10 jobs" in the Apply dialog:** recommended the 10 best matches, as today, with the dialog saying how many can go automatic.
3. **When:** recommended after the switch ships (it has), as its own spec and PR.

## Open until measured
Seconds and AI credit for one real page; the cap per run; whether the Apply dialog's "10 jobs" means the 10 best matches or the 10 that can go automatic.

## Progress
- [ ] Owner's yes on this spec and its decisions
- [ ] The read of one real form measured (seconds, AI credit) and written into the popup's estimate
- [ ] The read runs in the hidden browser, one job at a time, with the cap and Cancel
- [ ] The chip per job, with its reason and the time it was read
- [ ] The mode table is tested: each form read gives the mode in the table
- [ ] The Apply dialog's "10 jobs" follows decision 2
- [ ] A job never read is read first at Apply
