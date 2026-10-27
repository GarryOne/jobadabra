# What we learned about you: facts in Your details, learnings from Form fills

> **Verdict:** Application answers becomes **What we learned about you**: one question and answer per topic, written by the app
> from Form fills, used at once, and shown to you so you can check, confirm or change it. Your details holds only the fixed,
> black-or-white facts. Each one has its own drawer. Agreed with the owner on 27–28 Oct 2026 (discussion in the coordinator session).

## Problem (owner's words and screenshots, 27 Oct 2026)

- "Each question has a location (Profile, Profile → Your details) but they're showing in Application answers… Not sure what
  should happen if they are set. Should they still stay in this tab but as Set?"
- Today the same item appears in two queues with different counts: Your details "17 details to check", Application answers
  "Needs review 24", the drawer "21". The Needs review list repeats items (How did you hear ×2, EEO ×2, Pronouns ×2, Willing to
  relocate ×2), duplicates Your details fields as "Website rules" (LinkedIn Profile, notice period ×2, employment type ×2), and
  lists questions that are per company ("How did you hear about us?", "Previously worked for this company?").
- Topics have two homes: Work eligibility and Availability & compensation exist in Your details AND as Application answers groups.
- "Since we have the raw form fills, having the Application Answers in this form is just redundant… should be transformed into
  What we learned about you… grown automatically and not be repetitive or redundant… the user should be able to see it, check it,
  confirm it and eventually modify it… let him know what we do in the background."

## Design (states, their one owner, the verdicts that change them)

**Three homes, one owner each**

| Home | Holds | Owner (writes it) | Used how |
|---|---|---|---|
| Your details | Fixed, black-or-white facts: name, contact, links, work eligibility per zone (EU / EEA + Switzerland, UK, US; sponsorship derived), notice period, languages, demographics (Voluntary surveys), criminal-record disclosure | You; the CV; a value you typed into a form when the field was empty | Copied into forms as is |
| What we learned about you | One question + answer per topic, about your stances and stories: willingness to travel, employment type, background-check willingness, salary to state per country/role, "if X then contract, else full-time" | The app, from Form fills; you when you edit an answer | Guides the AI when it writes an answer; never pasted blindly |
| Form fills (Reports) | The raw log of every value sent, per form | Each fill | Evidence for learnings; never reused directly |
| Strategy (unchanged) | Search minimum salary per country | You | Which jobs to show |

**What decides where a question goes (at fill time and when learning)**

1. Per-company question (names the company, "why us", "how did you hear", "worked here before", which of our offices) →
   answered per job, never stored as a learning. "How did you hear" is filled from where the app found the job.
2. Matches a fixed field of Your details → answered from Your details. Never a learning, never an Application answer.
3. Anything else that will recur → a learning, keyed by topic (meaning), not by wording.

**States of a learning**

| State | Set by (verdict) | Used in forms? | In drawer 2? |
|---|---|---|---|
| `new` | The app concluded it from one or more form fills | **Yes, at once** | Yes: "We concluded this, is it right?" |
| `confirmed` | You pressed Confirm, or edited the answer | Yes | No |
| `conflict` | New evidence disagrees with the current answer (told Acme "contract OK", Northwind "full-time only") | The current answer, until you resolve it | Yes: "You answered two ways; write the rule" |

- **One topic, one entry.** New evidence on a known topic updates that entry's evidence; it never adds a second entry.
- **Editing = writing the answer**, free text, and it may hold conditions ("Contract only if remote and at least 6 months").
  "Never" is a valid answer; nothing is ever asked twice for the same topic unless new evidence conflicts with it.
- **Legal and eligibility answers are never concluded from a guess** (right to work, criminal record): those are Your details facts,
  answered by you once.
- **Guesses**: an answer the app guessed during a run is a `new` learning with source "guessed"; it stays in use, and drawer 2
  shows it until you confirm or change it.

**Two drawers**

| Drawer | Contents | Order | Card shows when |
|---|---|---|---|
| 1 · Fill your details | Missing Your details facts only | Existing rank (lib/missing-facts.js): blocked a fill, then how many forms asked, then share of installs; name/email first | Any fact missing |
| 2 · What we learned | Learnings in state `new` or `conflict` | Conflicts first, then by how many forms used it | Any new/conflict learning |

Both cards disappear at zero. The cover letter is not a drawer item; it keeps its own card.

