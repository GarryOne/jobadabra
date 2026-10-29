# Keep the fast code, end the dead ends, learn as data (design review, 12 Oct 2026)

> **Verdict:** keep everything that works today as the **fast tier** (free, instant). Change one thing: **no dead ends.** Where today's code gives
> up or needs a condition it does not have, it asks **one universal question** ("what is the next move here?", escalated by the ladder) instead of
> a new branch being written. A move that the page confirms is **kept as data** for that page shape, so the next visit takes the fast tier again.
> From now on, decision fixes are **data** (a fixture, an example, a learned move, a pack entry); code changes only where code is the right home:
> reading the page, operating a control, the safety floors.
>
> Status: **approved by the owner, 12 Oct 2026 (decisions 1-4: yes).** Implementation: session job-pilotto-next-move. (Replaces this file's first
> version, "one next move replaces the chain".)

## What the data says (measured 12 Oct 2026)
| Source | Finding |
|---|---|
| CI + Mac pool, 75 rows, last run each | **form 36, ready 1** · stopped before the form: **account 10, posting 6, none 2** (dead ends) · bot check 4 (correct stop) |
| Pool flows (sites) | posting → form 25 · **posting → account 16** · posting → other page 9 · account and form on one page 4 |
| 20-row CI test, field level | ~94% of fields handled (filled or proposed to confirm); real misses 6% |
| Scorecard (real use) | Ashby "Blind spot": 28% of matched jobs, real forms 59% filled; Greenhouse 45% of matches, fine |
| Applying commits, last 4 days (226, by subject) | **perception 66 · actuation 40** (reading the page, operating controls) · decision 46 · timing/tabs 23 · answers 7 · floors 7 · other 37 |
| Learned data in D1 (shared, served as a pack) | meanings 218 (mostly seeded) · aliases 33 · **recipes 1** · control outcomes 4 · meaning votes 0 · application outcomes 0 |
| Learned data on the owner's Mac | page kinds kept: **3** (one of them the weak Amazon answer) · verified ladder learning: **none** |
| The decision code | `fill-flow.js consider()` 195 lines; 13 page-kind answer fields each read by a branch; 5 mechanisms in fixed order for a page with no form |

**Reading it:** about half of the code fixes (perception, actuation) are **universal by nature**: a better menu handler or label reader helps every site.
That code is the speed and the 94%, and it stays. The brittleness is in the **decision layer** (what kind, what next): a chain of gates where one
missing condition stops everything (Amazon), and every new shape became a new branch. And the **data path that should carry learning is almost
empty**: fixes went into code, real installs are few, and the CI pool's verified runs are not fed back (`applying report: not sent (CI)`).

## The design: three layers
| Layer | Home | Changes how |
|---|---|---|
| **1 Perceive and act** (page sketch, frames, layers, required marks; menus, typeahead, upload, retype; the fill per field) | **code, kept** | universal shape fixes, each with a widget-zoo page or recorded case. Unchanged. |
| **2 Decide** (which button, which route, what kind, when to stop) | **today's code = fast tier, kept** + **one universal fallback** | no new branches. Every dead end calls the fallback: the one question, escalated by the ladder (kept move → sketch → digest → picture → Claude → person). |
| **3 Learn** (kept moves per page shape, meanings, aliases, examples) | **data** | a move the page confirmed (the form came, the value stayed) is kept for the shape; shared through the existing pack (k ≥ 3, fixed values only). Fed by real use **and the CI pool**. |

**Floors** (code, unchanged, at every layer): never Submit, never a consent on an application, never a bot check or SMS code, never read a password
field, one press per control per tab, only the page's own controls, only fields that are part of applying.

