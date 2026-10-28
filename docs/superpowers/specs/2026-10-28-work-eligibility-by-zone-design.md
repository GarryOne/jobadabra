# Work eligibility: Nationality + three zones (#2322)

> **Verdict:** Your details asks for your **Nationality** and only the zones it doesn't cover (**EU / EEA + Switzerland**, **United Kingdom**, **United States**, plus any country you add). Every "authorised to work in X?" or "need sponsorship?" question on a form is answered from those rows. The older eligibility lines are read once by the AI and folded in on your Save, with a backup and Undo.

## Owner's words (28 Oct 2026)
- "one answer in EU, another one in UK, another one in US… EU + Switzerland or EEA… And that's it."
- The old lines are "pointless. We can deduce any of them, once we know the answer for the 3 above."
- "The idea is to ask as less as possible the user and to be able to conclude as much as possible, by ourselves."
- Questions name a country, never a city.

## Design
| State | Owner (one) | Changed only by |
|---|---|---|
| Nationality: one or more English country names | the `Nationality` line in Work eligibility | your edit or a CV proposal you confirm |
| Zone row status: `yes, freely` / `yes, with a permit` (+ valid until, + only in) / `no, needs sponsorship` | the zone's `[per country]` line | your edit; a CV proposal only when the CV states a permit |
| A zone your nationality opens | concluded at read time (`eligibilityOf`), never saved | your Nationality (a saved row wins) |
| Sponsorship | derived from the status (`settles`), never a fact | the status |
| Which zone a form's country is in | the AI's ISO code, checked against the zones' fixed members | nothing else |
| Older eligibility lines | kept as written until your Save | the AI's one reading (cached per set of lines), then your Save (backup + Undo) |

<details><summary>Verdicts that change state</summary>

- **Open Your details:** the older lines are read once (`lib/eligibility-older.js`); Nationality and empty zones are filled as drafts with "From your earlier answers". Nothing is saved.
- **Save:** the folded lines leave the card after `saveCopy` (both pages backed up); `settings.eligibilityFold` keeps the section as it was; Undo puts it back.
- **Form question:** `question-reuse` gets `asks` + `country` from the AI; `rowFor` + `settles` give Yes/No, or it stays asked (an expired or other-country permit, an unknown code).
- **Queue:** a zone waits for Nationality; with Nationality held, only the zones it did not open are asked.
</details>

## Acceptance
- A Romanian national: "Authorised to work in Germany?" → Yes; "Need sponsorship (Berlin)?" → No; no country named → answered per job.
- An Irish national: EU and UK concluded, only the US asked.
- A city is never a Nationality or a row; a CV proposal outside the fixed statuses is dropped.
- An unreadable or "other" older line stays as written; nothing is removed without your Save, a backup and Undo.
- Nationality and each zone round-trip on SQLite and Notion.
- The setup prompt and the Profile template carry Nationality + zones, never a home-region or city line.

## Progress
- [x] Pure rules: `renderer/work-eligibility.js` (`test/work-eligibility.test.js`)
- [x] Card: Nationality chips, zone rows, derived rows, permit date + only-in (`pages/details-facts.js`, `fact-line.js`, `fact-summary.js`)
- [x] Fold of older lines with backup + Undo (`lib/eligibility-older.js`, `test/eligibility-older.test.js`)
- [x] Form answers from zones (`lib/question-reuse.js`, test in `question-reuse.test.js`)
- [x] Queue: zones wait for Nationality; CV proposes Nationality (`missing-facts.js`, `cv-queue.js`)
- [x] Setup prompt + template (`strategy.js`, `docs/notion-profile-template.md`, `profile-template-typed.test.js`)
- [x] Store round trip SQLite + Notion (`profile-sections.test.js`)
- [ ] PR B: "Remote from your country" moves out of Work eligibility (later)
