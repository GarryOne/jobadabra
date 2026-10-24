---
name: check-job-search-locally
description: Run ONE live job search of a fictional candidate (a fixed Lab one or a random role and city) on the owner's Mac, on the Claude subscription ($0 API), and report time to first job, jobs in places, scored and 70+ against earlier runs. Use when the owner says "check the job search", "run a search test", "try the search on <candidate>".
---

# Check the job search locally (on demand)

The owner's job-search check is **real installs' results + the Random draws** (owner, 19 Oct 2026); the offline replay is parked. This skill is the one on-demand live run: a fictional
candidate through the app's own path (CV → strategy → first "Find jobs"), on this Mac.

## What it uses and costs
- **AI: the owner's Claude subscription via `claude -p`: $0 API.** Never the Tests key, never any API key: the script removes `ANTHROPIC_API_KEY`, `LAB_HEAL_ANTHROPIC_KEY`,
  `RANDOM_DRAWS_ANTHROPIC_KEY`, `OPENAI_API_KEY`, `REPLAYS_PUBLISH_KEY` from its environment (`tools/persona-search/search-check.mjs`, test `tests/test_search_check.py`).
- **Sites:** live public job sites, never past a login wall, no apply (the engine's own rules).
- **A throwaway install** (`run.mjs`: its folder under the OS temp dir): never the owner's app folder, Keychain, Notion, Telegram or data; telemetry and sharing off.
- **Identity:** `claude -p` knows the owner's name, e-mail, country and city; the harness runs the real `claude` install, never a shell wrapper that adds the session's settings
  (`desktop/e2e/lib/real-claude.mjs`), and the candidate is fictional (`example.test`). If a result shows the owner's real name or city, stop and say so.
- **Time:** about 5-12 minutes for the one press (a plan-path run is slower than CI's). Nothing is posted anywhere.

## Run it
1. Pick the candidate from the owner's words: `finance`, `music`, `driver`, `sre` (control), `cluj`, `chisinau`, or `random` (a role family + European city picked by a seed;
   `--seed <text>` repeats one). No word → `random`. Say the pick in one line.
2. Say in one line what will run, where its log is, and that it takes ~10 minutes; then start it **in the background with a tee** and arm a Monitor:
   `node tools/persona-search/search-check.mjs <candidate> 2>&1 | tee <scratchpad>/search-check.log` (`run_in_background`), Monitor:
   `tail -n 0 -F <log> | grep --line-buffered -E "^PRESS|Traceback|FAILED|SEARCH CHECK DONE|Error"`. The first line of the log (folder, seed) must show within ~20 s; if not, say it failed and diagnose.
   `--dry` prints the plan and starts nothing.
3. On the result lines (`Time to first job`, `Jobs in your places`, `Scored`, `Scoring 70+`) tell the owner, in a small table, each number **beside the earlier local runs' median**
   (the script prints it from `~/jp-search-check/history.jsonl`; first run: "no earlier local run").
4. Put them next to the live picture: open `/admin/lab-job-search` (Random draws, Real installs; read it with the Bearer from Keychain `job-pilotto.site.api_key`, memory *reference-owner-pages-access*)
   and quote the latest Random draw's numbers and the real installs' medians for the same role family. One line: better / same / worse, and the weakest number.
5. A FAILED row (a step crashed) is shown as FAILED with its step, never as numbers.

## Quick loop for fixes (24 Oct 2026, the beyond-Moldova checks: a full check is 20-25 min, mostly the scout and the light run)
1. **Offline first, seconds, no AI:** save the page a board gave (`curl -sL -A "Mozilla/5.0" <url> -o <scratchpad>/x.html`) and run
   `python3 tools/persona-search/page-probe.py <x.html> <its address>`: JSON-LD jobs, job links, next pages. Fix the reader on that page, add a fixture-shape test.
2. **`--quick` (~6 min):** `node tools/persona-search/search-check.mjs <candidate> --quick` stops after the first-jobs step: boards proposed and read, local jobs.
3. **Count local jobs, never "in places"** (it includes worldwide remote): the press row has `local_jobs` and `local_by_source` (metrics.py).
4. **`--quick` misses what happens after "First jobs"**: the title-budget and ladder-retry fixes (#1826, #1827) show at 129-371 s in the full board pass; they need the full run (fc, 24 Oct 2026).
5. **Variance is mostly which boards the AI proposes** (Chisinau: 22/14/7/12/18 local jobs on the same code): compare per-board counts (`local_by_source`) and run 2-3 times. The persona CV says "remote from <country>". The primary checkout auto-pulls every ~2 min, so a check started later runs newer code.
6. **Name the unit.** `local_jobs` counts JOBS whose place text names the user's city or country. Session 36's per-country scout line counts EMPLOYERS with a role placed there
   (scout_cells.totals), and its board measure counts jobs resolved through pool_tags.countries (AI labels); same rule (local only, never worldwide remote), different unit and resolver.
7. **Thin country: check first that board facts were served for it.** Board seeding is inert until a central scout run has printed `Board pass: <country>: N boards proposed, M with 3+ local jobs`
   (stored as site facts `central-scout-<cc>`). Say in the report whether they were served and from which run; if not, "no boards" is the cause, not the search. Scout-side checks: skill `check-central-scout-locally`.
8. **Publish every finished check** so other sessions read it on `/admin/lab-job-search` tab "Session checks" (owner, 24 Oct 2026): before running a check, read that tab for the same case;
   after it, `python3 tools/persona-search/publish-session-check.py <out> <case> --session <your short name> --label "Nurse, Zagreb" --country Croatia --role nurse --mode full|quick --build <sha> --broke "<what broke>" --conclusion "<what it shows>" --prs "#n"`
   (`--dry` prints the row; the key is the Keychain item `job-pilotto.site.session_checks_key`; counts and board names only, no job titles or companies).
9. The full check only for the final number. Never edit or switch the checkout a check runs from while it runs (it reads src/ per step): run checks from their own worktree.

## Also on CI (only when the owner asks, and asks first)
`gh workflow run random-draw.yml` runs one Random draw on CI (~$0.85 on the Random-draws API key, a different candidate each seed). Say the cost and wait for a yes before starting it;
add `-f seed=YYYY-MM-DD` to repeat a day.

## Not this skill
- Fixing a weak search (that is a normal code change through the change loop), the parked replay (`search-lab*.yml`, by hand only) or the Real installs tab.
