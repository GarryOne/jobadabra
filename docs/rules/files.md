# Files: one concern each, never over 500 lines

Linked from CLAUDE.md. Why: [why.md](why.md#files), [why comments](why.md#why-comments-27-oct-2026).

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

## Comments
Comments carry what the code cannot say: why, and what must stay true (owner, 27 Oct 2026). For code a commit writes or touches; never a mass rewrite.
- **Why, not what:** business rules, hidden dependencies, constraints. Never restate the syntax or narrate the steps.
- **New exported function:** a doc comment right above it (or a Python docstring): what it takes, what it returns, what it does on a failure, where its
  data comes from. The repo's one-line form is fine (`// -> the pick, or null when none (read from the store)`).
- **Invariants and assumptions:** say them where they hold ("input sorted, non-empty", "the heavy lock is held"); the 5 flow-core files keep their
  `Invariants:` blocks (docs/rules/applying.md).
- **Debt:** `TODO(AI): <what is left> (<date or #PR>)` or `FIXME: <what is wrong>`; never a bare "TODO" or "fix later".
- **Gate** (`tools/new-code-comments.mjs`, the push's fast checks): a new exported function with no doc comment, a debt note without its tag. The rest is this rule.

### Why comments
A line that encodes a decision says why, so the next session does not undo it without knowing (owner, 27 Oct 2026).
- **Form:** one line, `// Why (<PR or date>[, owner]): <reason>` (`#` in Python, shell, YAML), right above the line or trailing it. `owner` when it was his choice.
  More lines may follow as plain comment lines; a labelled line (`Usage:`, `Tests:`, `Used by`) ends them.
- **When:** an owner's choice, a fix for an incident, a guard, a "looks wrong but is right", a prompt sentence added for a case.
  Never a comment that narrates what the code does. `// Why a job has no score` (a function's description) is not one: only `Why:` and `Why (…):` count.
- **Prompts:** a comment cannot sit inside the string, so the Why above the prompt const quotes its sentence in backticks:
  ``// Why (#2203): `names neither a currency nor a period` — form 106 stayed empty``. The gate then guards those words (3+ words, found in that const), not the whole prompt line.
  A backticked name or path (`` `retryCount` ``) is not a sentence: the line under the Why stays guarded.
  A comment explains; the prompt's case set protects (a test that replays the case).
- **What the gate guards** (`tools/why-changed.mjs`, in the push's fast checks): the Why's own lines, the first code line under them (not under a file's header),
  the line a trailing Why sits on, and a quoted prompt sentence. Deleting or rewriting one needs `Why-changed: <which Why> — <reason>` in a commit message
  of the push. Free: a new Why, a pure move or re-indent (the same lines come back elsewhere in the push), any other line.
- **Before you change a guarded line:** read the Why and its PR (`gh pr view <n>`). Still wrong? Change it, and in the same commit update the Why to the new
  reason or remove it, then say it in the trailer. **A stale Why is refused even with the trailer** (the line under it changed, the Why did not): an
  outdated comment misleads the next session more than none, because it trusts the comment over the code.
  Over main's last 300 commits the gate would have asked 4 times, each an edit of a Why or the line under it (one of them stale).
