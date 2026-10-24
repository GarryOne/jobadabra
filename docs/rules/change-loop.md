# The change loop: habits, big changes, e2e steps, debugging

Linked from CLAUDE.md. The tiers and "which test for which question" are in [AGENTS.md](../../AGENTS.md#change-tiers-pick-one-say-it-in-one-line-stop-when-it-is-met-6-oct-2026).
Why each rule exists: [why.md](why.md#change-loop).

## The habits that prevented rework
1. A bug the owner saw: find the root cause and write a failing test before any fix.
2. Tests first for new behaviour; watch the test fail for the right reason.
3. UI from an owner mockup or request: confirm layout + behaviour in one message before code.
4. "Done" = tests pass as CI runs them (`JOB_PILOTTO_DISABLE=mail,notion,telegram,google_jobs python3 -m unittest discover -s tests`, desktop
   `npm ci` with dev deps); say what you verified and what you didn't.
5. **A feature or behaviour change updates the e2e step it breaks, in the same commit.** Before you push: `grep` the visible words, selectors and
   commands you changed in `desktop/e2e/` (`suites/`, `lib/`) and the unit tests; fix what you find, or say in the commit body which step is now
   stale. A new detector or plant needs its unit test page to carry what it checks (`test/recall.test.mjs`).
6. **A new e2e step is seen passing before it lands, and proves its own setup.** The push hook (`tools/new-e2e-steps.mjs`) wants a local run that
   passed it, or `E2E-unverified: <why>`. In the step, assert the setup took effect (the stub was called, the seed is in the state).
7. **Never start a CI e2e run by hand, and no whole e2e suite on the Mac** (owner, 9 Oct 2026: CI spends the test keys only on PRs; 11 Oct 2026: CI heavy,
   local light): CI runs the e2e suites on your PR. No `gh workflow run e2e.yml`, no `e2e-try/*` tag, unless the owner asks. Locally only the step you are
   debugging or adding: `cd desktop/e2e && E2E_STEPS=... node run-all.mjs --only <suite>`; `E2E_AI_FAMILY=openai` runs the OpenAI side on Codex.
   `run-all.mjs` refuses a whole suite on the Mac (`lib/local-run.mjs`; the owner's full run by choice: `JP_E2E_FULL=1`; `npm run live` passes).

## A big change: slices, a safety net first, ONE full run at landing (owner, 10 Oct 2026)
1. **Size it first** (Tier 0/1/2). Above Tier 1: a spec with a checklist (`docs/superpowers/specs/`, a `## Progress` section; skill
   `report-progress`), and say what stays unverified. A box a PR ticks names its proof: `(proof: <path>)` the PR changes, `(proof: <path> @<sha>)`
   on main, or `(proof: none: <why>)` (`tools/spec-proof.mjs`, in the pure push checks and CI's Fast checks).
2. **Safety net before behaviour:** fixtures, a baseline and a gate (`ladder-score`, `tools/ladder-gate.mjs`, recorded pages, contract and
   architecture tests) exist BEFORE the change.
3. **Three speeds:** each edit runs only the touched test (seconds); each finished slice runs the gate and the replays it touches (1-2 min); the
   FULL suites, all replays, real-extension and the old-build controls run ONCE per landing, in the background (`run_in_background` + Monitor).
   The codemap is written once, at landing. The extension's version is never written: the build stamps it (`desktop/scripts/extension-stamp.mjs`).
4. **Commits:** small local commits are free; what lands is 1-3 squashed commits by concern.
5. **Parallel sessions by file ownership, not by task:** one session owns the flow core; others get new files, tests, the site, measurement
   (brief + own worktree + commit only + report; the coordinator lands). Fix the landing order and any freeze window up front; message every peer (the flow core needs no claim message: an open PR is the claim).
6. **A migration or move is its own pure commit** ([files.md](files.md#splitting-a-file-safely)).
7. **Measure per source** (real / reconstructed / invented), never blended, never tune on invented data.

## A by-hand beta with reds
Let it run to the end, read every red job's log, name each cause (skill **fix-failing-e2e**), fix them together, then dispatch the next beta. Cancel only a beta that hangs or whose build failed.
A flake is re-run once, named. Why: [why.md](why.md#a-red-beta-runs-to-the-end-24-oct-2026).

## Debugging a failing e2e step
The whole loop, with the cause list and the CI by-hand proof (not a beta): skill **fix-failing-e2e**.
- **Read before you re-run.** `desktop/e2e/artifacts/<suite>/suite-failures.json`, `artifacts/<suite>.run.log`, the screenshot, `logs/app.log`.
  A worktree's `artifacts/` goes with it: copy what you still need first. A failure that says only `""` or "not found" is missing evidence: add the
  capture or log line that would have answered it.
- **Reproduce small, in seconds, then confirm once.** Seed the state: `npm run shot -- <page> --js "<click>" --eval "<state>"` on `desktop/demo/`
  fixtures (Notion pages in demo mode come from `demo/run-pages.json`), or a unit test. Then the step once:
  `E2E_STEPS="<step>,<prerequisites>" node run-all.mjs --only <suite>` (setup steps marked critical always run). Full suite only as the last check.
- **Prove the repro** before saying "reproduced" or "never called": its own setup took effect. `window.pilot` is a read-only contextBridge:
  assigning to it does nothing. A step run alone lacks what skipped steps built: list what you removed.
- **Other sessions share the suite's Notion token.** Check `logs/notion-requests.log` for 429s and runs you did not start; the app's Notion calls
  queue (~340 ms apart, 25 s+ after a start).
- **Nothing is swallowed silently.** A `.catch(() => …)` logs what it caught. A failing step saves the app's state before it closes anything.

## A red PR is never left alone (18 Oct 2026)
- #1321 sat red on two desktop jobs for hours: ship's run ended before `ship: REVIEW` with nothing after the checks, so no watcher ran and no session looked.
- `tools/ship-watch.sh` now starts when the PR **opens** (not after REVIEW) and writes `ship: RED #n <check>` / `ship: GREEN #n` / `ship: CONFLICT #n` / `MERGED` / `CLOSED` to the ship log whatever way the run ends; Monitor `^ship: (DONE|FAILED|REVIEW|MERGED|CLOSED|RED|GREEN|CONFLICT)`.
- **A conflicting PR** (18 Oct 2026: #1356, #1362, #1350 conflicted after their stacked parent or a sibling landed, unnoticed): the watcher reads GitHub's `mergeable` (UNKNOWN is never reported) and logs `ship: CONFLICT #n` once per conflict; at once `tools/pr-conflict-fix.sh` handles the one machine-fixable case, a stacked PR whose parent was squash-merged (`git rebase --onto origin/main <parent's old tip>`, fast checks, lease push, `ship: CONFLICT FIXED #n (stacked parent #m)`), only in a clean worktree with nothing unpushed and no ship running, else the branch is untouched. A real two-sided conflict is yours: rebase keeping both sides' work, push through ship.sh. The hook says "PR #n conflicts with main: rebase now", blocks one stop, and `pr-red-ack.sh` holds for it too. Guard: tests/test_pr_conflict_fix.py.
- **PR title** (18 Oct 2026: #1375 was titled by its first commit, a split; 24 Oct 2026: #1743 by its 6th, a spec tick): the title names the whole PR, not one commit. One commit: its subject. 2+ commits that are not "Move " splits: `tools/ship.sh --title="<what the whole PR does for the user>"` is required to open the PR (ship refuses without it); the `[session]` prefix is added. On a PR already open, `--title` retitles it and without it a reship leaves the title alone. Guard: tests/test_ship_pr.py.
- The project hook `tools/pr-red-check.sh` (UserPromptSubmit + Stop) adds "PR #n is red: <checks> <job url>; fix it now" to the context and blocks the stop once. Fix the cause and push through ship.sh;
  blocked for real: `tools/pr-red-ack.sh <n> "<why>"` (holds for exactly those red checks). Guard: tests/test_pr_red_hook.py, tests/test_ship_watch.py.
