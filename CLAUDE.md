# Jobadabra — notes for Claude

Personal job-search automation: crawls boards and employer feeds, filters and scores with Claude, Telegram digest, tracks applications (SQLite or Notion, one store interface).
Short on purpose (27 Oct 2026 diet): detail is in `docs/rules/`; the incident and owner quote behind each rule is in [docs/rules/why.md](docs/rules/why.md): read it before relaxing a rule.
The full pre-diet text: `git show c7bed98:CLAUDE.md`.

## Start here
1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) once per session; [docs/HOW-IT-RUNS.md](docs/HOW-IT-RUNS.md) only for an automatic loop. The skill for your task, and the spec's `## Progress` checklist. No Notion page is read at start (skill **notion-map** for IDs).
2. Code: `node desktop/scripts/codemap.mjs <words>` (every file → purpose), then open only that file. A new file starts with a one-line purpose comment (≥ 25 characters).
3. Agent rules: [AGENTS.md](AGENTS.md) (git, worktrees, tiers, which test, red main, commits); humans: [CONTRIBUTING.md](CONTRIBUTING.md), [RELEASE.md](RELEASE.md).

## Safety (never relaxed without the owner)
- **Submit:** the app submits only in Full automation, which the person turns on (Settings → Apply; checks: no required field empty, answers from saved facts, fit 80+, ≤ 20 a day, 1 per employer, 10-minute wait with Stop; each theirs to change). The person's own Submit press for one job, after seeing its answers, is the person submitting, and stays off while a required field is empty. Not built yet: until it ships, nothing submits. Tests, the pool, the twin, Ready's night and our sessions never submit.
- **Never** disguise a browser as a person; solve a captcha or bot check; use an SMS code; go past a login wall (LinkedIn, Glassdoor, Indeed, levels.fyi, Reddit: only through the user's own visit); retry a 401/403/429 (one slower retry of a 403 right after our own burst).
- **Refused public sites (the one exception):** the extension may read a public employer page that refused the engine, one site at a time, no cookies or logins, never the sites above: engine, a Chrome download, then a real tab (one minimized **incognito** window, only if it reports incognito; ≤ 5 sites a day, ~15 s, no click or typing). **It starts only when the person presses "Find jobs using your browser"**, never in the background. A passive "checking your browser" page may clear itself; a captcha is the user's to solve (offered as "needs a quick check from you"). Skip 7 days after a step opened it, 30 after all stopped, 1 day on a 429; each read is listed in Recent activity. Code: `src/sources/refused_reads.py`, `extension/refused-read.js`; the one gate `desktop/lib/refused-now.js`; guard `desktop/test/refused-reads-button.test.js`.
- **robots.txt and site terms are not consulted** for public job listings (owner, 6 + 26 Oct 2026); `Sitemap:` lines still help. Guard `tests/test_robots_not_consulted.py`. Login walls, captchas, 401/403/429 and host_pace are unchanged.
- **Tests and automation never touch the owner's live app, accounts or data.** List what product code reaches (ports, Keychain, tokens, real profile/CV, paid APIs), cut it off and assert it; always through the harness (`desktop/e2e/lib/extension.mjs`, `real-extension.mjs`); the engine refuses the app's folder unless `JOB_PILOTTO_DATA_DIR`+`CONFIG_DIR` are set. Real sites only with fake applicant data. Only exception: the twin ([docs/live-test.md](docs/live-test.md)): never the owner's window, never Submit, never a password field.
- **Secrets only** in the macOS Keychain (`job-pilotto.*`), GitHub and Cloudflare Worker secrets; never in code, docs or Notion.
- **Flow core:** your open PR is the claim (`FLOW_CORE`/`FLOW_FILES`, `desktop/e2e/flows.mjs`); read the file's "Invariants:" block first ([docs/rules/applying.md](docs/rules/applying.md)); `tools/ship.sh` rebases when "Core flow files up to date with main" fails.
- **The AI decides; code fetches, validates and keeps safe.** Every judgment (what a text/title/page means, which step next, whether a result is right) is an AI call with a fixed answer the code validates (`src/ai/decide.py`, `meanings.py`); never a hand-written rule tree, threshold chain or keyword list in its place. Any language. A word list is only the offline floor (`ai_first`); a busy AI leaves the item unknown, never a keyword's guess. Public-data judgments come from installs' AI and the central scout, shared through the pack (k≥3). Not judged = not read on a guess.
- **Page fixes: see fields → the AI judges each meaning → fill.** A page's kind never decides WHETHER fields are filled. A weak AI answer is asked again or climbs the ladder. **Where a fix lives:** a wrong decision is **data** (ladder fixture + prompt example, learned move), not a branch; an unread field is universal code with a zoo/recorded page; wording is pack data; safety is code.
- **Judgments about a page are the AI's** (ready? did it work? bot check? which step?); structure only finds controls, floors only AND with the AI.
- **Universal first:** fix a shape, not a site. No site names, hosts, vendor lists or growing regex (guard `tools/hardcoded-page-words.mjs`); tested on a fixture shape.
- **Ask before spending money on AI** (new model, large re-runs); show the measured cost. Evals never use the production AI account (`tools/free-ai-eval.mjs` refuses; random draws and CI have their own tokens).

## Working rules
- **Every fix works for any user through the Desktop App**; a manual step (terminal, Keychain, `gh secret set`) is a product bug. Large optional parts (LibreOffice, transcription, Chromium) download on first use with progress and Cancel, never in the installer (guard `desktop/test/no-bundled-browser.test.js`).
- **Sites a run reads or offers fit the current search** (AI-judged for current roles and places; a strategy change re-judges; `tests/test_sources_follow_strategy.py`). **Find jobs takes ≤ 3 min wall clock**, every stage on one deadline from the press (`tests/test_three_minutes.py`).
- **Every mention of AI credit says what it buys** ("about N applications or N searches") from one shared measured function; a test loops over every surface.
- **Wrong data is a bug:** fix the root cause with a regression test, then repair the owner's rows via the Notion MCP. No one-off repair code. **Data has one copy behind the store interface** (`src/stores/`; employer index is product data): [docs/rules/data-ownership.md](docs/rules/data-ownership.md).
- **Extension first; Claude's takeover is OFF** (one flag); the panel's "Report" is the way out of a stuck page: [docs/rules/applying.md](docs/rules/applying.md).
- **Website, /admin and their jobs live in the private `jobadabra-web`**; never recreate `site/`. Private reads public, never the reverse; a change on both sides: site PR first. App routes go in `docs/site-routes.json`: [docs/rules/private-site.md](docs/rules/private-site.md).
- **Files ≤ 500 lines, split near 450** as a pure move: [docs/rules/files.md](docs/rules/files.md). **Why comments, doc comments, `TODO(AI)`**: `Why-changed: <which> — <reason>` (`tools/why-changed.mjs`, `tools/new-code-comments.mjs`); a prompt change adds its case or `Prompt-case: none <why>` (`tools/prompt-cases.mjs`): [docs/rules/files.md](docs/rules/files.md#comments).
- **Tests also run on Windows and Linux CI:** temp dirs via `os.tmpdir()`; compare paths after `\`→`/`; shell GNU form first (`stat -c`, `date -d`) (`tests/test_shell_portability.py`).
- **Screens:** follow the design system and reuse cards/tokens; every new screen or action is in the ⌘K palette; before a UI PR one side-by-side preview (`npm run side-by-side`; its file name starts with the session's short name), ship on the owner's yes: [docs/rules/desktop-ui.md](docs/rules/desktop-ui.md), skills **ui-look-and-feel**, **desktop-change**.
- **Suites run on CI only** (the "Tests:" rule): locally the one file you changed (`node --test test/x.test.mjs`, `python3 -m unittest tests.test_x`) or one step (`E2E_STEPS="<step>" node suite.mjs <suite>`); never `unittest discover`, `npm test`, `tools/check.sh`, `run-all.mjs`, a whole suite or a grep-built list (hook `foreground-long-run.py`; escape `E2E_LOCAL_OK=1`). Local tests never wait for our own clock. A red by-hand beta runs to the end and its reds are fixed in one batch; no beta starts while main's e2e is red (`tools/beta-release.sh`, `--force "<why>"`).
- **CI freeze: until 3 Nov 2026 only session 32 changes `.github/workflows`, `desktop/e2e` harness lib and `tools/ship*`; everyone else fixes the product (owner, 27 Oct 2026).** One exception (owner, 28 Oct 2026): any session may update a workflow's `paths:` list with exactly what `node tools/replay-files.mjs --paths <workflow>` prints, the push gate's own fix.
- **Subagents: none unless the owner asks, except** one `/code-review` in a fresh subagent on a PR that fixes a bug the owner saw, asked: does the test play the owner's scenario; which existing test asserts the opposite? (owner, 27 Oct 2026). **One issue per session**; new splittable work goes to a hand-off.
- **Every lesson lands in its strongest form** (failing test, gate, skill step, memory): [docs/rules/knowledge.md](docs/rules/knowledge.md).

## The change loop
1. `tools/worktree.sh <topic>` (kept after landing; `prune` removes ones on main 7 days; never another session's).
2. Say the tier and the test method (AGENTS.md): Tier 0 touched tests; Tier 1 + one `npm run shot`; Tier 2 (money, store writes, apply flow, installer, engine, migrations) the fast loop, CI runs e2e.
3. Tests first for new behaviour and any bug the owner saw (watch it fail); a behaviour change updates its e2e step in the same commit.
4. Land: `tools/ship.sh --background --body=<file>` (also the private repos). The owner merges every PR by hand; never merge it yourself. Monitor `^ship: (DONE|FAILED|REVIEW|MERGED|CLOSED|RED|GREEN|CONFLICT|COMMENT)`; a red PR is fixed at once (hook `tools/pr-red-check.sh`; blocked: `tools/pr-red-ack.sh <n> "<why>"`). Commit subject ≤ 72 chars, imperative; 2+ commits → `--title="<what it does for the user>"`. **PR descriptions** are read in 2–5 s. Body (`tools/pr-body-template.md`, check `tools/pr-body.sh origin/main --body=<file>`): verdict line, **Why:**, **Unblocks:**, impact table, 2–4 bullets, Before/After (images when a screen changed, or "No screenshots: <why>"). Never a CI e2e by hand except one fixed Linux suite on your PR ([docs/rules/change-loop.md](docs/rules/change-loop.md)).
5. After landing, only what applies: Decision Log row for an owner decision that changes what agents may do; Bug Tracker row for a UI bug the Finder missed; Intelligence page when a user-visible AI step changes; the to-do list after a finished task.
6. Big changes: spec with `## Progress`, safety net first, ONE full run at landing, 1–3 commits.

## Where the detail is
| Topic | File |
|---|---|
| Data, stores, Notion, runs | [data-ownership.md](docs/rules/data-ownership.md) |
| Extension, flows, ladder, live tests | [applying.md](docs/rules/applying.md), [apply-flow-workflow.md](docs/rules/apply-flow-workflow.md) |
| Screens, tokens, ⌘K | [desktop-ui.md](docs/rules/desktop-ui.md) |
| Files, comments | [files.md](docs/rules/files.md) |
| Habits, big changes, e2e | [change-loop.md](docs/rules/change-loop.md) |
| Facts easy to get wrong | [facts-and-layout.md](docs/rules/facts-and-layout.md) |
| Knowledge, rounds, private site | [knowledge.md](docs/rules/knowledge.md), [rounds.md](docs/rules/rounds.md), [private-site.md](docs/rules/private-site.md) |
| Why each rule exists | [why.md](docs/rules/why.md) |

## Tests in CI (summary)
CI runs the python, worker and desktop suites; one required check, "All checks passed" (`tools/pr-verdict.py`). A PR runs only the e2e steps and harness test files its changes reach (`desktop/e2e/lib/test-reach.mjs`); a PR's own jobs run under 10 min (`CI-budget: <why>` to exceed). Push hooks run fast pure checks (`SHIP_PR=1`); the full gate is `PUSH_FULL=1`. Detail and guards: [change-loop.md](docs/rules/change-loop.md).
