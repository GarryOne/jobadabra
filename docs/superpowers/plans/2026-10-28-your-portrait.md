# Plan: Your portrait

Spec: [2026-10-28-your-portrait-design.md](../specs/2026-10-28-your-portrait-design.md) (approved 28 Oct 2026; sketch
https://claude.ai/artifact/NbLpTtcz3XNSuR3gEBDjNw). Builder: not chosen yet. Starts after About you, everywhere PR D1 (the
interface it reads; PR D of the What we learned plan, split into D1/D2 in
[2026-10-28-about-you-everywhere.md](2026-10-28-about-you-everywhere.md), draft PR #2333). This draft PR carries the spec and plan and becomes the build PR (owner, 28 Oct 2026: "open individual
PRs with their specs and plans. To not forget about them").

## Tasks (one PR)

| Task | Files | Test (written first) |
|---|---|---|
| Writer: sections with minimums, states `not_yet` / `current` / `outdated`, at most one run a day and only when evidence changed | new `desktop/lib/portrait.js`; reads only `aboutYou('portrait')` | new `desktop/test/portrait.test.js`: minimums → `not_yet` with progress; counting fake client proves no run on unchanged evidence and ≤1 a day |
| Prompt: second person, every statement with evidence ids, personality as observed behaviour (no type labels), shared writing rules | new prompt beside `src/ai/writing_rules.py` users, its case set | cases: fresh install, sensitive facts present (must not appear), contradicting CV vs forms (states neither), soft skills with no label |
| Store: derived text + evidence list + date, one copy, both adapters | `desktop/lib/store/index.js` (new text page or section), SQLite + Notion adapters | `desktop/test/store-contract.test.js` extended: roundtrip on both |
| Tab: last Profile tab "Your portrait", subtitle, no editable control, chips open their source | `desktop/renderer/pages/profile-save-bar.js` (`PROFILE_TABS`), new `desktop/renderer/pages/portrait.js`, `desktop/renderer/index.html`, ⌘K entry | renderer test: no input/button that edits; every statement has a chip; chip opens its source |
| Nothing reads the portrait | `desktop/lib/about-you.js` has no portrait part | class test from PR D1 asserts it |
| What we learned note links here | `desktop/renderer/pages/application-answers.js` (note added in PR B2b, the second half of the What we learned plan's B2) | link test |

## Before shipping

- Cost per run measured (one strong writing call); shown to the owner before shipping.
- UI: render fictional data light + dark, wide + narrow, early (`not_yet`) and full states; ONE side-by-side
  (`npm run side-by-side`), owner's yes before the UI commit.

## Verification

Lint over changed JS, the fast push gate, the focused tests above; suites on CI. Ready = All checks passed + Gitar ✅ Approved
+ no unanswered comment.
