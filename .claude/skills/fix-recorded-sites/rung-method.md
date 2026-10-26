# The rung method (a page judged or climbed wrong)

Moved from SKILL.md section 3b (pure move, 15 Oct 2026). Skill: `fix-recorded-sites`.

Map: `docs/flows/ladder.md` (rungs, owners, fixed answers, what may change). Spec: `docs/superpowers/specs/2026-10-10-ai-ladder.md`. Rule of the product: **never fix a website; fix a shape.** The site is one live sample.
Non-negotiables (the ladder designer's, job-pilotto-cc): the rung map first; the failing page captured as a fixture BEFORE the fix (`node desktop/e2e/ladder-capture.mjs`, seen wrong); the smallest fix at the lowest rung that has the information, data before code;
`npm run ladder-score` live and `--offline`; the baseline updated only with `--update-baseline "<why>"` (never edit an expectation to pass); a recorded page that fails on the old build; the commit trailers `Rung: <n>` and `Fixture: <id>`.

### R1. Find the rung that decided wrong (5 min, no edits)
- `/admin/form-filling/lab` pool table "Rung" column, or `logs/app.log`: `page kind: <kind> by ai|remembered`, `structure rule`, `closer look`, `takeover`.
- Map: by `ai` = rung 2, `remembered` = 1, structure rule = 0 (after unsure or no AI), digest = 3 (read its own answer: verb, numbers, what the app DROPPED), closer look = 4, takeover = 5.
- Say in one line: "decided at rung N, said X, truth is Y, because <the sketch shows / lacks Z>".
- Look at the sketch the rung really saw: `cd desktop && node e2e/ladder-capture.mjs --dir <scratch dir with one fixture json>` (read-only GET, bare Chromium) or the fixture of that shape in `desktop/e2e/ladder-fixtures/`.
  The usual causes: the Apply control is not in the first 20 buttons (navigation crowds it out); the page is a frame (`frames` only); the instruction is in text the sketch does not carry.

### R2. Make the case a fixture first (it must fail or be wrong-and-confident)
- Add `desktop/e2e/ladder-fixtures/<shape>.json` (`source`: captured for a real page via `capture.url`; invented/reconstructed for a shape written as `pages/<id>.html`), `expect.outcome` from the real page, `accept` only for what the code cannot say yet.
- `node e2e/ladder-capture.mjs --only <id>`, then `npm run ladder-score -- --only <id> --record` (plan path, no API key) stores what the model says today.
- Add it to the baseline: `npm run ladder-score -- --offline --update-baseline "<shape>: added, <status today>"`.

### R3. The smallest fix, lowest rung first (in this order)
1. **Data** at the rung that can see it: a kept answer, an alias/meaning in the pack, a recipe, an example in the prompt. 2. **A prompt line about the shape** (not the site) at that rung.
3. **The sketch**: carry what was missing (a candidate, a frame host), found by structure only. 4. **A signal** so a higher rung is asked (flow core: claim it, read its "Invariants:" block, say so to the coordinator).
**A prompt line reaches only its shape:** conditional on the sketch field that shows the shape (e.g. only when frames are listed), with its own fingerprint key, so other fixtures keep their stored answers (an unconditional line cost a 129-fixture re-record, 11 Oct).
Never: a site name, a vendor or word list, a regex over natural language (`tools/hardcoded-page-words.mjs`), a fix in a higher rung for what a lower rung could see.
Flow-core files (`page-kind.js`, `fill-flow.js`, `session-flow.js`, `escalate.js`…) are claimed first (CLAUDE.md "The flow core").

### R4. What to run (say each result)
| Run | Shows |
|---|---|
| `cd desktop && npm run ladder-score` | live on the plan: the fixture now right? rates per source; the wrong-and-confident list did not grow |
| **3 real asks** of the app's own AI on the fixture's page (`npm run ladder-score -- --only <id>` three times, plan path, no API key) | the fix must hold on **3 of 3**, not on the one answer you recorded: the AI's choice varies (11 Oct: Hornbach's first "Confirmed" was one lucky ask that named the working link; the next run named the dead one). A fix that holds 2 of 3 is not done; say the three results |
| `npm run ladder-score -- --offline` and `node --test test/ladder-ratchet.test.js` | no stored fixture got worse (what the push gate runs) |
| `cd desktop/e2e && npm run recorded` | fixed sites still replay (also with `REAL_EXTENSION_DIR=<old extension/>` it must FAIL: the positive control) |
| `cd desktop/e2e && npm run real-extension` | the extension alone, if `extension/` changed |
| `cd desktop && npm test`, `cd worker && npm test` | the rest |

### R5. Update the baseline honestly
- Better fixtures: `npm run ladder-score -- --offline --update-baseline "<what improved and why>"` (re-record the answers first with `--record` if the prompt changed).
- A fixture that got **worse** is a bug to fix, not a baseline edit. A deliberate trade-off needs the owner's say-so, written in the commit.
- A changed prompt or schema also fails the ratchet ("the prompt of rung N changed") until the answers are re-recorded (`--record`) and `--update-baseline` rewrites the prompt fingerprints.
- The push hook wants two trailers in a commit message of any push that touches flow code: `Rung: <0-6|router|judges>` and `Fixture: <fixture id | none: <why>>` (`tools/rung-trailer.mjs`; the id must exist in `desktop/e2e/ladder-fixtures/`).
- For a shape the pool run saved as a replay candidate: `node desktop/e2e/ladder-capture.mjs --from-candidates --only <shape>` writes a `cand-<shape>` fixture with `expect: pending`; set its real `expect.outcome` first.
- Never edit a fixture's `expect` to make it pass; the ratchet fails on an edited expectation unless the baseline is updated with a reason.
