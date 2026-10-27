# Jobadabra — instructions for any agent (Claude, Codex, or other)

This repo's own files are the canonical source of truth for this project. If you're an agent
reading this because a session is rooted in this folder, don't keep separate notes elsewhere that
duplicate what's here — read these instead, and update them if something's missing or wrong:

- **`docs/ARCHITECTURE.md`** — the session-start map (engine, app, extension, website, bot, Notion).
  Read it once at the start of a session, then `node desktop/scripts/codemap.mjs <words>` for the file. Written for every agent:
  Grok, Claude Code, Codex, DeepSeek.
- **The website and /admin are not in this repo** — they live in the private repo `GarryOne/jobadabra-web` (`~/jobadabra-web`). Never recreate `site/` here; a site change is a PR there; private reads public, public never reads private; the route contract is `docs/site-routes.json` here; for a change on both sides the site PR lands first, then the public one (owner, 21 Oct 2026). Read `docs/rules/private-site.md`.
- **`CLAUDE.md`** — the rules every session needs, one line each (safety, working rules, the change loop, tests), linking to
  **`docs/rules/`** for detail and `docs/rules/why.md` for the incident behind each rule. Written for Claude Code but applies to any agent.
- **`docs/spec-driven-development.md`** — Spec Kit and Superpowers entrypoints, canonical feature artifact location, and the lightweight path for small fixes.
- **notion-map** skill (private, `~/.claude/skills/notion-map` on the owner's Mac) — every Notion page/database ID this project uses, and
  which one answers which kind of question. Read this instead of searching Notion from scratch.
- **`.claude/skills/apply-to-job/SKILL.md`** — how to fill a job application form from an
  application kit (per-platform findings, the fast-path technique, the leak guard, the full
  automatic flow via `tools/apply-batch-chatgpt.sh`). Read this before filling any job form for this
  project, whether invoked by a person or by another agent.

## If you're Codex, or another agent with your own global instructions/skills/memory

Point your own global config at these files rather than keeping a second copy:
- Don't maintain a separate Notion-structure skill — use the notion-map skill.
- Don't maintain separate job-application-filling instructions — use
  `.claude/skills/apply-to-job/SKILL.md`; update its Log and Platform notes sections with what you
  learn, the same way this project already does.
- A personal-profile cache with real contact details (email, phone, address) may live in your own
  local state if that's how you work — **never write it into this repo or any file under
  `.claude/`**. The canonical profile is the Notion **Profile — CV and Preferences** and
  **Application Answers — Standard Form Fields** pages (see notion-map for their IDs); treat a
  local cache of them as exactly that, a cache, not a second source of truth.

## Golden rule for filling any form: a handful of tool calls, not dozens

A form we have already seen should never be filled one field at a time with a screenshot per
field. The flow, for every agent and every tool:

1. **Map once.** One page evaluation lists every field (id, type, label, required, filled) —
   `window.__jobPilottoAuditVisibleFields()`.
2. **Build the plan before filling.** Decide every field → value up front from the kit, the
   Profile and Application Answers (Profile's confirmed answers beat the kit's guesses). No
   deciding values mid-form.
3. **One fill call.** Inject `tools/browser-submit-guard.js` then `tools/browser-form-fastpath.js`
   (Playwright init script, or the file's text passed to the page's JS tool), then fill every
   plain field in one evaluation with `window.__jobPilottoFillKnownFields(plan)`. Fields it skips
   (Greenhouse dropdowns are react-select comboboxes): open, read live option coordinates with
   `window.__jobPilottoOptionPositions()`, click — no screenshot per field.
4. **Verify once** with the audit.
5. **Upload the résumé** (last — Greenhouse can reset other fields after an upload).
6. **Re-verify once**, then hand over. Never Submit.

**Keep evolving `tools/browser-form-fastpath.js`.** Whenever a step was done by hand that could
be deterministic, add it there (commit it, and note it in the apply-to-job skill's Log), so the
next run is faster. Its limits stay: no submit, no legal/consent fields, no checkbox clicks, and
it returns field ids and status only, never applicant values. If a session's tool-permission check
blocks an action, don't build that action into this helper to get past the check — the owner
decides that through their own permission settings.

## Hard rules (same as CLAUDE.md, repeated because this file may be read on its own)

- Never click Submit on a job application. Ever. The owner reviews and submits every application
  themselves, in every tool.
- Legal-acknowledgment checkboxes ("I agree to...", privacy notices) are always left for the owner
  to check, even when an answer is supplied for them.
- Never invent experience, numbers, employers, or credentials. Only facts from the Profile,
  Application Answers, the CV, and the posting.
- A line that encodes a decision carries `// Why (<PR or date>[, owner]): <reason>`; read it and its PR before changing that line, update or remove the
  Why in the same commit, and say `Why-changed: <which> — <reason>` (the push gate `tools/why-changed.mjs` asks). New code: a doc comment on each new
  exported function, invariants stated, debt as `TODO(AI): <what> (<date or #PR>)` / `FIXME: <what>` (`tools/new-code-comments.mjs`; docs/rules/files.md "Comments").
- Ask before spending money on AI models or large re-runs; this project already has three tiers
  running (Haiku extraction, Sonnet scoring, Sonnet kit drafting) — a fourth or a big re-run needs
  the owner's sign-off first.

## Reading websites: one universal algorithm, AI where rules would grow (owner, 8 Oct 2026)
Find jobs using your browser, the extension (`extension/visit.js`) and the engine's site readers (`src/sources/visits.py`, `careers.py`) will meet
**thousands of sites**. A fix must work on any site, not the one in front of you.
- **No code for one website.** No site names, hosts or URL paths in the logic; no branch that exists because of one site.
- **No growing lists of words or patterns** (place spellings, button labels, frame hosts, query parameters). A list that will need a new entry
  for the next site is the signal to stop.
- **Use AI where a rule would need special cases**: give Claude what the page offers (its controls, links, suggestions, outline) and let it
  choose; keep the answer per site (recipes, job pages, pool facts) so the next visit costs nothing. The page's structure (frames, roles,
  links, JSON-LD) is fine to use: it is the same on every site.
- **A reader for a job system** (Workday, SmartRecruiters, ...) is fine only because one system serves many employers, and it is found
  generically (from the page or address), never listed per employer.
- **Test the class:** a fixture that stands for a kind of page (a list in a frame, a box that suggests, cards without links), not a copy of one site.

## Data ownership: one copy, behind the store interface
The user's data lives behind one store interface (`src/stores/`, SQLite by default, Notion when the user chooses), one copy, never a sync; new
stored data goes through every adapter. The Mac keeps only keys, large files and rebuildable caches. Full rule: [docs/rules/data-ownership.md](docs/rules/data-ownership.md).

## Working with git: one worktree per task

Several agents (Claude, Codex, …) work on this repo at the same time, all pushing to `main`. To keep
them from colliding in one checkout:

- Make every code change in its own git worktree on its own branch, never directly in the main
  checkout: `tools/worktree.sh <topic>` (a worktree in `.claude/worktrees/<topic>` from `origin/main`, with the main
  checkout's `node_modules` and Python `.venv` linked in, so the tests run at once; both are git-ignored: leave the links alone).
  Another base: `tools/worktree.sh <topic> origin/<branch>` (a release lane), never a bare `git worktree add`, which links nothing.
- Commit there, then land it with **`tools/ship.sh`**. **Through a pull request since 12 Oct 2026** (while the repo allows auto-merge, `tools/pr-settings.sh`): fetch + rebase, the hook's fast checks only (seconds),
  push the branch, open a PR, wait for its required checks. CI runs the suites, all recorded pages, the pure gates and "Core flow files up to date with main" on the PR. **The owner reviews and merges every PR by hand** (12 Oct 2026, auto-merge off):
  `ship: REVIEW #n <url>` = green and open for the owner (your turn ends there; the same log then gets `ship: MERGED #n <sha>`, `ship: CLOSED #n (unmerged)` `ship: RED #n <check>`, `ship: GREEN #n` or `ship: CONFLICT #n` (then `ship: CONFLICT FIXED #n` when tools/pr-conflict-fix.sh rebased a squash-merged stacked parent away; a real two-sided conflict is yours to rebase, the hook says so) from a detached watcher, tools/ship-watch.sh, started when the PR opens, 48 h cap; a red check is yours to fix at once, and the project hook tools/pr-red-check.sh tells you at every prompt and blocks the stop until you do or say you are blocked with `tools/pr-red-ack.sh <n> "<why>"`); with auto-merge allowed again, `ship: DONE <sha>` = merged;
  `ship: FAILED required check '<name>' failed: <log url>` leaves the PR open: fix, commit, run ship again (it reuses the PR). No direct pushes to main; any other origin keeps the old direct push below.
  The old direct path: fetch + rebase, the push hook's checks (the suites of the areas you touched), push, update the main checkout. **A landing that runs the slow gates queues** (flow or extension files; owner, 11 Oct 2026: three long landings at once refused each other's pushes and re-ran 10-20 min of checks up to three times); others run side by side; when another
  session pushed in between, git refuses the push and `ship.sh` rebases and **runs the checks again** before
  the next push, so what reaches main was checked as pushed (the gate cache keeps unchanged areas instant; `SHIP_LANDING_LOCK=1` queues instead).
  `--full` runs every suite locally (a rare choice, not the Tier 2 default), `--fix` for the fix/revert of a red main. **The worktree is kept** (owner, 11 Oct 2026; `--remove` removes it).
  **Never write the extension's version:** `extension/manifest.json` holds the base (`"0.9"`); the build stamps the rest (`desktop/scripts/extension-stamp.mjs`:
  the count of commits that changed `extension/`), so extension PRs no longer conflict with each other (13 Oct 2026).
  The checks take minutes: run **`tools/ship.sh --background`** (returns at once, names its log; with 2+ commits add `--title="<what the whole PR does>"`, the PR's title names the whole PR); the log's last line is `ship: DONE <sha>`, `ship: REVIEW #n <url>` or
  `ship: FAILED …` (after REVIEW the log goes on with `ship: MERGED`, `CLOSED`, `RED`, `GREEN`; the watcher starts when the PR opens, also after FAILED): Monitor `^ship: (DONE|FAILED|REVIEW|MERGED|CLOSED|RED|GREEN|COMMENT)` in the background, never a foreground wait (8 Oct 2026: a run cut off by a timeout and piped through `tail` showed nothing). By hand it is still
  `git fetch && git rebase origin/main && git push origin <topic>:main` (fast-forward only; rejected: fetch, rebase, push again).
- **Keep worktrees after landing**; never remove another session's. `tools/worktree.sh prune` (dry run; `--yes` acts; by hand or monthly) removes
  folders whose branch is fully on origin/main and untouched for 7 days (`JP_PRUNE_DAYS`), keeping the branch, uncommitted/untracked work, and
  any worktree a running process sits in.
- Never force-push `main` — not `--force`, not `--force-with-lease`. Several agents push here in
  parallel, and a force-push deletes every commit that landed since your last fetch, silently. This
  happened on 1 Oct 2026: a `--force-with-lease` during a rebase dropped `8dce9ba` ("Windows update:
  install after the app has quit…"), which another session had pushed minutes earlier.
  `--force-with-lease` does not protect you: it only checks the remote is where *you* last saw it. If
  a push is rejected as non-fast-forward, the remote moved — fetch, rebase again, keep **both** sides'
  work in any conflict, run the tests, and push normally. Fixing an already-pushed commit means a
  second commit, not an amend. If you do clobber one, recover it from the reflog in the same turn
  (`git reflog` → the old `origin/main` tip → `git rebase <sha>` → normal push) and say what happened.
- Never use a bare `git stash`/`stash pop`: the stash stack is shared across worktrees and sessions.
- Read-only work and Notion-only updates don't need a worktree.

### Change tiers: pick one, say it in one line, stop when it is met (6 Oct 2026)
A transcription banner took 1–2 hours: harnesses, real downloads, e2e runs, CI waits, three rejected pushes. Before the gates, commits landed
every 30 seconds. Keep the guardrails that catch real breakage; stop paying the full price for every change.

| Tier | For | What you do | Target |
|---|---|---|---|
| **0** | copy, CSS, a label, a small UI or logic fix | the affected tests, `tools/ship.sh`; CI runs after | ~1 min |
| **1** (default) | a feature, a new screen or state | Tier 0 + **one** look at the new state: `npm run shot -- <page> --js "<force the state>" --select '#id'` (~5 s) | ~5 min |
| **2** | money, writes to Notion, the apply flow, the installer, the engine pipeline, data migrations | the fast loop, **no local e2e suite** (owner, 11 Oct 2026): the touched tests, `npm run row` for apply-flow work once it is on main, the affected recorded cases; CI runs the area's e2e suite (its schedule and the beta gate) and the full recorded set; a real run once on a quiet Mac only if the change spends money or writes data; `tools/ship.sh --full` is a rare explicit choice | ~1 min locally |

- **Say the tier in one line before you start** ("Tier 1: new banner"). Unsure: take the lower one and say why. Go up only when the change can lose
  data, spend money, or break the install. A state that is hard to reach (a first-run banner, an error) is forced with `--js`, not with a harness,
  a real download or a fake backend.
- **Stop when the tier is met.** No extra harness, no real end-to-end run, no new check "while we're here" at Tier 0/1.
- **CI heavy, local light** (owner, 11 Oct 2026): every local check before a push takes **under a minute** (target 30-45 s, bounded by the desktop suite).
  | Where | What runs |
  |---|---|
  | **Local push gate** | the cheap commit checks (subject, trailers, file size, stale words, new e2e steps), the **affected** unit tests of each area (desktop, Python, worker, site: those that import or name a changed file), the journey tests (no browser, ~1 s), the ladder gate (offline). **No browser, no heavy lock.** |
  | **CI, after the push** | ALL recorded pages (`.github/workflows/page-cases.yml`: Linux, 4 shards, 4 tabs each, ~80 s), the full suites (`build.yml`), the Windows checks, the e2e harness's own unit tests (`e2e.yml`). A red run on main is a red main: the hook blocks pushes until it is fixed or reverted. |
  | **On request** | `JP_GATE_REPLAY=1` replays here the recorded cases a change can affect (`desktop/e2e/recorded-case-map.json`, measured by `npm run recorded-map`; every case when a shared, flow-core or replay-tool file changed, a file is unmapped or the map is stale); `JP_E2E_UNIT=1` the e2e harness's unit tests; `JP_GATE_FULL=1` (or `PUSH_FULL=1`) the old full run, no watchdog. |
  A ~55 s watchdog (`tools/gate-watchdog.sh`, `JP_GATE_BUDGET`) stops a heavy step still running (a whole suite, not an affected-test list) and says **"DEFERRED TO CI"** with its name: never failed, never dropped.
  A push over 60 s is marked SLOW in the summary and in `gate-timing.log`. A change that CI would catch but the local pick cannot name is a gap in `tools/affected-tests.py`: fix the pick, with a test.
- **One change, one push.** A follow-up you think of (prefetch, a Finder check, a new tool) is offered in one line and built only when the owner says yes.
- **Land with `tools/ship.sh`**, not by hand. The pre-push hook runs only the suites of the areas the push touches (docs: none; engine: python +
  desktop; an unknown path: everything; `PUSH_FULL=1` forces all). Do not wait for CI of your own push before the next task: look at it later.
  A red main whose jobs were only cancelled or never started (busy runners) is infrastructure: the hook re-runs it and does not block.
- **What the hook starts is decided by the affected-tests pick** (`tools/affected-tests.py`, 11 Oct 2026): an area with no affected test is not started
  (a docs, skill or tools-only push: lint + the touched unit tests, under ~1 min; a changed JS file keeps desktop's lint). `extension/` and flow-core
  pushes keep the journey, ladder and recorded gates, which run on their own file lists. `JOB_PILOTTO_TIERS=0` starts every area the paths want.
- **Heavy runs queue in one lock per Mac** (`tools/heavy-lock.sh`, every worktree runs the primary checkout's copy): e2e suites, `run-all`, `smoke`, `npm run real-extension`
  and `recorded` take it in arrival order (a run that re-asks never jumps a waiter), say who holds it, start a 2nd beside the first only while free+inactive
  memory is over 7 GB and swap is low (never a 3rd), and wait while the 1-minute load is above 1.5 x the cores. No slot messaging between sessions. Unit tests never wait. `JOB_PILOTTO_HEAVY=0` skips it.
- The e2e suites run nightly and on demand, not per change; the Finder files what they find. Do not run one to "be sure" at Tier 0/1.

### Which test for which question (owner, 8 Oct 2026: "the right test method for the right case")
The tier says how much to check; this says **how**. Pick the cheapest method that can actually show the thing, and say it with the tier
("Tier 1, shot + unit"). A method that cannot show the bug is waste however thorough it is; the twin on a label change is waste too.

| The question | Method | Cost |
|---|---|---|
| Does this logic/parser/decision give the right answer? | unit test (`desktop/test`, `tests/`), a failing one first | seconds |
| Does this screen/state look right? | `npm run shot -- <page> --js "<force it>"` | ~5 s |
| Does the **job drawer** (any tab, any state: none, loading, failed, filtered) look right? | `cd desktop && npm run drawer-shots` (25 states on the demo's fictional jobs, cropped to the drawer, six to a contact sheet; `-- --only 20,21` for some); add a state in `scripts/drawer-shots.mjs`, seed it in `demo/job-pages.json` | ~1 min |
| Does a page script handle this control's **shape**? | fixture shape test (`e2e/test/upload-slot.test.mjs` style) | seconds |
| **Does my fix change what this pool row does?** (a failing row, a fix) | `cd desktop/e2e && npm run row -- "<pool row>"` (offline: the row's own pages and AI answers, the app's own server, the real extension; same evidence lines as live; `--old <extension/>` for the build before) | 15-90 s |
| Does a fix hold on the real site? (once, after `npm run row`) | `npm run live -- <posting url>` (held, no Electron, the tripwire) or `npm run record-sites -- --only <shape>` | ~1 min |
| Does the real extension work on a real site, without the app's flow? | `cd desktop/e2e && npm run real-extension` (isolated Chromium, stand-in app); a case is added there | ~1 min |
| Does a change to the flows' **decision core** break another flow? | `npm run flows` (the matrix, on demand; on CI its steps run with every e2e, no push gate since 9 Oct 2026) | ~5 min |
| Does a new producer feed an existing screen with all its features? | parity test (one test, every producer) | seconds |
| Does the whole journey still work on fixtures? | CI's e2e suites; locally the area's e2e step (`E2E_STEPS=…`) only when the change breaks it, never as a Tier 2 routine | minutes |
| **Does it work on the owner's real state and real sites?** | **the twin** (`npm run twin`, [docs/live-test.md](docs/live-test.md)) | minutes, real AI |

**The twin is for what fixtures cannot show**, typically when:
- the bug was seen on a real site or real data and does not reproduce on fixtures (a translated page, an ATS widget, an account step, a redirect chain);
- the result depends on the owner's real state: sessions, kits, profile, learned knowledge, a long-lived tab;
- a fix touches the apply flow end to end, and the owner wants to watch it work, or a fixture pass still leaves the question open.

**Not the twin**: copy, CSS, a label, pure logic a unit test proves, anything a `shot` shows, a page-script shape a fixture shows.
**Extension only** (no app flow needed): `cd desktop/e2e && npm run real-extension`, or a fresh browser window with an extension copy (`e2e/lib/extension.mjs`).
Never make the owner's own Chrome fill: its extension is paired with the live app (read-only DOM checks there are fine, never a password field).

**Every live finding ends in a fixture or unit test** that fails without the fix: the twin finds bugs, the suites keep them fixed.

### A feature commit updates its own e2e step (6 Oct 2026)
**A feature or behaviour change updates the e2e step it breaks, in the same commit** (6 Oct 2026: about 25 commits in eight hours renamed a task, changed
digest headings and the job-board rule without touching their suites, and the manual `personas` suite sat red unnoticed). Before you push: `grep` the visible
words, selectors and commands you changed in `desktop/e2e/` (`suites/`, `lib/`) and the unit tests; fix what you find, or say in the commit body which step
is now stale and why. A new detector or plant needs its unit test page to carry what it checks (`test/recall.test.mjs`).

### Re-checking a failing e2e step: the step, not the suite (6 Oct 2026)
A full suite is 3-17 minutes; the step that failed is usually under one. Two sessions on 6 Oct 2026 re-ran whole suites to read a failure message that was already on disk.

- **Read the failure first:** `desktop/e2e/artifacts/<suite>/suite-failures.json` (step + message) and `artifacts/<suite>.run.log`. A worktree's `artifacts/` goes with it when it is pruned.
- **Re-run only the step:** `E2E_STEPS="<words from the step name>,<its prerequisite steps>" node run-all.mjs --only <suite>` (setup steps marked critical always run; `run-all` reads the Notion tokens, `suite.mjs` alone does not). A step often builds on the one before it, so name both.
- **Full suite or full `run-all` only as the last check** before a push that touches that area, never to look at a failure.

### Red main: the first session to see it unblocks everyone (5 Oct 2026)
A red `build` on `main` blocks every session's push (the pre-push hook). Waiting for its author left four sessions stuck
until the owner stepped in. So whoever meets it fixes it, in the same turn, before their own push:
1. `gh run view --log-failed <run>`: what broke.
2. **Small and obvious** (a missing file, an import, a test expectation): fix it forward in its own commit,
   `CI_RED_OK=1 git push origin <topic>:main`.
3. **Otherwise** `git revert --no-edit <bad sha>` (`tools/revert-red.sh <sha>` does it and lands it with `ship.sh --fix`, now through a PR too) (a new commit, never a force-push), push it with `CI_RED_OK=1`, and tell
   the user which commit was reverted; its author lands it again, fixed.
4. Then push your own work normally. Never add your commits on top of a red build, and never push with `CI_RED_OK=1` for
   anything but the fix or the revert.

A landing through a pull request (`tools/ship.sh` in PR mode, `SHIP_PR=1`) does not wait on a red main (12 Oct 2026): the PR's own required checks
guard main, and a flake already re-run green stopped three landings that day. ship.sh says "main is red at X: not waiting" and goes on; fixing a
real red main is still the first session's job.

The hook runs the suites on a **clean checkout of what is pushed**, one area at a time, as CI does, so leftovers in your
folder can't hide a break: `fa1f838` passed locally on a `desktop/shared/` left by a desktop run, and the worker's CI job,
which never stages it, went red. A fix still building does **not** let anyone through (11 Oct 2026: four landings went in
on top of a fix attempt that ended red): main is green again when a later commit's run has completed green
(`tools/red-main.sh`). While it is red every landing but the fix waits (`tools/ship.sh` says so); after **5 minutes** red
with nobody claiming the fix (`tools/red-main.sh claim <sha> --session <name>` extends it to 15, once) the next landing
says loudly to run `tools/revert-red.sh <sha>`, which reverts the commit and ships it with `--fix`. Every red period is
logged to `gate-timing.log` (`red-main ended ... minutes=N waited=K`). `SHIP_IGNORE_RED=1` only with the owner's OK.
The fix goes first: `tools/ship.sh --fix` skips the landing queue, never waits for a check slot, and its heavy-lock runs are class `fix`
(`JOB_PILOTTO_HEAVY_CLASS=fix` for a proof replay started by hand). A red run is re-run once; the 5 minutes count from its first completion.

### Commit messages
- **Every fix leaves a permanent check** (3 Oct 2026). A commit that says `Fixes #N` also adds the test that would have caught the bug: a unit test, an e2e unit test,
  or a step in an e2e suite (for a bug that only shows in a state, like the AI failing, the step puts the app in that state). Scripted checks found 17 of the first 36
  tracked bugs, nearly all the severe ones; a fix without one can come back unnoticed. The pre-push hook refuses a `Fixes #N` commit with no test unless its message
  has a `No-test: <why>` line.
- **Commit subject: one line, at most 72 characters** (GitHub cuts the list at about that, 2 Oct 2026: subjects of 150+ characters
  with version numbers and reasons made the history unreadable). Imperative, what changed: `Extension: drop "Use on this tab"`.
  No version number, no reasons, no "because…" in the subject; those go in the body (blank line, then wrapped text).
  The hook stops a longer subject at `git commit` already. One that got through blocks the push: `git commit --amend` your own
  unpushed commit, or, if the amend is denied, `COMMIT_LONG_OK=1 git push ...` (never rewrite a pushed one). Attribution lines stay at the end of the body.

## If you're not Claude Code (Codex, Grok, the DeepSeek Harness, anything else)

Everything above applies. Only the *automatic* checks are Claude Code's: `.claude/settings.json` hooks
(`tools/pre-push-check.sh` before a Bash call, `tools/stop-test-check.sh` at the end of a turn) — they are not git
hooks, so no other agent gets them (`.git/hooks/` holds only samples; the one git hook is `tools/githooks/commit-msg`, `core.hooksPath` set by `tools/worktree.sh` and `tools/ship.sh`: it checks the trailer values of a commit message, `COMMIT_TRAILERS_OK=1` skips). **Run them yourself,
then say what passed** (learned 30 Sep 2026, each of these cost real time). **In a session, only the files you changed** (owner, 26 Oct 2026: "It should run only on CI" / "and locally, only very isolated"; the hook `~/.claude/hooks/foreground-long-run.py` refuses the whole suites below); CI runs them on the PR:

```sh
python3 -m unittest tests.test_<the module you changed>       # CI: JOB_PILOTTO_DISABLE=mail,notion,telegram,google_jobs python3 -m unittest discover -s tests
cd desktop && node --test test/<the file you changed>.test.js  # CI: cd desktop && npm test; cd worker && npm test
```

- **`desktop/npm test` needs its `pretest`** (`scripts/stage.mjs`): in a fresh worktree, without staging, seven files
  fail on a missing `desktop/shared/` and look like real regressions. The reverse trap: a `desktop/shared/` left behind
  makes another area pass here and fail in CI. Run the suites in a fresh worktree of your commit (the hook does).
- **A read-only `<repo>/data`** makes the Python suite error on `data/insights.lock` (14 tests): pass
  `JOB_PILOTTO_DATA_DIR=<a writable folder>`. The DSH sandbox starts that way for this repo, since the session
  workspace is elsewhere; the first write needs the user to widen the policy, after which the rules above apply as they
  are.
- **Adding a file?** Start it with a one-line comment saying what it does (the live code map reads it; `desktop/test/codemap.test.js` checks it says enough).
- **The smoke hooks** (`desktop/main.js`): `JOB_PILOTTO_SMOKE_JS` must be an IIFE — top-level `await` hangs the window —
  `JOB_PILOTTO_SMOKE_EVAL`'s result is written to `<JOB_PILOTTO_SMOKE>.json`, and `..._SELECTOR` crops the picture.
- **Notion, if your harness has no tool for it**: the change loop (CLAUDE.md, step 5 "After landing, only what applies")
  expects a Decision Log row for an owner decision that changes what agents may do, and a Bug Tracker row for a UI bug the
  Finder missed (the Run Log and Session Handoff are retired; history is in commit messages). Say plainly that it wasn't done rather than implying it was; the HTTP API is reachable with
  the Keychain token (`job-pilotto.notion.token`) and `gh` is authenticated, so reads and repairs are possible when
  asked.

### If your host is an Electron app (the DeepSeek Harness, Claude Code inside VS Code or Cursor, any other Electron host)

`ELECTRON_RUN_AS_NODE=1` is inherited from the host process — it is in no shell profile — and it makes Electron load
`main.js` as plain Node, so any render, `npm run shot` or `npm run ui-shots` dies with *"does not provide an export named
'BrowserWindow'"*. Check with `env | grep ELECTRON_RUN_AS_NODE` and prefix the command:

```sh
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
```

### When "no open Chrome tab matches this job" is a lie (macOS, 1 Oct 2026)

macOS keeps **one** Apple Event connection per application, and it goes to whichever "Google Chrome" registered
first. An automation that leaves a windowless Chrome behind (`--no-startup-window`/`--headless`, launched from
`~/.claude/jobs/<id>/tmp/` or a temp dir) therefore **owns** Chrome's scripting: `windows()` answers `[]`, so the
app's focus/reload/close see no tabs at all and the session page says the form's tab is missing while the user is
looking straight at it. It cost hours to find once.

```sh
lsappinfo list | grep -A1 '"Google Chrome" ASN'      # two entries: BackgroundOnly (the stray) and Foreground (yours)
ps -Ao pid,ppid,lstart,command | grep 'MacOS/Google Chrome '   # the stray has ppid 1 (its launcher is gone)
```

The app now detects this (`desktop/lib/background-chrome.js`) and offers to quit the orphan from the extension card,
and the extension's own tab report is used for "which forms are open" so scripting is no longer the only source. When
you launch Chrome yourself in a script, kill it on exit (`trap 'kill $!' EXIT`), or it will hijack the next run.

## Desktop UI
Before building or changing a screen in `desktop/renderer`, read `.claude/skills/ui-look-and-feel/SKILL.md` (patterns, reference
screenshots in `desktop/docs/ui/`, and how to render the change in demo mode to check it).
A new task kind or result must reuse an existing card/component and be registered in `CARD_KINDS` (see `docs/rules/desktop-ui.md`); never show raw message text.

## Logging: when a debug session makes you wish for a line, add it then and there (1 Oct 2026)
Debugging that had to lean on file mtimes, Notion timestamps and GitHub runs — because nothing was written
down — is the signal to add logging, not to move on. Add it in the same turn, permanently.

- **Log decisions, not just errors.** Every irreversible or money-spending action (a Notion stage write, a cloud
  dispatch, an "Applied", a form fill, a run's start and end) gets one line: what happened, what asked for it, and
  the evidence it rested on. "Who decided this, and why?" must be answerable from the logs alone.
- **Log the evidence's identity, never its content.** Field names, counts, source, a short digest of the inputs,
  ids. Never the user's words, form answers, message bodies or tokens (`lib/log.js` says exactly this at the top).
- **The right file.** `logs/app.log` — the app's own doings, `log(area, message, fields)` from `lib/log.js`;
  `logs/engine.log` — what the Python engine printed for a run; `logs/notion-requests.log` — API traffic.
- **Read the logs first.** When something is wrong, `grep <area> logs/app.log` before archaeology. If the answer
  wasn't there, adding that line is part of fixing the bug.
- **Areas are stable and searchable** (`dispatch`, `sessions`, `run`, `extension`, `prep`, `review`, `update`,
  `window`): a new one is fine, a renamed one is a small tax on every future grep.

## JavaScript lint checks
Desktop `npm test` runs ESLint first across `desktop/` and `extension/` (including tests and scripts). `no-undef` blocks failures; `no-unused-vars` is advisory. Use `cd desktop && npm run lint` for fast feedback. Fix the cause of lint errors; do not silence them by inventing globals. Browser, Node, preload and Chrome-extension globals are configured in `eslint.config.mjs`; generated build and shared files are excluded.

## Shared verification and checked desktop boundaries
`tools/check.sh` is what CI and the push hook run (`--fast`, `--area desktop|python|worker|site`, `--clean-install`); in a session run the one test file you changed instead (owner, 26 Oct 2026: suites run on CI only). The command selects Python 3.12+ and supported Node, stages desktop shared files, and reports setup problems without installing packages. CI and Claude hooks delegate to this same runner; it works from any directory and any agent.

Electron lifecycle callbacks are in `desktop/lib/lifecycle.js` with injected services; import them directly in tests. `main.js` supplies startup initialization and current app services. Session IPC channels must register through `sessionIpc` in `desktop/lib/session-contracts.js`; every exposed session channel has argument and response checks. Public terminal session views use that same contract. Add a channel's contract and tests before exposing it. Contracts cover the session bridge, not every IPC action yet. Contract failures log channel/direction/field names only, never argument values or session content.

## Offline app scenario tests
`tools/check.sh --fast` and the full desktop suite run `desktop/test/app-scenarios.test.js`.
Use `cd desktop && npm run test:scenarios` to reproduce just these journeys (stages shared files first).
When changing startup/reconciliation, session questions, resume, cancel, review handoff or quit, extend a
journey with the user's actions and observable consequences, including after restart and on service failure.
The suite runs the real preload, `lib/session-handlers.js` registrations, launcher, terminal persistence,
lifecycle callbacks and renderer state/cache helpers. Inject fake terminals, browser/dialog replies and Notion
responses; use fictional data in temporary folders, never real keys, applications, AI calls or browser tabs.
`main.js` supplies the live services to `registerSessionHandlers`; keep behavior there rather than duplicating
handlers in a test. These are offline integration tests, not a graphical Electron/Chrome end-to-end test.
Render changed screens with the normal demo smoke tools; live service compatibility needs separate checks.
