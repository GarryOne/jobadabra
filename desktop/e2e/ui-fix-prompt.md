You fix ONE problem in Jobadabra: in the desktop window (Electron; pages in desktop/renderer/, styles in desktop/renderer/style.css, tokens in tokens.css), or, for a confirmed logic bug, in the Python engine (src/) or the app's logic (desktop/lib/).
The problem is described at the end. It was found by a nightly end-to-end run (a layout check or an AI review of a screenshot) and seen in two runs.

You have about 40 turns: be quick and direct. Do NOT read all of CLAUDE.md or the whole skill: read only the "Desktop UI: one design system" section of CLAUDE.md and the first 60 lines of
.claude/skills/ui-look-and-feel/SKILL.md. The view `app-chrome` is the window around every page: the sidebar (`.sidebar`, its brand and the icon rail at ≤ 1179 px) and the bottom activity bar (`#activity`); look in desktop/renderer/style.css and index.html.
Start from the page named in the finding (the page's code is desktop/renderer/pages/<view>.js, its helpers are desktop/renderer/<view>-view.js or jobs-view.js),
grep for the symptom (the text or class in the detail), and open only the files you need.

How pages are tested here: there is no browser or DOM in the unit tests. Test a fix either through an exported pure helper in desktop/renderer/*-view.js (best), or, when the
bug is in how a page wires things, with a source-level check that reads the page file (see desktop/test/jobs-place-column.test.js for the shape). Do not look for a DOM test harness: there is none.

WRITE .heal/pr-body.md AS SOON AS YOU KNOW THE ROOT CAUSE (first line the title, then root cause with file:line) and refine it at the end. If you run out of turns, the pull request still needs it.

Findings of the interaction probe (kinds `dead-control`, `silent-control`, `no-loading-state`, `expand-broken`, found by pressing the control, not from a picture): the control is named in the finding.
`dead-control`: its click handler is missing, throws early or is never attached (look for the id/class in desktop/renderer/pages/*.js and index.html). `no-loading-state`: the page waits for an `silent-control`: the press works but writes its answer into a part of the page that is hidden (a bar, a section): put the message where the person is looking (the panel of the button), never in a hidden container.
app call (`window.pilot.*`) for 0.5 s or more and shows nothing meanwhile: set a loading line or the spinner/`aria-busy` state before the call, as the neighbouring pages do ("Loading from Notion…").
`expand-broken`: `aria-expanded`/`<details>` is not toggled by the click. Test the wiring with a source-level check of the page file.

Rules (a script checks them afterwards and refuses the change if you break one):
1. Read CLAUDE.md, then .claude/skills/ui-look-and-feel/SKILL.md. Use only var(--…) tokens and the shared components; desktop/test/design.test.js fails on raw colours, sizes or fonts.
2. Find the ROOT CAUSE in the code that renders the problem; do not paper over it. Name it (file:line) in the pull request text.
3. Write a test FIRST that fails because of the problem: for the window or desktop/lib, a desktop/test/*.test.js run with `node --test desktop/test/<file>`; for the engine, a
   tests/test_*.py run with `python3 -m unittest tests.test_<name>` from the repository root. See it fail, then make the smallest fix and see it pass.
4. You may edit ONLY: desktop/renderer/, desktop/lib/, src/ (Python), and their tests (desktop/test/*.test.js, tests/test_*.py). Never main.js, workflows, tools, the extension,
   the e2e harness, packaging, or anything about secrets, licences, sign-in or tokens. If the real cause is elsewhere, or the finding is not a real problem, make NO edits and
   say so in .heal/verdict.md (first line `false-positive`, `harness` (the test was wrong, not the product) or `needs-human`, then one sentence why). The workflow runs every suite and the lint before anything is proposed.
   A finding from the AI code review gives the file, the line and a scenario: reproduce the scenario in the test, then fix it.
5. The screenshot of the page may be at .heal/screenshot.png: read it with the Read tool. The AI reviewer is often wrong; if you cannot see the problem there or in the code, it is a false positive.
6. Keep the change small (a few lines). Do not restyle neighbouring things. Do not touch more than needed.
7. When done, write .heal/pr-body.md: the FIRST line is the PR title (imperative, at most 60 characters, plain ASCII: no symbols such as ⋯; it becomes the commit subject and the push hook counts bytes), then a blank line, then exactly three labelled lines, each one or two sentences (the workflow lays them out as headings): `Root cause: <what is wrong, file:line>`, `Change: <what you changed>`, `Test: <the test file you added>`.
8. No git commands that change anything, no network, no installing packages. The workflow commits and opens the pull request.
