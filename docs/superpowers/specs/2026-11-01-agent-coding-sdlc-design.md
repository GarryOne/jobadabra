# Agent coding, v2: the SDLC tab and the Checks grid (owner, 1 Nov 2026)

> **Verdict:** a second tab on `/admin/agents/agent-coding` that shows the whole path (agent hooks → push gate → PR checks → main → beta/nightly/e2e → bugs the owner saw) and the four phases (spec, plan, build, maintain), plus one grid of every check by value and cost, so a prune PR like #2832 can be raised from admin data. Report only: it never blocks anything. Builds on v1 ([spec](2026-11-01-agent-coding-page-design.md)).

Owner, 1 Nov 2026: "look on the entire harness/workflow of our development and ... make conclusions. We're having too much bugs because this step is not properly testing ... or we're loosing too much at this step"; "to understand if our speccing is bad or missing. If our plan is bad. If our build is bad. If the maintain is bad"; "This should be probably a separate tab. SDLC"; "I need to understand what brings value and it's fast. What brings value but its slow. What is slow and don't bring values. Or what is fast and brings no value... all the scenarios"; and "work on the SDLC tab" (not waiting for more v1 days).

## The tab, top to bottom
1. **Verdict band:** the weakest layer and the weakest phase this week, one chip each (icon + word).
2. **The path (6 layers, one row each):** runs, stops/reds, minutes, what the stops were (product / test drift / CI-tools / form / flaky / no fix seen) and "got past": product bugs this layer let through that a later layer or the owner caught. Layer 0 (agent hooks) shows "needs the hook counter" until the owner says yes to it.
3. **The phases (4 rows, 1-3 signals each, last full week against the one before, per-day totals):** spec (merged product PRs with no spec or doc file), plan (PRs closed unmerged; commits per merged PR), build (PR check stops per merged PR), maintain (fix PRs in an area within 7 days of a merge there; reverts; days main was red). Totals only: reds are not tied to a PR.
4. **Checks grid (value × cost):** one dot per check, x = average time per run (cost: the feed stores each check's runs and total seconds, so a mean, not a median), y = real catches per 100 runs (value: product or test-drift reds that a fix commit followed, not form, not flaky). Four named corners: **Keep** (fast, catches), **Make faster** (slow, catches), **Remove** (slow, catches nothing), **Cheap, quiet** (fast, catches nothing: merge or leave). Below it one table row per check: layer, runs, stops, real catches, form stops, flaky stops, average seconds per run, hours spent, corner chip. Sorted so "Remove" and "Make faster" are first.

## Where each number comes from (no new CI minutes beyond one daily job)
| Layer | Source | Value of a stop |
|---|---|---|
| Push gate | v1 upload (`gate`) | suite stop = real; form check stop = form; unchanged |
| PR checks | GitHub runs of `pull_request`, one check = one workflow | red → the next green run of that workflow on the branch within a day: same commit = flaky; different code = the class (v1 `classifyFix`) of GitHub's compare diff between the two commits; a rebase (not "ahead") = "after a rebase, cause unclear"; never green = no fix seen |
| Main | runs of `push` on main, red-main days, reverts (git) | same join |
| Beta / nightly / e2e | runs of `schedule`, `workflow_dispatch` and the beta workflow | same join; a red nobody fixed = no fix seen |
| Bugs the owner saw | GitHub issues with label bug (count per day) | product, by definition |
| Phases | merge commits + files per PR (git), closed-unmerged PRs (API) | proxies, labelled |

- New upload kind `sdlc` (one card per day) from the same daily workflow `agent-coding-stats.yml` (`tools/sdlc-stats.mjs`); the page reads `gate` + `ci` + `sdlc`. Only counts, seconds and fixed check names leave GitHub; never a branch, path or commit text. A check is a workflow's name (no job names are fetched). GitHub calls: runs by 4-hour slices plus one compare per red followed by a green on different code; the daily job runs on the workflow's own token and stops, and says so, when 300 calls are left; a local or by-hand run on the owner's shared limit is kept above 2,500 remaining by hand.
- Measured 1 Nov 2026 over 5 days: 490 PR reds, 40 followed by a green on the same commit (a re-run), 432 by a green on different code, so author dates and shas cannot tell a fix from a re-run (amend, rebase, force-push); the compare diff can. About 45% of PR reds are a rebase with no readable cause (owner accepted, shown plainly, so real catches are a floor).
- A catch's class is a heuristic (about ±10 points, labelled on the page). A check with under 20 runs in the window is greyed "too few runs", never put in a corner.
- Layer 0: a counter written by the agent's hooks (`~/.claude/hooks`). Any hook or settings edit is **the owner's own yes**, via mac-07; until then the row is a visible "not measured".

## PRs (n/N)
1. `jobadabra` 1/3: `tools/sdlc-stats.mjs` + workflow step + tests (recorded input).
2. `jobadabra-web` 2/3: `sdlc` ingest, the tab, the grid, demo seed, tests.
3. `jobadabra` 3/3 (only after the owner's yes): the hook counter.

## Tests (named files only)
- `desktop/test/sdlc-stats.test.js`: catches per check from recorded runs, flaky vs fix, corners, phases, labels only.
- `jobadabra-web/test/admin/agent-coding-sdlc.test.js`: ingest clamps and replaces, the four corners, "too few runs", empty states, escaping, tab link.

## Progress
- [x] Owner direction recorded (above) (proof: docs/superpowers/specs/2026-11-01-agent-coding-sdlc-design.md)
- [x] Spec read against real numbers: 5 days, 11,209 runs, 443 merges (proof: none: a one-off run of tools/sdlc-stats.mjs, numbers in the PR body)
- [x] Preview (desktop | phone, real numbers) and the owner's yes: "Yes, build it as shown (Recommended)", "Accept, show it plainly (Recommended)" (proof: none: the owner's answers, the image is in the web PR)
- [ ] PR 1/3 `sdlc-stats` and workflow step (proof: tools/sdlc-stats.mjs, desktop/test/sdlc-stats.test.js)
- [ ] PR 2/3 the tab and grid (jobadabra-web)
- [ ] Hook counter: the owner's own yes on the exact diff, then PR 3/3
- [ ] First `sdlc` upload seen on the live page
