# Job Pilotto — notes for Claude

Personal job-search automation: crawls job boards and employer feeds, filters and scores jobs with Claude, sends a Telegram digest, tracks
applications (SQLite or Notion, behind one store interface).

This file holds the rules every session needs, one line each. Detail is in `docs/rules/` (read the one your task touches); the incident behind each
rule is in [docs/rules/why.md](docs/rules/why.md): read it before relaxing a rule.

## Start here
1. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** once per session; **[docs/HOW-IT-RUNS.md](docs/HOW-IT-RUNS.md)** only when the task touches an
   automatic loop (trigger, what it may change, where the owner approves).
2. The skill for your task (listed by Claude Code), and the `## Progress` checklist of the spec you work on (`/report-progress`).
   No Notion page is read at start (owner, 11 Oct 2026). Any Notion ID, when a task needs one: skill **notion-map**.
3. **Code: `node desktop/scripts/codemap.mjs <words>`** (every file → its purpose, live from each file's first comment), then open only that file.
4. Rules for any agent: [AGENTS.md](AGENTS.md) (git, worktrees, change tiers, which test, red main, commits). Humans too: [CONTRIBUTING.md](CONTRIBUTING.md), [RELEASE.md](RELEASE.md).
5. New file: start it with a one-line comment (docstring in Python) saying what it's for (at least 25 characters): the code map reads it.

## Safety rules (never relaxed without the owner)
- **Never Submit an application, never auto-apply.** The kit drafts, the owner submits. We never solve a captcha or bot check and never use an SMS code (a captcha is the person's to solve, see below); never past a login wall
  (LinkedIn, Glassdoor, Indeed, levels.fyi, Reddit: only through the user's own visit; 401/403/429 is a no; one slower retry of a 403 right after our own burst, owner 22 Oct 2026).
  **One opt-out exception** (owner, 19 Oct 2026, ON by default since 20 Oct 2026: "this should be opt-out, meaning on by default"): unless the user turned off Settings → "Read refused sites in my browser" (named on the privacy page), the extension reads a public
  employer careers page or job board that refused the engine, one site at a time, **without cookies or logins**, never the sites above or any login wall, up the ladder: engine, a Chrome download, then a **real tab** (owner, 20 Oct 2026: "step 2 real tab", "step 3 user solves captcha"; not faked fingerprints, solving services, proxies or a hidden browser posing as a person).
  **A passive "checking your browser" page may clear by itself in a real tab of the user's Chrome; a captcha is solved by the user, never by us.** The tab is one minimized **incognito** window (empty cookie jar; it is opened only when the window reports incognito, else nothing loads), at most 5 sites a day, up to ~15 s, no click, no typing; a captcha or refusal there is a stop that is offered to the person in the app ("needs a quick check from you") or, while applying, in the panel ("This site wants a quick check: solve it, then I'll continue").
  A site rests 7 days after any step opened it, 30 after every step stopped, 1 day on a 429; opening one of its jobs or Check for new jobs reads it now. Each site read is listed in Recent activity. Code: `src/sources/refused_reads.py`, `refused_state.py`, `extension/refused-read.js`, `refused-tab.js`.
- **Tests and automation never touch the owner's live app, accounts or real data.** List what product code reaches (ports, Keychain, tokens, real
  profile/CV, paid APIs), cut it off and assert it (the engine itself refuses the app's folder unless `JOB_PILOTTO_DATA_DIR`+`CONFIG_DIR` are set, or `JOB_PILOTTO_FOLLOW_APP=1` is the owner's own run); always through the harness (`desktop/e2e/lib/extension.mjs`, `real-extension.mjs`); real sites
  only with fake applicant data. The one exception is the twin ([docs/live-test.md](docs/live-test.md)): never the owner's window, never Submit, never a password field.
- **Secrets only in the macOS Keychain** (`job-pilotto.*`), GitHub secrets and Cloudflare Worker secrets; never in code, docs or Notion.
- **The flow core claims itself** (`FLOW_CORE` / `FLOW_FILES`, `desktop/e2e/flows.mjs`): your open PR is the claim, no message to peers; the required check "Core flow files up to date with main"
  fails when main changed a flow file your PR also changes, and `tools/ship.sh` rebases and pushes again. Read the file's "Invariants:" block first ([docs/rules/applying.md](docs/rules/applying.md)).
- **Meaning comes from AI, never from keyword lists:** emails, pages, buttons and questions come in any language. Fetch by structure, let AI decide with a fixed
  answer the code validates (`src/ai/decide.py`, `meanings.py`); a word list is at most a free shortcut in front of the AI or a safety floor.
  **Judgments about a page are the AI's** (ready? did it work? bot check? which step?); structure only finds controls, floors only AND with the AI.
- **The direction of every page fix: see fields → the AI judges each one's meaning → fill** (owner, 12 Oct 2026). A page's kind (account, form, posting) never
  decides WHETHER its fields are filled, only what is pressed; never add a code path for a page type or shape. A weak or missing AI answer is never kept as sure:
  it is asked again or climbs the ladder (digest, picture). If a fix needs "when the page looks like X, do Y", the AI's fixed answer is missing a value: add it there.
  **Where a fix lives** (owner, 12 Oct 2026, spec `docs/superpowers/specs/2026-10-12-one-next-move.md`): a wrong decision (button, route, kind, when to stop) is
  **data** (a ladder fixture + prompt example, or a learned move), never a new branch; an unread field or an unworkable control is universal code with a
  zoo/recorded page; wording is pack data; safety is code. Today's working code stays as the fast tier; a dead end gets the one escalating fallback.
- **Universal first: fix a shape, not a site.** No site names, hosts, vendor lists or growing regex; a form bug improves the self-improving mechanism (operator,
  fingerprint, alias meaning, recipe, noticing the miss) and is tested on a fixture shape. Guard: `tools/hardcoded-page-words.mjs`.
- **Ask before spending money on AI** (a new model or large re-runs); show the measured cost. **Evals never share the production AI account**
  (16 Oct 2026: an eval used up the shared Workers AI daily allowance and Free AI answered "busy" to every user; `tools/free-ai-eval.mjs` refuses it).

## Working rules
- **Every fix works for any user, through the Desktop App:** a step done by hand (terminal, Keychain, `gh secret set`, a Notion edit) is a product
  bug: build it into the app and test it.
- **Wrong data is a bug:** fix the root cause with a regression test, then repair the owner's rows by hand via the Notion MCP. No one-off repair code.
- **Data has one copy, behind the store interface** (`src/stores/`, SQLite default, Notion by choice; new data goes through every adapter). The
  employer index is product data, never in a user's store. Detail: [docs/rules/data-ownership.md](docs/rules/data-ownership.md).
- **The extension first; Claude's takeover is OFF for now** (owner, 15 Oct 2026: "we should be the interface between the user and Claude"): the panel's footer "Report" (a popup on the panel: what goes, a note, Send; owner, 19 Oct 2026) is the way out of a stuck page, never "Let Claude finish" or a countdown; the code stays behind one flag. Detail: [docs/rules/applying.md](docs/rules/applying.md).
- **The website, /admin and their scheduled jobs live in the private repo `jobadabra-web`** (owner, 19-20 Oct 2026: less open source): public `site/` is gone, never recreate it; a site change is a PR there (its own CLAUDE.md; `~/jobadabra-web/tools/site-run.sh <cmd>` runs a command in the joined tree). **Private reads public, public never reads private;** a change on both sides: the site PR lands first, then this one (owner, 21 Oct 2026: its tests check "the site has everything public lists", not an exact match); a route the app calls goes in `docs/site-routes.json` here; a test that reads a site file uses `tests/site_private.py` / `desktop/test/site-private.js`. Detail: [docs/rules/private-site.md](docs/rules/private-site.md).
- **Files: one concern each, ≤ 500 lines; split near 450** as a pure move. Detail: [docs/rules/files.md](docs/rules/files.md).
- **Tests also run on Windows CI** (main went red twice on 11 Oct 2026): temp folders via `os.tmpdir()`, never `/tmp`; compare paths after turning `\` into `/`.
  **Linux CI too** (main red again on 11 Oct 2026: `stat -f %m` succeeds on Linux with file-system text): shell uses the GNU form first (`stat -c`, `date -d`), the macOS form as fallback;
  `tests/test_shell_portability.py` fails with file:line on a bare macOS form.
- **Screens:** follow the design system (the value's kind picks its control, chips for values, AA contrast; checked by tests and the PR's "Design checks"); reuse cards, components and tokens; every new screen or action goes in the ⌘K palette; before a UI PR, open one side-by-side preview (reference | render, `npm run side-by-side`; its file name starts with the session's short name) and ship on the owner's yes. Detail: [docs/rules/desktop-ui.md](docs/rules/desktop-ui.md),
  skill **ui-look-and-feel**; `desktop/` changes: skill **desktop-change**.
- **Every lesson lands in its strongest form** (a failing test, a gate, a skill step, memory, a spec checklist; a note is the weakest).
  Before saying done: what did this teach, and where does it live? Detail: [docs/rules/knowledge.md](docs/rules/knowledge.md).
- **A red by-hand beta runs to the end; its reds are fixed in one batch** (owner, 24 Oct 2026, replacing "cancelled at the first red" the same day): a suite stops at its first red and the beta is the only run of all 66 jobs, so cancelling early showed one layer per 45-minute beta (betas 13-20). Let it finish, read every red's log, name each cause, fix them together in PRs, then dispatch the next beta; a one-off flake is re-run once, named. Cancel (`gh run cancel`) only a beta that hangs or whose build failed: it cannot show more, and beta runs share one queue (`desktop-release`), so it only delays the next. Merges to main are not held while a beta runs.
- **Local tests never wait for our own clock** (owner, 18 Oct 2026): no waiting for a schedule, a fill time, "tomorrow" or a daily limit of our own site; trigger it by hand (a "now" button, `gh workflow run`) or lift our own limit for the test. Only live third-party sites keep their limits.
- **No subagents** unless the owner asks: work inline. **One issue per session**; new splittable work goes to a hand-off.

## The change loop
1. **Worktree:** `tools/worktree.sh <topic>`. Worktrees are **kept** after landing (owner, 11 Oct 2026); `tools/worktree.sh prune` (dry run;
   `--yes` acts) removes ones fully on main and untouched for 7 days. Never remove another session's worktree.
2. **Say the tier** (AGENTS.md "Change tiers") and **the test method** (AGENTS.md "Which test for which question"); stop when the tier is met.
   - Tier 0 (copy, CSS, small fix): the touched tests, no screenshot.
   - Tier 1 (feature, screen): + one targeted `npm run shot`.
   - Tier 2 (money, store writes, apply flow, installer, engine, migrations): the fast loop too, no local e2e suite: CI runs the e2e suites and all recorded pages; `--full` only by choice.
3. **Tests first** for new behaviour and for any bug the owner saw (watch it fail). A behaviour change updates the e2e step it breaks in the same commit.
4. **Land:** `tools/ship.sh` (rebase, the fast checks, push the branch, open a PR, wait for its required checks; CI runs the suites and page cases on the PR; site replays and journeys run by hand only, owner 17 Oct 2026). **The owner reviews and merges every PR by hand** (12 Oct 2026): `ship: REVIEW #n <url>` = open with green checks, waiting for the owner; never merge it yourself. The same log then gets `ship: MERGED #n <sha>`, `ship: CLOSED #n (unmerged)`, `ship: RED #n <check>`, `ship: GREEN #n` or `ship: CONFLICT #n` (a squash-merged stacked parent is rebased away and logged `ship: CONFLICT FIXED #n`; a real conflict is yours, the hook says so) (detached watcher `tools/ship-watch.sh`, started when the PR opens, so also after FAILED): Monitor `^ship: (DONE|FAILED|REVIEW|MERGED|CLOSED|RED|GREEN|CONFLICT)`. **A red PR is fixed at once** (18 Oct 2026, #1321 sat red unnoticed): the hook `tools/pr-red-check.sh` tells you at every prompt and blocks the stop once; blocked for real: `tools/pr-red-ack.sh <n> "<why>"`. (`ship: DONE <sha>` = merged, only if auto-merge is ever turned back on.) Commit subject ≤ 72 characters, imperative, no reasons in it. **The PR title names the whole PR** (owner, 24 Oct 2026): 2+ commits → `--title="<what it does for the user>"` or ship refuses to open it.
   **PR descriptions are read in 2-5 seconds, never an essay** (owner, 12 Oct 2026): `tools/ship.sh --body=<file>` with a verdict line (emoji + what changed for the user),
   a **Why:** line (the incident, measurement or owner request that led to it), an **Unblocks:** line, the coloured impact table (7 areas rated 🟢/🟡/⚪/—; template `tools/pr-body-template.md`), 2-4 bullets, a Before/After table, and before/after images when a screen changed (`tools/pr-body.sh` refuses a body without them; "No screenshots: <why>" when nothing visible changed); `tools/pr-body.sh` adds the facts table and folds the commit message in a `<details>`.
   Never a CI e2e run by hand, except one fixed Linux suite on your PR branch (owner, 24 Oct 2026) ([docs/rules/change-loop.md](docs/rules/change-loop.md)).
5. **After landing, only what applies:**
   - The history is the commit messages (the Notion Run Log and Session Handoff were retired on 11 Oct 2026).
   - **Decision Log** (Notion): a row only for an owner decision that changes what agents may do; read it on demand, never at start.
   - **Bug Tracker** (Notion, read by the UI Finder in CI): a row only for a UI bug a person found that the Finder missed.
   - **Technical Reference** is the owner's design page, not agent input: a big feature's spec checklist may include updating it.
   - **Intelligence page** (`web/public/intelligence.html` in the private repo `jobadabra-web`, its teaser, the README "AI at every step"): only when a user-visible AI step changes.
   - The to-do list: after a finished task, not per commit.
6. **Big changes** (a feature, migration, refactor): spec with a `## Progress` checklist, safety net first, ONE full run at landing, 1-3 commits
   ([docs/rules/change-loop.md](docs/rules/change-loop.md)).
7. The weekly self-review (rule-edit PRs) was retired on 12 Oct 2026 (owner); rule edits come from sessions through the change loop.

## Where the detail is
| Topic | File |
|---|---|
| Data, stores, Notion adapter, runs, employer index | [docs/rules/data-ownership.md](docs/rules/data-ownership.md) |
| Extension, Claude takeover, assistant mode, flows, flow core, ladder, live tests | [docs/rules/applying.md](docs/rules/applying.md) |
| Screens, tokens, components, ⌘K palette, screenshots | [docs/rules/desktop-ui.md](docs/rules/desktop-ui.md) |
| File size, splitting safely | [docs/rules/files.md](docs/rules/files.md) |
| Habits, big changes, e2e steps, debugging e2e | [docs/rules/change-loop.md](docs/rules/change-loop.md) |
| Facts easy to get wrong, code layout | [docs/rules/facts-and-layout.md](docs/rules/facts-and-layout.md) |
| How knowledge is kept between sessions | [docs/rules/knowledge.md](docs/rules/knowledge.md) |
| Running a fix round (coordinator): order, target, no tooling mid-round | [docs/rules/rounds.md](docs/rules/rounds.md) |
| Maintaining the apply flow: record once, detect/fix/verify offline | [docs/rules/apply-flow-workflow.md](docs/rules/apply-flow-workflow.md) |
| The website, /admin and their CI live in a private repo | [docs/rules/private-site.md](docs/rules/private-site.md) |
| Why each rule exists | [docs/rules/why.md](docs/rules/why.md) |

## Tests
`python3 -m unittest discover -s tests`, `cd worker && npm test`, `cd desktop && npm test` (`tools/check.sh` runs them as CI does).
- **On a PR push (`SHIP_PR=1`, what ship.sh does) the hook runs only the fast pure checks** (subjects, trailers, file size, recorded cases, rung trailer; seconds); the suites, the ladder gate and page cases run in CI on the PR (`pr-gate.yml`, the `tests-*.yml` suites, `page-cases.yml`), where the same script runs with `CI_GATES=1`.
  Which workflows a PR starts is GitHub's `on: pull_request: paths:` alone (owner, 14 Oct 2026: no shared pick); only ONE check is required, the job "All checks passed" (steps: Fast checks, PR description laid out, Core flow files up to date with main, New test pages fail on the old build, Other workflows passed; it starts on every PR); main runs every suite on each push (`tests/test_workflow_paths.py`).
  Otherwise (the direct push) the pre-push hook (`.claude/settings.json` → `tools/pre-push-check.sh`) runs the suites of the areas the push touches on a clean checkout
  (`PUSH_FULL=1`: all), lints workflows, proves `npm ci` when a lock file changed, and blocks a push on a red main (AGENTS.md "Red main").
  The e2e harness's own unit tests (`desktop/e2e` npm test) run on CI only (owner, 11 Oct 2026); `JP_E2E_UNIT=1` runs them before a push.
- The Stop hook (`tools/stop-test-check.sh`) runs no suite by default since 13 Oct 2026 (owner): CI runs them on the PR before the owner merges; `STOP_CHECK_SUITES=1` runs the ones your changes touch.
- The gate reuses a suite pass on identical inputs (`tools/gate-cache.sh`; `GATE_CACHE=0` off, `PUSH_FULL=1` re-runs); a fail is never cached.
  Each step's time is logged (`<git common dir>/gate-timing.log`, `GATE_TIMING=0` off).
- Areas with no affected test are not started (`JOB_PILOTTO_TIERS=0` starts all); browser suites and replays take one machine-wide lock
  (`tools/heavy-lock.sh`, the primary checkout's copy, first come first served, a 2nd run only with spare memory, waits on a busy Mac, `JOB_PILOTTO_HEAVY=0` skips); `tools/ship.sh` lands through a PR the owner merges (main is protected; no landing
  queue: any session opens a PR at any time, CI's required checks guard main); a refused push rebases and re-checks only when what landed can clash (`tools/recheck-needed.py`; `SHIP_RECHECK=1` always), and keeps the worktree.
