# Files: one concern each, never over 500 lines

Linked from CLAUDE.md. Why: [why.md](why.md#files).

## The cap (owner, 8 Oct 2026)
- **No source file (.js, .mjs, .cjs, .py) over 500 lines.** About to cross it? Move a concern into its own file first (the pattern:
  `lib/session-flow.js`, `extension/fill-flow.js`: shared state passed in, a header naming what it owns and the tests guarding it).
- Files already over it are in `tools/file-size-allowed.json` at their size and may only shrink; `tools/file-size.mjs` (push hook +
  `desktop/test/file-size.test.js`) fails a new big file or a listed one that grew.
- A classic content script can be split: `extension/page/fill.js` became six files, injected in order (`extension/page-files.js`), sharing helpers through
  `window.__jobPilottoFillKit`; the panel `extension/review.js` became four (`extension/panel-files.js`: form reading, markup, learning, the panel), sharing
  `window.__jobPilottoPanel*`. `EXCEPTIONS` in `tools/file-size.mjs` is empty (15 Oct 2026).

## Split before you reach it (owner, 11 Oct 2026)
A file near 450 lines is split into 2 to 4 files by concern, as a pure move in its own commit, not squeezed under the cap with helpers parked in a
neighbour. Before adding to a file over ~450 lines, say so and hand the split to its own session with a brief (a flow-core file: with the claim and
a quiet window). `tools/file-size.mjs` warns (never blocks) when a change touches a file of 450 to 500 lines.

## Splitting a file safely
- **Pure move, nothing else.** Same code, same names; the new file starts with a header: what it owns, which tests guard it.
- **State:** a `let` that is reassigned stays ONE binding: pass a getter (`getWindow: () => window`) and, if the module sets it, a setter. Never
  by value (it freezes `null`). Values `main.js` still needs come back as a return value; groups that use them are registered AFTER it.
- **Calls stay put:** `register…Handlers(` calls of earlier splits inside your cut range stay in `main.js`; imports it still needs are restored
  from `git show HEAD:…`, never guessed. Recompute ranges from names, not line numbers.
- **Prove it runs:** tests that read `main.js`'s source go through `test/main-source.js`; then START the app (`npm run shot -- sessions`). A moved
  flow file is added to `FLOW_FILES`; run `npm run flows`.
- **Tests that read the old file by name follow the code** (`git grep -ln "<old file name>" -- desktop/test desktop/e2e/test tests`, no quotes: a test
  names it in a path, `'../../src/ai/score.py'`): point the ones whose pattern moved at the new file in the same pure commit, then run each of them by name
  (25 Oct 2026: activity-result-bottom.js left run-compact and visits-view-jobs red; 27 Oct 2026, #2205: the score bands left score.py, fit-tooltip.test.js red).
- **Land fast:** rebase right before the push and port what others changed in the moved range.
- **A migration or move is its own pure commit**, in a quiet window announced to all peers, never mixed with behaviour changes.