**Facts found in a form** (exists: lib/learned.js): a value you typed for a fixed field fills Your details when the field is empty,
shows a note ("Postal code taken from your Acme form"), and the item leaves drawer 1 at once. A different value than the one kept
is never overwritten; drawer 1 asks which is right.

**Remember, by Apply mode**

| Apply mode | What you see |
|---|---|
| Standard / Background (you're in control) | Each new answer you give has "Remember" (on by default) |
| Full automation | A recap after the run: what was answered, what was learned, with Change |

## What exists and is reused (git, origin/main 28 Oct 2026)

- `lib/learn.js` + `lib/knowledge.js`: after a fill, Haiku writes 🧠 Form knowledge notes (`answer` / `option` / `widget` /
  `meaning`, scope = site or "any"). `widget` and `meaning` notes are form mechanics, not about you: they stay internal.
  `answer` / `option` notes with scope "any" are the raw material for learnings.
- `lib/learned.js`: fields you changed at Submit → personal facts to Your details when empty, the rest to Form knowledge.
- `lib/question-reuse.js`: AI verdicts `reusable` / `one_job` / `consent` / `details`, a `topic`, and `covered_by`.
- `lib/missing-facts.js` + `lib/fact-catalog.js`: the fixed fact list and its ranking.
- `lib/questions.js` ("Answer once" ❓ lines), `lib/answer-home.js` (one home per answer): today's Application answers source.
- `lib/form-fills-handlers.js`, `renderer/pages/form-fills.js`: the Form fills log.

## Acceptance criteria

1. The Application answers tab is renamed **What we learned about you** and lists one entry per topic: question, answer,
   evidence ("from 3 forms: Acme, Northwind, …"), state chip (New / Confirmed / Two answers).
2. No entry in that tab is a Your details fact, a per-company question, or a duplicate topic (fixture: today's 21-item queue from
   the owner's screenshot → expected entries listed in the plan).
3. Drawer 1 contains only missing Your details facts, ranked; first/last name and email come before relocate/salary.
4. Drawer 2 contains only `new` and `conflict` learnings; Confirm or an edit moves an entry to `confirmed` and out of the drawer
   without reload; the count drops at once.
5. A `new` learning is used by the next fill before you confirm it.
6. A value typed for an empty Your details field fills it, shows the note, and the drawer 1 item disappears.
7. One count per drawer everywhere (card, tab badge, drawer header) — no other "to review" numbers.
8. Salary: Strategy keeps the search floor; "salary to state" is a learning seeded from the Strategy floor; Your details has none.
9. Light + dark, wide + narrow screenshots of both drawers and the tab, approved by the owner before the UI commit.

## Edge cases

- Two forms ask the same topic in different words on the same day → one entry, two evidence lines.
- You edit an answer while a fill is running → the fill keeps the answer it started with; the next fill uses the edit.
- Notion store vs local store: the learnings live in the active store (lib/store), like Form knowledge today.
- No AI available (cap reached): no new learnings are concluded; existing ones still apply; nothing is marked "other".

## Non-goals

- No change to Strategy, the search, the extension's form mechanics notes, or the Apply mode cards (#2317).
- No migration that deletes the owner's existing answers: today's answered lines become `confirmed` learnings or move to their
  Your details field; nothing is dropped silently.

## Open facts (to settle in the plan, from code)

- Where learnings are stored: extend the Form knowledge page (a new kind) or a new store page. Decided in the plan after reading
  `lib/store`.
- Whether `question-reuse.js`'s `topic` (first 5 words) is good enough as the topic key, or the meanings pack (`aliases.js`) is.

## Open PRs this supersedes (owner decides)

- #2316 (Set row in Needs review) and #2320 (Location column): closed 28 Oct 2026 on the owner's yes.
- #2322 (regional work permits) fits: per-country eligibility is a Your details fact. Reviewed on its own.

## Progress

- [x] Design agreed with the owner (27–28 Oct 2026)
- [x] Existing mechanisms read (learn, knowledge, learned, question-reuse, missing-facts)
- [x] Design sketch approved by the owner (28 Oct 2026, https://claude.ai/artifact/3Bzz5uTwPLssMNodQsdbMn)
- [x] Plan written (`docs/superpowers/plans/2026-10-28-what-we-learned.md`): PR A two drawers, B learnings, C remember
- [ ] Implementation + tests
- [ ] Before/after screenshots in the PR
