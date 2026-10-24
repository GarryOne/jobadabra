---
name: desktop-change
description: The fast, safe loop for any change to Jobadabra's desktop app (desktop/: main process, window pages, IPC) and the traps that caused real bugs. Use before editing desktop/ code, and when a UI change "doesn't show up", a state is stale, or a run/secret works on the owner's Mac only.
---

# Desktop change: the loop and the traps

## First, before writing any UI: the design system (owner, 18 Oct 2026)
`cd desktop && npm run design-system`, find the component for each value you will show, and build only from those (its "Don't / Do" pairs show what the
owner rejected). No new look outside it; a missing part goes into the shared components first. The owner checks the result on the before/after shots.

Before a PR, make ONE side-by-side image: reference (the owner's mockup, or today's screen as before) | your render, demo data, same scale, labelled
(`cd desktop && npm run side-by-side -- <reference.png> <render.png> --out <file.png>`). Light and dark are two images. The file name starts with the session's short name (`npm run side-by-side` adds it: `a2-<name>.png`), so the owner sees whose preview is open. `open` it for the owner and ask
(AskUserQuestion) ship / change what, with your recommendation; ship only after his yes. The PR's before/after stays the record (owner, 18 Oct 2026:
"Every session that works on UI, should open a preview image with side by side").

## Find, don't search
- **Code map:** `node desktop/scripts/codemap.mjs <words>` (every file → its purpose, live), open the one file you need, read only the part you change.
- A page's code: `desktop/renderer/pages/<page>.js`; its markup: `desktop/renderer/index.html` (grep the element id).
- Main ↔ window: `preload.cjs` (window.pilot.*) ↔ handlers in `main.js` and session handlers in `lib/session-handlers.js`. `test/ipc.test.js` checks both halves.

## The loop (small change: 5–10 minutes)
1. `tools/worktree.sh <topic>` (a worktree from origin/main with node_modules linked; never `npm install` in it);
   keep it after landing (`tools/worktree.sh prune` tidies landed ones older than 7 days).
2. Edit with anchored replacements: check the anchor exists (`assert old in s`). **Never cut code by index ranges**
   (`s[a:b]`) without printing the range first: it once deleted a whole render block.
3. `tools/check.sh --fast` while editing; `tools/check.sh --area desktop` before landing (selects runtimes and stages `shared/`).
4. UI: `npm run shot -- jobs --select '<css>' --eval "(async()=>{…click…; await new Promise(r=>setTimeout(r,500)); return 'ok'})()"`
   then Read the printed PNG. Pages other than the first: reach them by clicking (`.nav[data-view=settings]`, `[data-settings-go=…]`).
   State instead of pixels: `--eval "…JSON.stringify(…)" --no-picture`.
   For the PR: one table row per change, `| What changed | Before | After |`, the card cropped (`--select`) and the change framed (`--mark '<css>'`, same on both builds): docs/rules/desktop-ui.md.
5. Commit (trailers from the session), then `tools/ship.sh --background [--title="<the whole PR>" if 2+ commits] --body=<file>` (rebase, fast checks, a PR; CI runs the suites)
   and a Monitor on `^ship: (DONE|FAILED|REVIEW|MERGED|CLOSED|RED|GREEN)`. The owner merges every PR by hand: never push to main, never merge.
6. Tell the owner **⌘R** (window only) or **restart** (main.js, lib/, preload.cjs, Python changed).

## Traps that caused real bugs
| Trap | Rule |
|---|---|
| main.js / lib / preload changed, owner only pressed ⌘R | Say "restart the app" whenever the change is outside `renderer/`. A window newer than the app shows old data ("Off"). |
| State shown in several places, one not redrawn (session status, prep row, ✓ ticks, counts) | Find every view of that state (list, tray, menu badge, page) and update all from one function; keep state in one object. |
| Async detail fetched, then the *unmerged* object rendered | Render from the merged value (`run`), not the original (`shown`). |
| An empty answer cached forever (log not written yet) | Don't cache empty/placeholder results; retry a few times. |
| `el(tag, cls, icon(...))` | Fine now (nodes are appended). Text only otherwise. |
| An `#id` rule beats a new `.class` rule | Override with the same id selector, or check computed style in a shot. |
| Container narrower than the window | Use `@container` (the panel), not `@media` (the window). |
| AI JSON cut off ("Unterminated string") | Thinking uses `max_tokens`: give room (≥ 8000 for a structured answer), `effort: 'medium'`, check `stop_reason == 'max_tokens'` and say so. |
| A job runs but nothing reports back | Every run writes its ⏱️ Search runs row (start → end, log); user-started jobs always answer (Telegram / dialog), even "nothing new". |
| Fixed by hand for the owner (gh, Keychain, Notion) | Product bug: the Desktop App must do it for any user (CLAUDE.md rule). |
| Editing Python from a script right after JS | No `=>` or `const` in Python (happened twice): `python3 -c "import ast; ast.parse(open(f).read())"` before the tests. |
| Notion 429s | Notion's limit (~3/s) is shared by everything using the key: the app, its Python jobs (one pace file on the Mac) and **GitHub runs** (slower pace, `JOB_PILOTTO_NOTION_GAP_MS`). Read `logs/notion-requests.log` (who called what, status, ms) before guessing. |
| Values in CSS | Tokens only (`tokens.css`); `design.test.js` fails otherwise. |
| Demo data | Fictional only (`desktop/demo/`); add the case you need to render. |

## Session workflow scenarios
For question, resume, cancel, review handoff, startup or quit changes: extend `desktop/test/app-scenarios.test.js`.
Run `npm run test:scenarios` in desktop (also included in `tools/check.sh --fast` and full CI). Use real handlers
from `lib/session-handlers.js` and fictional external services; assert the window state and persistence after
restart. Never use real AI, Notion or browser tabs. These offline integration tests do not replace rendering.

## Before saying done
- Tests pass; the screen was rendered and looked at (or say why not).
- Report: what changed, commit id, ⌘R or restart, what is still open.
