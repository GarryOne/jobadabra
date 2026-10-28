# Plan: What we learned about you

Spec: [2026-10-28-what-we-learned-design.md](../specs/2026-10-28-what-we-learned-design.md). Sketch approved by the owner 28 Oct 2026:
https://claude.ai/artifact/3Bzz5uTwPLssMNodQsdbMn

**Supersedes:** the owner's 18 Oct 2026 "One queue for all" (`lib/details-review.js:1`, `lib/question-lists.js` openShown). Every Why
comment that cites it is updated in the PR that splits the queue, quoting the 28 Oct decision.

## Shape: 3 PRs, in order, each shippable alone

| PR | What the user gets | Tier | Depends on |
|---|---|---|---|
| A · Two drawers | Drawer 1 = missing Your details facts only (ranked); drawer 2 = the rest; cover letter its own card; per-company and duplicate items gone; tab renamed | 1 (UI + list logic) | — |
| B · Learnings | After each fill, the app concludes one Q&A per topic (state new / guessed / conflict), used at once; tab shows evidence + state chips; Confirm / Save change / Write the rule | 2 (store writes, AI call) | A |
| C · Remember by Apply mode | "Remember" (on by default) where you answer; Full automation recap | 2 (extension, flow core) | B |

Salary seeding from Strategy and the background-check split land in B (they are learnings). Notice period and eligibility per
country are Your details facts already (#2322 owns eligibility).

## PR A · Two drawers (this session)

Files:
- `desktop/lib/question-lists.js`: `openShown` returns `{details: [...], learned: [...]}` instead of one ranked list; the letter
  question leaves the list. Why comment updated (28 Oct supersedes 18 Oct).
- `desktop/lib/details-review.js`: header Why updated; items unchanged (already the Your details queue).
- `desktop/renderer/question-filter.js`: `ranked` used per list; a per-company verdict (`one_job`, and "how did you hear" /
  "worked here before" as topics answered per job) never reaches either list; one row per topic (`keyOf` → topic key).
- `desktop/renderer/pages/question-review.js`: opened with a `queue` argument (`details` | `learned`); title and buttons per
  queue (Save / Skip; Confirm / Save change / Later).
- `desktop/renderer/pages/jobs-questions.js`: two compact cards (amber "Fill your details · N missing", blue "What we learned · N to
  check"); each hidden at zero; the cover letter card separate.
- `desktop/renderer/pages/application-answers.js`: tab label "What we learned", card title "What we learned about you", filter
  All / New / Confirmed; Your details facts no longer listed here (`answers-facts.js` "Profile facts used in forms" removed).
- `desktop/renderer/index.html`, ⌘K entries (`nav.js`): both drawers reachable; renamed tab.

Tests (written first, watched failing):
- `desktop/test/question-queues.test.js` (new): fixture = the owner's 21-item queue of 27 Oct (fictional values) → drawer 1
  gets exactly the Your details items, ranked name/email first; drawer 2 has no duplicate topic, no per-company question, no
  cover letter; each count equals its list length.
- Update `test/question-lists.test.js`, `test/question-review.test.js`, `test/profile-tabs-render.test.js`,
  `test/answers-layout.test.js` where they assert the single queue (list each assertion changed in the PR body).

Preview: `npm run side-by-side` (file name starts `wwl-`), light + dark, wide + narrow: both cards, both drawers, the renamed tab.
Owner's yes before the UI commit.

## PR B · Learnings (hand-off brief after A is up)

**Open facts settled from code (coordinator, 28 Oct 2026):**
- **Where:** the `answers` page (`lib/store/index.js` TEXTS: `profile | answers | knowledge`). Every adapter already supports it,
  so the store contract (`test/store-contract.test.js`) stays unchanged. No new page.
- **Topic key:** fixed Your details facts keep the meanings pack's fixed `KEYS` (`shared/alias-schema.js`, `lib/aliases.js`).
  Open topics use the verdict's AI `topic` (`lib/question-reuse.js`), BUT a free topic drifts between batches ("willing to travel" vs
  "travel willingness"), so the learning call gets **the existing topics as a closed list** and must pick one or say "new". The
  code validates the pick against the list (repo rule "The AI decides; code validates"). This is what keeps one topic per entry.

- Store: learnings live on the `answers` page (it already is Q&A, one copy, every store). A line keeps `Question: answer` and gains
  a state mark beside the existing ❓ convention (`new`, `guessed`, `conflict`); confirmed = no mark. Evidence is read from the Form
  fills log at render time (no second copy).
- Writer: extend `lib/learn.js` (after each fill): `reusable` verdicts (`lib/question-reuse.js`) grouped by topic → one Q&A per
  topic, merged into the page: same topic + same meaning → evidence only; same topic + different answer → `conflict`.
  `widget` / `meaning` notes stay in Form knowledge (internal).
- Prompt change → add cases to the prompt's case set and replay the whole set (fixed cases: travel ×3 wordings, contract
  conflict, salary per country, a per-company question that must not be learned).
- Salary: first version seeded from Strategy's minimum per country. Background checks: willingness = learning; criminal-record
  disclosure = Your details fact.
- Migration: today's answered lines become confirmed learnings; lines that are Your details facts move there
  (`lib/answer-home.js`); nothing deleted.

## PR C · Remember by Apply mode (hand-off brief after B)

- Extension: the answer you type shows "Remember" (on; off when the question names the company). Full automation: recap after
  the run (answered / learned / this job only, with Change). Flow core: read the file's Invariants block first.

## Verification per PR

- Lint over changed JS, the fast push gate, the focused tests above; suites on CI only.
- `/code-review` in a fresh subagent before ship (owner's bug class), asked: does the test play the owner's scenario; which
  existing test asserts the opposite?
