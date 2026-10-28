# Insights with actions, where they matter

Status: approved by the owner (28 Oct 2026). Sibling spec: [Your portrait](2026-10-28-your-portrait-design.md).
Depends on: "What we learned about you" PR D, the one "about you" interface
([plan](../plans/2026-10-28-what-we-learned.md), branch `what-we-learned`). PR 1 below does not.

## The owner's problem (their words, 28 Oct 2026)

- "Let's make sure we spread insights everywhere possible. CV. Applying. Jobs. Focus. Interviews. Search strategy. Profile."
- "ok, so we tell this to user, but what he can do about that. What would be the call to action? Or is just a blame?"
- On Tune my strategy and Analyze my job search: "they are staying in 'More'. The user will never go there spontaneously and
  press them. We need to provide these buttons/actions when and where it matters for the user."

## Design

**Rule: an insight is a finding plus one action the person can take.** No action = not an insight: the finding either makes a
feature smarter silently or is dropped (memory `feedback-insight-needs-an-action`).

**States of one insight** (one owner: the insight store, written only by the producer and the person's verdicts):

| State | Set by | Shown |
|---|---|---|
| `open` | its producer, when its evidence is new | in its home screen's insight slot |
| `done` | the person pressed its action | gone; the change is visible where it landed |
| `not_now` | "Not now" | hidden 14 days, then `open` again if the evidence still holds |
| `not_true` | "Not true" | gone for good for this evidence; a new kind of evidence opens a new insight |
| `stale` | producer: evidence no longer holds | gone |

**Where it shows** (owner, 28 Oct 2026: "apart from their home places … shown in the Focus … That should be the place where
we give the user visibility. Focus and Jobs, but Jobs should be a bit more limited … maybe an expandable section"). One insight,
three places, one state: acting in any place updates all of them.
- **Home screen:** one slot (the existing Insight card shape, `desktop/renderer/insight-card.js`), its strongest open insight
  and "+N more".
- **Focus:** a "Suggestions" section of its own, below Up next (Up next stays time-bound tasks: interviews, follow-ups,
  forms to send). It lists open insights from every screen, strongest first: 3 shown, "Show all N". The daily Insight card
  becomes its first entry (#16).
- **Jobs:** one collapsed bar above the list, "N suggestions for your search · Show", expanding in place to only the
  search- and applying-related ones (Strategy #2 and #15, Tune my strategy, Analyze now). Collapsed by default; the list stays
  in view. Hidden at zero.
Every insight shows its evidence (what it saw, with links) and its action buttons. No new page.

**Actions come to you** (Tune my strategy, Analyze my job search): both **leave the Actions page** (owner, 28 Oct 2026: "we can
remove from the Actions … show it in Focus or Jobs only if the circumstances are met and make sense"). Each shows only when its
trigger holds, in its home; the ⌘K palette keeps both as the one manual door (repo rule: every action is in ⌘K).
- **Tune my strategy** (`src/tune.py`, counts only, no AI, free): runs after every search. Trigger: at least one change your
  results support. Shown as a Strategy → Suggestions row "N changes your results support · Review"; also on Jobs when the list
  is thin (few 70+ jobs in the last searches), and it competes for the Focus slot. Zero changes → shown nowhere.
- **Analyze my job search** (the weekly report, already run on Mondays with the insights cadence, `desktop/lib/cadence.js:10`):
  Monday's result is a Focus card "Your week: what works, what to change" with its top action as a button (today it lands
  only in Recent activity and Reports). Between Mondays, "Analyze now" is offered on Focus or Jobs only when enough happened
  since the last analysis (e.g. 10+ new applications or outcomes, or replies stopped after a run of applications; thresholds
  stated in code and tested). Otherwise shown nowhere.

## The insights (owner approved the list and the grouping, 28 Oct 2026)

**Insight + action**

| # | Home | Insight | Action(s) | Built from | Kind |
|---|---|---|---|---|---|
| 2 | Search strategy | Strategy vs your stances: "You'd relocate to Zurich; Zurich isn't in your places" | Add Zurich to places · I wouldn't (the learning changes) | What we learned, Strategy | AI |
| 4 | Profile → CV | CV vs what you said elsewhere: "CV: 5 years of Python; a form: 3" | CV is right (the learning changes) · Forms are right (a correction in the Experience bank) | CV, Your details, Form fills | AI |
| 5 | Profile → CV | Strengths your CV undersells | Use in my CVs (suggested bullet, accept or edit first) | What we learned, Interviews, Experience bank | AI |
| 6 | Profile → CV | Skills your target jobs ask for that are only in the Experience bank | Use in my CVs | Experience bank, postings | counts |
| 7 | Profile → Cover letter | Letter check against your Writing preferences: length, generic lines | Fix it (redraft to your preferences) | Base letter, Writing preferences | AI |
| 9 | Profile → What we learned | A stance that may cost you jobs: "'needs sponsorship' on 9 UK forms, 8 no replies" | Review this answer | What we learned, outcomes | counts + AI |
| 14 | Interviews | Watch-outs by round type tied to outcomes: "3 of 4 rejections after a system-design round" | Add to my prep | Interviews, outcomes | counts + AI |
| 15 | Search strategy | Salary floor hiding matches: "14 jobs scored 80+ just under your floor" | Show these 14 jobs · Lower the floor to X | Strategy, scores | counts |
| A2 | Applying (Apply dialog) | "4 of the 10 jobs you picked ask for a cover letter; none tailored yet" | Tailor 4 letters | postings, letters | counts |
| A5 | Applying (before a job) | "You applied to this employer 3 weeks ago (another role)" | Apply anyway · Skip | applications | counts |

**The main CV is never changed** (owner, 28 Oct 2026, asked "Will the app modify the user main CV?", chose "Never touch it").
CV actions (#4 Forms are right, #5, #6) write to the Experience bank as a new entry kind "Added by you" (a bullet attached to a
main-CV role, or a correction such as "Python: 3 years"), visible and removable in Profile → Experience; tailoring reads it
through `withExtras` / `knownText` (`desktop/lib/experience.js`). When the person's own file still differs, the card says so
("Your own CV file still says 5"). PR 2 builds the new entry kind.

**Smarter on its own (no message)**

| # | What changes |
|---|---|
| 1 | Job fit reads your stances: fewer jobs you'd turn down; the job's reason line says why and links to the stance |
| 3 | Interview prep quotes what you told this employer on its form (notice, remote days, salary) |
| 10 | The CV match counts the Experience bank ("implied" → "found: in your bank") |
| 13 | "Tell me about yourself" / "why leaving" drafts go into the prep kit, in your words |
| 16 | Focus's daily insight is the strongest open insight from every screen |

**Dropped for the person:** #12 where applications stall (ours to fix: /admin). #11 "the question that stops your fills
most" (owner, 28 Oct 2026: "I don't see this valuable to be displayed in Applying"): it repeats drawer 1 "Fill your details",
which already ranks missing facts by how often forms ask. **Later:** #8 letters that got replies (needs
~20 sent letters; only with an action such as "Write letters like these").

## Acceptance criteria

1. Every insight on screen has at least one action button and its evidence; a test loops over every producer and fails on an
   insight without an action (class test).
2. Each action changes the thing it names, visible where it landed (place added, CV bullet added, answer saved), and the
   insight leaves its slot.
3. Not now hides 14 days; Not true never shows the same evidence again; both survive a restart (store, both adapters).
4. Tune my strategy's changes appear in Strategy → Suggestions (and Jobs when the list is thin); zero changes → shown nowhere.
5. On Monday, Focus shows the weekly analysis card with its top action; "Analyze now" appears between Mondays only past its
   trigger. Neither is on the Actions page any more; both stay in ⌘K.
6. Salary, demographics and criminal-record facts never appear in an insight shown outside their own screen.
7. Counts-only insights make no AI call (test with a client that throws). Each AI insight runs only when its evidence
   changed; its cost per run is measured on its PR before shipping.
8. Fresh install: no slot shows an insight without enough evidence (each producer states its minimum).

## Edge cases

- Contradictory insights (Add Zurich vs a stance "I wouldn't"): the verdict changes the learning first; producers re-read.
- An action that needs AI (Fix it, Add to my CV draft) on a capped Free AI day: the button says so and waits; never a guess.
- Several open insights on one screen: strongest first by the producer's score; "+N more" opens the list.

## Non-goals

- Your portrait (sibling spec). A new insights page. Changing how the daily insight is generated beyond picking.
- #12 for the person; #8 now.

## Shipping (each PR shippable alone)

| PR | What you get | Needs PR D |
|---|---|---|
| 1 | Insight card + states; home slots, Focus "Suggestions" section, Jobs collapsed bar; Tune and Analyze come to you | no |
| 2 | Profile → CV: #4, #5, #6 | yes |
| 3 | Strategy and Jobs: #2, #15; #1, #10 silently | yes |
| 4 | Interviews: #14; #3, #13 silently | yes |
| 5 | Applying, Cover letter, What we learned: A2, A5, #7, #9 | yes |
| 6 | Focus picks the strongest (#16) | after 2-5 |

## Progress

- [x] Spec approved by the owner (28 Oct 2026)
- [x] Design sketch approved (28 Oct 2026, https://claude.ai/artifact/Jpf5gETGzQsee5WoaTKZXy): one slot per screen, Not now = 14 days, PR 1 starts before PR D; Focus Suggestions + Jobs collapsed bar approved (v4)
- [ ] PR 1 · slot, states, actions come to you
- [ ] PR 2 · CV
- [ ] PR 3 · Strategy + Jobs
- [ ] PR 4 · Interviews
- [ ] PR 5 · Applying, Letter, What we learned
- [ ] PR 6 · Focus picks the strongest
