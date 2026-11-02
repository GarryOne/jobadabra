---
name: fictional-candidate-runs
description: Run a BATCH of fictional job-search candidates (many roles and cities across Europe) on the owner's Mac, on the Claude plan ($0 API), count how many relevant local jobs each one finds (N) against an independent public count (X), say which pass, and store every result so a later round can be compared. Use when the owner says "10 more profiles", "run the fictional candidates", "random candidates", "does the search pass for <role> in <city>", "compare with last time", or when the GTM 6 Job search board needs new or re-measured profiles. One single candidate: skill check-job-search-locally.
---

# Fictional-candidate runs (batch, measured, stored)

**Verdict rule:** "passes" is measured, never assumed. Per candidate: **X** = relevant local jobs counted independently of our engine, **N** = relevant jobs our own search listed, both judged role AND place by the same blind judge. Pass = **N ≥ X** (the Job search board's rule, owner 1 Nov 2026), and only when the independent count is ≥ 1 (an X of 0 is "not measured", never a pass).
Local = that city or its region, or at most remote within its country, never worldwide remote (the rule of skill check-job-search-locally).

## Where it lives (owner, 1 Nov 2026: "store it in a much more persistent and detailed way… so I can check in the future if we improved")
| What | Where |
|---|---|
| Method, table, per-candidate judged jobs (title, employer, place only), the scripts, `compare.py` | public repo `GarryOne/jobadabra-benchmarks`, folder `search-bench/local-profiles/<YYYY-MM-DD>/` (latest folder = latest tools) |
| Overview + the same table | Notion page "Local profiles search rounds" (parent: the Job search / GTM docs) |
| State per profile | Trello board "GTM 6 · Job search" (skill `trello`, Sixth board) |
| Rows next to the other local checks | /admin → Job search → Lab → **Session checks** (`tools/persona-search/publish-session-check.py`, skill check-job-search-locally step 8) |
Not on the Benchmark tab: the benchmark's own rule is "a local run is a side note, never the scoreboard" (`jobadabra-benchmarks/CLAUDE.md`).

## Steps
1. **Pick candidates** from `tools/persona-search/draws.json` (20 role families, 40 cities; add a city by hand in `cands.json`): a role family and a city not yet on the Trello board, spread over countries; bias toward where the employer index is strong (/admin → Job search → Scouting heat map). Fictional only (`Alex Example`, `example.test`).
2. **X, independent of our engine:** `python3 xcount.py` (EURES public search, the role as keyword, the city's region as place, first 100 in-region matches, no login) then `./xjudge_all.sh <ids>` (the benchmark's `judge.py`, plan engine). **EURES gives no place code for some countries** (Estonia, Lithuania, Luxembourg, Ireland, Hungary; Rotterdam gave 0 of 500): those candidates are "not measured" and need another public no-login board counted by hand; say so on the card.
3. **N, one live search at a time** (never parallel, no load on the Mac): `python3 driver.py <ids>` runs `pipe.py` = CV → `tools/persona-search/run.mjs draw … --first-only` (the first-jobs step, ~2-3 min on the plan) → open jobs of the throwaway install → the judge. Run from a worktree of its own (`JP_REPO`), never switch it mid-run. A run that fails or hangs twice stops the queue: stop and tell the coordinator.
4. **Score:** `python3 score.py <ids>`: X pooled = unique (title + employer) relevant jobs of EURES ∪ ours, N = unique relevant of ours. Count unique jobs, not rows (the run's "N of shown" line counts rows). Disjoint sources make a pass hard by design: it asks our search to cover what the independent count found.
5. **Store everywhere** (table above) in the same pass; Trello: one card per candidate named `<City> · <role>: finds N of X`, placed from facts (N ≥ X → Meets target, else Below target, X unmeasurable → Not measured), then the overview card `6 · Job search: n of m profiles meet target` from a Trello read. State the counts as "x of y passed".
6. **Compare with an earlier round:** `python3 compare.py search-bench/local-profiles/<old> search-bench/local-profiles/<new>` (N and X per profile, pass count).

7. **File each finding as a GitHub issue** (owner, 1 Nov 2026: "let's create some gh issues, along the way, we find with the search"): a gap, a wrong judge, a city or role we miss, a login wall, a slow step each get one issue in `GarryOne/jobadabra`, label `search`, with the run or count as evidence. Grep open issues first (`gh issue list --label search`); comment on an existing one rather than opening a twin. List the numbers in the report and on the overview card.

## Traps (1 Nov 2026)
- **A verdict must apply the whole rule.** `score.py` once printed PASS for an X of 0 (N ≥ 0 is always true); the rule says X of 0 is "not measured". Fixed 1 Nov 2026; read the `not measured` rows, never count them as passes.
- Trello MCP: the card text field is `desc` on update; `description` on create is dropped silently (cards came back empty). Read one card back after creating.
- **Claude Code's auto-update swaps `claude.exe` and it is missing for ~10 s** (the global package was replaced at 22:39 and 22:48; four runs died on "no claude install found" / "Claude Code is not installed"). Keep a private copy: `cp <global claude-code>/bin/claude.exe pinbin/claude` (the scripts put `pinbin` first on PATH). Never read a failure of that kind as the search failing.
- The judge needs a real `claude` on PATH, never a shell wrapper (it carries the owner's identity): `real_claude()` in `judge.py`.
- `--first-only` is a floor for N (later steps, light run and scout, are skipped); say so on every card. A full press takes ~20 min.
- Keychain/API keys: none needed; the scripts remove every API key from the environment. Publishing Session checks uses Keychain `jobadabra.site.session_checks_key`; never print it.
- No posting texts, URLs or personal data go in the archive: titles, employers, places only. Round data is public (the benchmark repo is public).
