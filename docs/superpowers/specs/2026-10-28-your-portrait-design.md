# Your portrait

Status: approved by the owner (28 Oct 2026). Sibling spec: [Insights with actions](2026-10-28-insights-with-actions-design.md)
(branch `insights-actions`). Depends on "What we learned about you" PR D, the one "about you" interface
([plan](../plans/2026-10-28-what-we-learned.md), branch `what-we-learned`).

## The owner's problem (their words, 28 Oct 2026)

- "A new tab in the Profile … where we combine all together … and we describe the user with good and bads. We provide him an
  objective view about him."
- "This AI generated personal information should not be modifiable. That's what we tell him. Not something that he can edit."
- "This feature … is kind of a statement/document (which continuously evolves), but it doesn't tell you what to do to change
  it. It just describes you." Actions live in the sibling spec, in their home screens.
- Name and place (owner's choice): **"Your portrait"**, its own Profile tab.

## Design

**What it is:** a read-only text the app writes about you, from everything it knows, updated as it learns. Second person
("You come across as …"). Every statement shows the evidence it rests on.

**Sections** (each appears once it has enough evidence; minimums are the producer's, stated in code and tested):

| Section | Says | Built from | Appears after |
|---|---|---|---|
| In short | Who you are professionally, 2-3 sentences | CV, Experience bank, Your details | a CV |
| Strengths | What stands out, with evidence | CV, Experience bank, What we learned, interview reviews | CV + 5 form fills or 1 interview review |
| How you may come across | Weaker sides, phrased as what an employer might see | interview reviews, outcomes, What we learned | 2 interview reviews or 10 outcomes |
| What you're looking for | Roles, places, ways of working, money | Strategy, What we learned | 3 learnings |
| How you work | Habits and preferences that recur | What we learned, interview reviews | 5 learnings or 2 interview reviews |
| Personality and soft skills | How you communicate, work with others, handle pressure, as observed: never a personality type or test label | interview transcripts and reviews, your written form answers, your base letter | 2 interview reviews, or 5 written answers + a base letter |

Personality and soft skills: added on the owner's request (28 Oct 2026, "a section about personality or soft skills"). Each
point names behaviour seen in the evidence ("you answer with a concrete example first"), never a diagnosis or a label (no
MBTI, Big Five or similar).

**States** (one owner: the portrait writer; the person never edits):

| State | Set by | Shown |
|---|---|---|
| `not_yet` | no section has enough evidence | what it needs, with progress ("Form fills 2 / 5") |
| `current` | the writer, after a run | the sections that qualify, "Updated <date> from <sources>" |
| `outdated` | new evidence since the last run | the current text + "Updating soon"; the writer runs at most once a day |

**Disagreeing:** no edit and no "Not true" on the portrait. Each evidence chip opens its source (a learning, Your details, the
CV, an interview review), where it can be corrected; the next run follows. This keeps the portrait honest.

**Nothing reads the portrait.** The CV, letters, form filling and insights read the sources through the "about you"
interface; one AI text built on another drifts.

**Kept out:** demographics (EEO), criminal record, disability. Salary appears only in "What you're looking for".

**Storage:** derived text plus its evidence list and date, behind the store interface (one copy; both adapters).

**AI:** one call per run (a strong writing step; Free AI is "a bit weaker", Pro uses the in-house model), the shared writing
rules (`src/ai/writing_rules.py`), at most one run a day and only when evidence changed. Cost measured on the PR; asked
before shipping.

## Acceptance criteria

1. Profile has a "Your portrait" tab, subtitle "How you come across, written by AI from everything we know. Updated as we
   learn."; it is in the ⌘K palette.
2. Nothing on the tab is editable: no inputs, no edit buttons, no "Not true" (test asserts no editable control).
3. Each statement has at least one evidence chip; each chip opens its source (test loops over every section).
4. A section with less than its minimum evidence is not written; with none qualifying, the tab shows `not_yet` with progress.
5. New evidence marks it `outdated`; the writer runs at most once a day and never when evidence is unchanged (test with a
   counting client).
6. No demographic, criminal-record or disability fact appears (test with a profile that holds all three).
7. No other AI step reads the portrait (test: the "about you" interface has no portrait part).

## Edge cases

- Evidence that contradicts itself (CV vs forms): the portrait states neither as fact; the sibling spec's insight #4 asks.
- Free AI capped for the day: the text stays as it is, `outdated`; never a partial rewrite.
- A source deleted: its statements drop at the next run.

## Non-goals

- Actions or advice (sibling spec). Editing. Sharing outside the app, PDF or LinkedIn export.

## Shipping

One PR after What we learned PR D: writer + store + tab. UI preview and the owner's yes before the UI commit.

## Progress

- [x] Spec approved by the owner (28 Oct 2026) (proof: none: the owner's yes in the coordinator session, 28 Oct 2026)
- [x] Design sketch approved (28 Oct 2026, https://claude.ai/artifact/NbLpTtcz3XNSuR3gEBDjNw): "you", last tab, sensitive facts kept out, one update a day at most (proof: none: the owner's yes on the sketch)
- [x] PR · writer, store, tab, merged as #2334 (aa6692c, 28 Oct 2026); also portrait-tab.test.js and store-contract.test.js; owner's look: Structured and Plain text views (proof: desktop/test/portrait.test.js @1ada8cd)
- [x] The What we learned note links to Your portrait: test "What we learned names the portrait in its lead" (proof: desktop/test/portrait-tab.test.js)