### The fallback and its escalation (the owner's question: yes, the ladder stays)
| Rung | What | Speed | Climbs when |
|---|---|---|---|
| fast tier | today's code paths, kept kinds and moves | instant, $0 | it reaches a dead end |
| 2 sketch | the question on the page as text, small model | ~1-3 s | unsure, refused by a floor, or the move did not work |
| 3 digest | numbered candidates + what was tried and why it failed | ~3-5 s | same |
| 4 picture | the same with a screenshot, strongest model | ~10-20 s | same |
| 5 Claude | takes over the tab (the person's press or the 5 s countdown, once per application) | minutes | it cannot finish |
| 6 person | told exactly what to do, quoting the page | | |

"Don't know" is a fixed signal (`extension/ladder/core.js`): unsure (< 0.8), contradicted (a kept move fails), stalled (pressed and nothing changed,
filled and the value did not stay, the same state twice), failed, or refused by a floor. Each climb carries what was tried. Speed comes back by
learning: what rung 4 solved and the page confirmed is the fast tier's next time.

## Why this keeps speed and reliability
- **Pages that work today take exactly today's path** (the fast tier is untouched): same speed, same result.
- **The fallback only runs where today ends at a dead end** (account 10, posting 6, none 2 of 75 pool rows): it can only add reach there.
- **Its one risk** is acting where stopping was right: guarded by the floors, by verification (a move that changed nothing is not repeated), and
  by a shadow phase first.
- **Cost** is spent only at dead ends, and drops as moves are learned.

## The rule for every fix from now on (into `docs/flows/ladder.md` and CLAUDE.md after the OK)
| The failure | The fix is | Not |
|---|---|---|
| Wrong or no decision on a page (which button, route, kind, when to stop) | **data:** a ladder fixture + prompt example, or a learned move | a new branch or answer field |
| A field or control not read | code in perception, with a recorded or zoo page | a site-specific case |
| A control not operated | code in actuation (a widget handler), with a zoo page | a site-specific case |
| A wrong value or wording | **data:** the meanings/aliases pack, the applicant facts | a word list in code |
| A safety gap | code in the floors | |

**Guard:** a ratchet test on the decision code: the number of page-kind/role conditions in `consider()` and the account step may only go down.
A commit adding one fails with "a decision is data: add a fixture or a learned move, or say why in `Decision-branch: <why>` (owner's OK)".

## Phases (each with its proof)
0. **Already done:** an account page with no step was a dead end (the owner's Amazon case): every account page now gets the normal fill (#486, 8691f97).
1. **Feed the learning that exists.** The CI pool and the recorded replays report their verified moves into the ladder learning (fixed values only,
   as today's `counts()`), so the pack fills with confirmed moves. Proof: after one CI pool pass, kept moves appear for the rows that reached a form.
   Same phase, learning hygiene: rung 1 keeps an answer only when sure (>= 0.8, and an account page only with its step); a weak kept answer is asked
   again. Ready on branch `weak-answer-not-kept` (cc, 12 Oct: `KEEP_FROM`/`sureToKeep` in `rung2-sketch.js`, a page-kind test and a journey scenario).
2. **End the dead ends, in shadow.** At each dead end of `consider()` (no Apply found, account page with no step, nothing filled, "other"), the
   fallback is asked and its move logged beside what happened. Proof: ladder fixtures and recorded pages offline (plan path, $0), one CI pool pass;
   switch on only if no fixture source is worse, the wrong-and-confident list is not longer, and the cost per application is shown to the owner.
3. **Switch the fallback on** at the dead ends; add the ratchet; write the fix rule into the rules.
4. Later and only by data: a fast-tier branch whose job the fallback plus learning always does as well may be deleted, one at a time, with its
   recorded cases green. Nothing is deleted for its own sake.

## Phase 1 as built (12 Oct 2026, session job-pilotto-next-move)
**What counts as a confirmed move** (the page said so; fixed values only: shape, rung, kind, outcome, hits, misses):
| The page did | Counted as | Where |
|---|---|---|
| Apply pressed (by the AI's button, the shared phrases or the structure rule) → a form came on the page | `posting → form`, the rung that decided (0-2) | `extension/ladder/climb.js` `confirmedBody`, `fill-flow.js` |
| A page judged a form took values from the fill | `form → form` (or `account-form`) | same |
| A learned answer was right again | a hit | same (`confirmed: true`) |
| The digest's press led to a form | kept, as before (rung 3) | `verifiedBody` |
The fast tier's moves (rungs 0-2) are **counted, never kept** (`learning.js` `confirm`): rung 1's own store stays the decision, so nothing a page gets changes.

**Where the counts go** (one table, `ladder_moves`, each row marked with its source; served to nobody yet, phase 3 adds the pack's k ≥ 3):
| Source | Sent by | Marked | Key |
|---|---|---|---|
| Real use | the app's learning batch (`ladder`, `lib/recipes.js`) | `user` (hashed install) | the install |
| CI pool | `desktop/e2e/pool-moves.mjs` after each run (each row's app log) | `ci` (`ci:<run>`) | CI's narrow `REPLAYS_PUBLISH_KEY` |
| Recorded replays | `desktop/e2e/replays-report.mjs` on a push to main | `replay` (once per move) | same |
A test source claimed without the key is dropped and flagged (`ladder-source`), never stored as a user's. The owner reads every move per source: `GET /api/ladder-moves`.

**Found on the way:** the learning store refused every shape with 8 or more fields (`|f8+`: the shape pattern had no `+`), so no real form could ever be counted. Fixed in both stores, with a test over every build bucket.

## Phase 1a: the outcome contract and the resolution score (owner, 12 Oct 2026)
> Every application ends in exactly ONE fixed ending; the score is the share that ends resolved. Every `deadEnd()` and every "the person is needed" answer names one.

| Ending | Means | Counted |
|---|---|---|
| `ready` | the form is reached; everything left is the person's choice or a proposal | resolved |
| `told` | the page says how to apply another way (email, phone, in person) or that the job is closed, quoting the page | resolved |
| `handed` | a real wall the run names: a bot check on a person's address, an SMS or emailed code, a sign-in to an existing account; resumes by itself after | resolved |
| `blind` | a control or page the AI could not see (recorded: the perception queue) | resolved |
| `data_missing` | a fact we truly lack (no answer in the kit, Profile or details; asked once, can be remembered). The AI declining or unsure is OUR miss: `unresolved`, counted apart | resolved |
| `site_broken` | the page could not be read, errors, a posting gone: retried N times, then told plainly (new class) | resolved |
| `unresolved` | anything else: a stop with no reason, a field we missed, a loop | **a counted bug** |
| *held by the test* | the pool's own holds: never an account button with fake data (account-first, the account step), a bot wall on a CI runner's address | **not measured**: out of the denominator, shown apart |

- **The list:** `extension/ladder/endings.js` (`ENDINGS`; imported, never copied: extension, app, harness, site).
- **The classifier:** `desktop/e2e/lib/ending.mjs` `endingOf(result, appLog)`, pure, over a pool row's existing report (reached, the run parser's notes, each required field's reason via the fill card's `causeOf`, the extension's own stop line). The worst required field decides a form: we missed it > not seen > the person's data > the person's choice. Every trace word it reads is a named constant with a guard test that the code still writes it (a reworded reason fails a test, never silently moves rows).
- **The baseline, no new run** (measured from the Mac pool 10-12 Oct + 18 CI artifacts, newest run per row):

| Measured 52 rows | |
|---|---|
| **unresolved** | **6**: 4 options not matched or not committed (Datadog, HelloFresh, nebius, Hadrian), 2 ladder ends with nothing to say (Bulgari, H&M) |
| ready | 29 |
| data_missing · handed · site_broken · blind · told | 7 · 4 · 3 · 2 · 1 |
| held by the test (not measured) | 12 (9 account-first, 1 account step, 2 CI bot walls) |
| **Resolution** | **raw 88% · weighted by real demand 74%** (scorecard match share; platforms covering 85% of matches). Rows behind it: Greenhouse 45% → 2, Ashby 28% → 1, SmartRecruiters 13% → 0, Lever 3% → 1, Workday · SuccessFactors · Personio · Recruitee 2% each → 2 · 1 · 1 · 1, Teamtailor 1% → 1: **one Greenhouse row moves it by 26 points** (45 × ½ ÷ 85) |

- **Not split yet:** the 7 `data_missing` rows read "no answer in the kit"; the report does not record whether the AI was asked for those fields (the evidence's `ai-calls.json` does): a follow-up can move AI misses among them to `unresolved`.
- **The classifier checked by hand:** 19 rows against their end screenshots, every ending: 16 agreed; two classifier rules fixed (a cookie bar under a reached form is not the ending; a sign-up page with only contact details and passwords is the account step), now 18/19. The last miss is the report's own: TechTree's required radio, robot checkbox and terms are recorded as optional (required marks unread): a perception finding (passed to job-pilotto-fill-ladder; a "not a robot" checkbox is a bot check: always the person's, never ticked).
- **Every run from now on:** the ending goes into each CI pool row and onto `/admin/applying` as the headline **Resolution** tile (raw, weighted by real demand, weekly trend; one batched D1 write of changed rows). The replays section becomes "Shape regression tests" below it (origin per case, "proven" only by the live layer).
- **Page-level ending tests** (fixture pages, each proving the ending AND the resume): a bot check that clears and the form fills after; a sign-in followed by the form; an apply-by-email posting; a page that returns errors (`site_broken`). The field level (`blind`, `data_missing`) is job-pilotto-fill-ladder's.
- **Switch criteria (both ladders) gain:** resolution does not drop; unresolved shrinks.

## Detecting a dead end (owner's question, 12 Oct 2026; built in phase 2)
> A dead-end detector must not become a new chain of conditions.

| Kind | Rule | Why it is reliable |
|---|---|---|
| **Explicit** | every give-up in `consider()` (stuck account / no-form / incomplete / other / told / email, any return with no fill and no move) goes through ONE `deadEnd(reason, evidence)`; a guard test fails on a direct `stuck()` outside it | by construction: the code admits it |
| **Silent** | ONE rule, no list: no **progress** within T s after the page settled, unless the page is a declared person-stop (bot check, password, consent, SMS code, Submit) or done (required left 0). Progress = observable events only: the tab navigated; the control set changed (new fields); a field got a value that stayed; the panel's required-left count went down | T is **measured** in shadow: the gaps between progress events on every CI pool row; T sits above the slowest normal gap (start ~20 s; a normal fill takes 10-30 s; Ocado's stall was 150 s) |

- **Measured apart, before the fallback:** on the pool's ground truth (rows that ended before a form vs rows that reached it): **recall** (fires on the stopped rows) and **false fires** (on the reached ones). Both are switch-on criteria.
- **Degrades to today:** a miss = today's behaviour; a false fire = one extra ask, and the floors block harm.

## Making the next move right (owner's question, 12 Oct 2026; built in phase 2)
1. Answers only **by number** from the page's own fields and controls, plus fixed verbs (fill / press / person); the code validates (as the digest does).
2. **Floors before acting** (unchanged).
3. Confidence < 0.8 = climb, never act. A **press** is asked twice at rung 2 and acted on only if both agree (the `worthRetry` pattern).
4. **Expected effect per verb**, checked right after acting: fill = the value stayed; an apply-type press = a form, or a new page WITH FIELDS for this job; a continue-type press = the page changed and no required value was lost. No effect = failed: never repeated, and the next rung is asked with "tried X, observed Y".
5. Worst case = today: the person, told.
6. Learn only confirmed moves; drop one on its first miss.

**Measured before users:** offline, `npm run ladder-score` on fixtures that carry an expected MOVE (right / wrong / wrong-and-confident); live in CI, the CI pool (fake applicant, held, never Submit) runs the fallback **acting**, not in shadow, so each dead-end row gets a measured **unblock rate** (did the expected effect happen). Users stay in shadow until the switch criteria hold.
**Residual risk:** a wrong move that still produces the expected effect (the account route also leads to a form). The effects are made specific; the form judge and the fill check catch the rest.

## When the AI misses data, context, DOM or screenshot (owner's question, 12 Oct 2026; built in phase 2)
1. The answer gets one more option: `not_listed` + a short description ("the control I need is not in the list"). It becomes a fixed signal (e.g. `blind`) that climbs straight to the picture rung. **A new signal changes `extension/ladder/core.js` invariant 1 (the fixed lists): the owner's call, said in that commit.**
2. A picture-vs-sketch cross-check: when the screenshot shows clearly more controls than the sketch listed, the page is flagged as a partial view before anyone acts on it.
3. A blind spot the picture confirms is **recorded as data** (page shape + what was missing, fixed values only): the queue for universal perception fixes (code with a zoo or recorded page, the one place code is the right home). This time the page climbs to Claude or the person; never a guess.
4. The blind-spot rate per rung, from the CI pool, daily; the widget zoo's coverage of control shapes stays the reader's scoreboard.

## Switch-on criteria (phase 3, all must hold, per dead end)
| Criterion | Measured by |
|---|---|
| No fixture source worse; the wrong-and-confident list not longer | `npm run ladder-score` (plan path, $0) |
| Median time per page within +1 s | the CI pool and the recorded pages, both ways |
| The dead-end detector's recall and false fires | the CI pool's ground truth |
| The fallback's unblock rate per dead-end row | the CI pool, acting |
| The AI cost per application | shown to the owner and OK'd |
| Resolution does not drop; unresolved shrinks (both ladders) | the classifier over the CI pool (phase 1a) |

**Switched on per dead end, not all at once** (owner, 13 Oct 2026: "yes to both"): each dead end gets the fallback for users as soon as ITS numbers hold, so the flow gets better
PR by PR. Order: the account page with no step (10 of 75 pool rows), the posting with no Apply found (6), nothing found (2), then the silent dead ends. Per dead end, all must hold:
- **N real occurrences in shadow:** at least 5 on the CI pool, each with the question's move logged beside the stop.
- **An agree / better / worse table** computed from the row's real ending, joined to the move by the door's id (never judged by hand).
- **Zero wrong-and-confident** moves; a move a floor refuses in shadow counts as "would not act", never as "better".
- **Its climb** (sketch -> digest -> picture), or a measured reason the digest alone suffices at that dead end.
- **Acting in the CI pool first:** its unblock rate on the pool before any user sees it.
- **The AI cost per application** shown, and **the owner's OK for that dead end**.

**Spend** (owner, 13 Oct 2026): the shadow question (the digest, small model) may run on CI pool runs: about $0.0004 an ask, about $0.01 per 75-row pass, measured on the first run.

## Open items
- **The success measure:** site-named commits per week, and a new site working with no code; weekly, from git `Pool-row` lines and the pool.
- **"Wrong but progressing" fast-tier moves** are not caught by dead-end detection: the expected-effect check and `fill_verify` cover them (follow-up).
- **Serving the moves** (phase 3): the pack's k ≥ 3 installs for `user`; whether a `ci`-confirmed move may be served alone is the owner's call.

## Trade-offs
| | Today | This design |
|---|---|---|
| Known pages | fast tier | **the same** |
| A new page shape | a new branch (code), after someone notices | the fallback handles it now; the fix, if any, is data |
| AI cost | page kind once per shape; digest/picture on some stalls | **more only at dead ends**, falling as moves are learned |
| Predictability | branches | branches + a logged fallback (its reason in the log) |
| Risk | dead ends | the fallback acting where stopping was right: floors, verification, shadow |
| Code size | grows with every shape | decision code frozen (ratchet); perception/actuation grow only by universal shapes |

## Decisions for the owner
1. This direction: keep the fast code, end the dead ends with one escalating fallback, learn as data. **Recommended: yes.**
2. Phase 1 first (feed the existing learning from the CI pool and replays). **Recommended: yes**: cheap, no flow change.
3. Phase 2 in shadow before any switch. **Recommended: yes.**
4. From now on: decision fixes are data; the ratchet on decision branches. **Recommended: yes.**

## Progress
### 1. Owner's decision on the design
- [x] decisions 1-4: yes to all (12 Oct 2026)
### 2. Phase 0: an account page with no step gets the normal fill
- [x] every account page gets the normal fill (#486, 8691f97)
### 3. Phase 1: the CI pool and the replays feed the learning; keep only sure answers
- [x] moves the page confirmed are counted at every rung; CI pool + replays send them marked `ci` / `replay`; site `ladder_moves`; rung 1 keeps only sure answers (#495)
- [x] proof (CI pool run 38271835969, $0.04): 1 of 1 rows that reached a form confirmed its moves, stored as `ci`; the replays on main sent 39 (`replay`)
### 4. Phase 1a: the outcome contract and the resolution score
- [x] the endings list, the classifier, the baseline with no new run, the hand-check 18/19 (#497)
- [x] each pool row's ending (CI summary, Mac upload, `PUT /applying/endings`); the Resolution tile heads /admin/applying; the replays are "Shape regression tests" with each case's origin (#501)
- [x] page-level ending tests: a bot check that clears, a sign-in then the form, apply by email; every stuck reason maps to an ending; handed resumes (#516)
- [x] site_broken: an error page is retried, then reported as site_broken; its page-level ending test (#524)
### 5. Phase 2: the fallback at each dead end, in shadow
- [x] one dead-end door: every give-up in `consider()` goes through `deadEnd(reason, evidence)`; a guard test (#525)
- [x] silent dead ends: the one progress rule, its T measured on the CI pool: 30 s with the asks to the app taken out (slowest quiet gap 18.8 s; 0 false fires of 9 rows, recall 1/1; the pool cuts a quiet stall at 20 s) (proof: worker/test/silence.test.js)
- [x] the dead-end detector measured: recall and false fires on the pool's ground truth (T 30 s with asks out: recall 1/1, false fires 0/9 on 12 rows; wall time 1/9) (proof: desktop/e2e/test/pool-gaps.test.mjs)
- [x] the one question at each dead end, in shadow, logged beside what happened ("dead end fallback (shadow)" lines on the pool: asked, asked already, picture_off) (proof: worker/test/fallback.test.js @dc5d06f)
- [x] the next move checked: numbered answers, two agreeing asks for a press, an expected effect per verb (ladder/next-move.js: logged in shadow; the effect is checked when the CI pool acts, box 8) (proof: worker/test/next-move.test.js)
- [x] not_listed / blind, and the picture confirms it in CI pool runs (the owner's OK for the signal and for the screenshot step in CI only; the stop stays `other`/unresolved unless the control the picture names leads to a form) (proof: worker/test/blind-picture.test.js)
- [x] the picture-vs-sketch cross-check (more controls shown than listed: a partial view flagged) and the blind spots recorded as data for universal perception fixes: the picture counts the buttons and links it shows, 3 or more over what the sketch lists is a partial view, logged as numbers and counted on the pool summary's screenshot line (proof: worker/test/picture-crosscheck.test.js)
- [x] fixtures with an expected move, labelled only from a pool run that pressed a listed control and then reached a form; `npm run ladder-score -- --moves` both ways (10 fixtures: the digest right on 10, 4 of them unsure, 0 wrong-and-confident) (proof: desktop/test/ladder-move-score.test.js)
- ~~the dead-end fixtures' moves from a replay's confirmed press~~: dropped (owner, 13 Oct 2026): recorded replays run on a stand-in app that writes no pressed label and 80 of 90 cases are hand-cut, so a replay's "confirmed" is weaker than the pool's; the pool source grows with every run
- ~~the dead-end fixtures' moves from the row-to-case cases of dead-end rows~~: dropped (owner, 13 Oct 2026): none exist (the 10 captured cases are form-field shapes, none a posting-to-form press) and real dead-end rows are already the pool source
- ~~the dead-end fixtures' moves from a dead end the person or the takeover resolved~~: deferred (owner, 13 Oct 2026) until installs exist: the CI pool has no person and starts no takeover, so nothing can be recorded there; the spec `docs/superpowers/specs/2026-10-13-dead-end-resolved-by.md` stays as the design (see Discussion #613). Now: 12 pool-confirmed moves, 1 dead end (the pool source); 2 pages the numbered list lacked are labelled `not_listed` and the digest answered "none" there (recall 0/2, 0 wrong-and-confident; rung 2 covers both today)
- [x] the CI pool acting: unblock rate per dead-end row; time and $ per page and per application. Measured 13 Oct 2026 (9 rows dispatched, 5 reached a report, 2 stops on one row, a Workday create-account page): 0 acted presses, 0 worse by effect, unblock rate 0% (nothing to press), batch AI cost $0.105 (proof: desktop/e2e/pool-acted.mjs @dfaf31e)
### 6. Phase 3: switch on per dead end, the ratchet, the fix rule
- [ ] step 1 "name the hand-off" (verb: person) switched on: when the fallback's answer is "person" (the digest's tell_person, or the look with the picture's ask_person) the panel says the need at once instead of after 30 s of silence; nothing is pressed. Criterion: the precision of "person" on the pooled stops (a row that went on to the form without a person makes it wrong), 0 wrong-and-confident, shadow evidence is enough; the owner OKs it. Stays in shadow until the pool shows at least 10 person answers, 0 wrong (owner, 13 Oct 2026; 1 of 1 so far; see Discussion #613)
- ~~step 2 "press" (verb: press) switched on: an Apply-type press that passes the floors after two agreeing asks, pooled across the doors: at least 10 presses acted in the CI pool, 0 worse (judged by effect: it led to a sign-in or password page, or left the application), the unblock rate and the cost shown; the owner OKs it~~: deferred to installs (owner, 13 Oct 2026): 0 acted presses in ~60 pool rows, 11 stops, all nothing-to-press; the per-door kill switch stays as is; see Discussion #613
- [x] the per-verb table: person precision and the would_act bucket, from the pool's logs and each row's final reading (owner, 13 Oct 2026: phase 3 is switched on by verb, not by door) (proof: desktop/e2e/test/pool-shadow.test.mjs)
- Filling stays fill-ladder's. Per-door counts stay in the table as a kill switch: a door with a worse row is held back while the others go on.
- [x] the decision-branch ratchet test (tools/decision-branches.mjs: consider() 21, the account step 15, may only go down) (proof: desktop/test/decision-branches.test.js)
- [x] the fix rule in CLAUDE.md ("Where a fix lives", c64d4ee)
- [x] the fix rule in docs/flows/ladder.md ("Where a fix lives") (proof: docs/flows/ladder.md)
### 7. Phase 4: retire fast-tier branches only by data
- [ ] a branch the fallback + learning always match is retired, one at a time, its recorded cases green
