# About you, everywhere (What we learned PR D)

Status: approved by the owner (28 Oct 2026). Part of [What we learned about you](2026-10-28-what-we-learned-design.md)
([plan](../plans/2026-10-28-what-we-learned.md), PR D). Unblocks [Insights with actions](2026-10-28-insights-with-actions-design.md)
PRs 2-6 (branch `insights-actions`) and [Your portrait](2026-10-28-your-portrait-design.md) (branch `your-portrait`).

## The owner's problem (their words, 28 Oct 2026)

- "Doesn't it make sense this table to be fully green, in every cell? If we make use of all the knowledge we built about the
  user, wouldn't we better answer open questions in forms, better tailor CV, tailor cover letter, or kit answers?"
- "Let's have a modular/reusable interface of the user/profile knowledge. Whenever we'd want to give an insight, to give a
  review, to fill a form, to tailor a CV, we can have as much context as possible so that we can produce better quality."
- The owner calls it the "knowledge graph".

## Today (read from origin/main, 28 Oct 2026)

Each AI step reads its own subset; none reads What we learned, Form fills or Your details as a whole, and only CV tailoring
reads the Experience bank.

| Reader | Reads today | Code |
|---|---|---|
| Form filling (extension) | Your details contact (CV fallback), CV file, letter, site notes | `desktop/lib/server-contact.js` |
| Kit answers | Profile, answers page, posting | `src/ai/kit.py` |
| CV tailoring | main CV + Experience bank, Profile | `desktop/lib/kit-handlers.js:65-75` |
| Tailored letter | tailored CV, Profile, answers page, search preferences | `desktop/lib/job-letter.js` |
| Base letter | CV, Profile, answers page | `desktop/lib/cover-letter.js` |
| Job fit score | Profile, Strategy, salary | `src/ai/score.py` |
| CV match / CV check | CV (+ posting) | `desktop/lib/match-check.js`, `cv-check.js` |
| Daily insight, weekly analysis | applications, outcomes, interviews, Profile | `src/ai/insights.py`, `insights_data.py` |
| Interview prep / insights | posting, Profile, past interviews | `src/ai/prep.py`, `interview_insights.py` |
| Rejection review | Profile, interviews, letter | `src/ai/rejection.py` |
| Related roles | Profile, market words | `src/ai/role_ideas.py` |

## Design

**One interface, one bundle, parts by name.** `aboutYou(reader)` returns the parts that reader takes, minus that reader's
fixed exclusions. Readers never read the store pages or files for knowledge about the person themselves.

| Part | Holds | Source (one copy each) |
|---|---|---|
| `details` | Your details facts, work eligibility per zone | Profile contact + details (store) |
| `cv` | main CV + Experience bank (incl. "Added by you" bullets and corrections) | `cv/cv.json`, `cv/sources/` |
| `learned` | What we learned, one Q&A per topic, state; conflicts left out until resolved | `answers` page (store) |
| `strategy` | roles, places, salary floor, ways of working | search settings (store) |
| `history` | applications + outcomes, interview reviews | store tables |
| `voice` | base letter + Writing preferences | Cover letter (store, after PR B moves them) |
| `this_job` | what was sent to one employer on its form (on request, with a job) | Form fills log |

**Who takes what** (owner decisions 28 Oct 2026 marked ★):

| Reader | details | cv | learned | strategy | history | voice | this_job | Never gets |
|---|---|---|---|---|---|---|---|---|
| Form filling, kit answers | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| CV tailoring | ✅ | ✅ | summary only ★ | ✅ | — | — | — | salary, sensitive |
| Tailored letter | ✅ | ✅ | ✅ never salary ★ | ✅ | — | ✅ voice example | — | salary, sensitive |
| Job fit score | ✅ | ✅ | stances | ✅ | — | — | — | sensitive |
| Insights, Analyze my search | ✅ | ✅ | ✅ incl. salary | ✅ | ✅ | — | — | sensitive |
| Interview prep (one job) | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | sensitive |
| Interview insights, rejection review | ✅ | ✅ | ✅ | — | ✅ | — | — | sensitive |
| Your portrait | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | sensitive |

"Sensitive" = demographics (EEO), criminal record, disability: only ever into their own form fields. Raw Form fills reach
readers only through `learned`, except `this_job`. Nothing reads Your portrait.

**Size:** each reader has a budget; parts are trimmed by a fixed priority (details > learned > cv > strategy > history) so a
long history never pushes out facts. The added input cost per reader is measured on the PR.

**Open (decided in the PR's plan after reading the code):** the AI steps live on both sides: desktop JS (tailoring, letters,
form filling) and the Python engine (kit, score, insights, prep), which also runs in the cloud for scheduled jobs where
`cv/` files are not present. Options: (a) one builder on the desktop that hands the bundle to the engine steps it starts,
cloud runs taking the store-only parts; (b) one builder in the engine, the desktop calling it; (c) a builder per side over
one shared schema, held equal by a contract test on one fixture. Lean: (a) or (c); never two builders without the contract
test.

## Acceptance criteria

1. Every reader in the table takes its knowledge only through the interface: a test feeds a fixture with one unique fact per
   part and checks, through a fake AI client that records the prompt, that each reader's prompt holds exactly its parts
   (class test, one loop).
2. Exclusions hold: salary never reaches CV tailoring or a letter; sensitive facts reach no reader (same loop).
3. A conflict in What we learned reaches no reader until resolved.
4. Each changed prompt adds its cases to its case set and replays the whole set (`tools/prompt-cases.mjs`); the owner's cases
   include: a letter that must not mention salary, a CV summary that uses a learning, a form answer that uses an Experience
   bank bullet.
5. The added cost per reader is measured and shown to the owner before shipping (ask before spending).
6. Cloud runs without `cv/` files still work and name the parts they lacked.

## Non-goals

- New insights (sibling spec). The portrait itself. Changing what Your details or What we learned hold.

## Shipping

| PR | What you get |
|---|---|
| D1 | The interface + the writers: form filling, kit answers, CV tailoring, letters (base letter as voice) |
| D2 | The analysis readers: fit score, insights, Analyze my search, interview prep and insights, rejection review |

Builder: session 64 after PR B (owner, 28 Oct 2026).

## Progress

- [x] Spec approved by the owner (28 Oct 2026) (proof: none: the owner's yes in the coordinator session, relayed 28 Oct 2026)
- [x] Design sketch approved (28 Oct 2026, https://claude.ai/artifact/QkXa9AcY1FMtwg6wdBzNCm): two PRs, one builder on the Mac, cost shown first (proof: none: the owner's yes on the sketch)
- [ ] PR D1 · interface + writers
- [ ] PR D2 · analysis readers
