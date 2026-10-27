# Calendar date controls for application questions

## Problem

Profile → Application questions can show a generic text box for a calendar-date question (for example, a fictional “What is your date of birth?”). The shared date control already exists, but a form reporting a generic text input is currently treated as authoritative `text`, preventing semantic classification.

## Intended behavior

- A question whose answer is one specific calendar day uses the shared native date input in every reusable question editor.
- Durations, year-only answers, availability prose, and arbitrary text keep text or duration controls according to their answer meaning; the word “date” alone does not select a date control.
- A form’s specific structural type (native date, selection, checkbox, number, etc.) remains authoritative. Generic text inputs receive one semantic classification using the existing classifier.
- Existing saved answer text remains visible and editable. Valid date-only values round-trip without timezone conversion; invalid or unrecognized saved dates remain visible and empty date input values do not invent an answer.

## Constraints and non-goals

- Do not read or modify real profile data and do not infer a real date.
- No classifier keyword rules or one-question exception; use existing date metadata and shared control/rendering paths.
- Do not change form submission, application answers, or legal attestations behavior.

## Acceptance criteria

- Text-input DOB is classified as `date` and the shared editor renders `input[type=date]`.
- Native typed controls remain authoritative; generic text labels can classify as date, duration, or text.
- Older AI text classifications are rejudged once under the refined distinctions.
- Date serialization and validation preserve calendar days and saved invalid text; the control’s empty/complete behavior remains intact.

## Edge cases

- “How many years of experience?” → text; “Notice period” → duration; “When can you start?” with prose → text; an exact start day → date.
- A date with constraints preserves both parts and existing completion requirements.
- ISO dates do not shift across time zones; malformed dates do not silently become another valid date.

## Progress

- [x] Trace shared question kind, metadata, and editor paths; identify generic fill-text precedence as root cause. (proof: desktop/lib/question-formats.js)
- [x] Add one-time semantic classification for generic text controls and refine the classifier distinctions. (proof: desktop/lib/question-formats.js)
- [x] Cover format propagation in unit and journey contracts, stale AI judgments, typed controls, invalid dates, and saved date round-trip. (proof: desktop/test/question-formats.test.js)
- [x] Capture fictional before/after drawer preview in light and dark themes; run focused tests and changed-file lint. (proof: desktop/test/journeys.test.js)
- [ ] Run the ship fast gate, open PR, and track current-head CI/comments to the owner handoff.
