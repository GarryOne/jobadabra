# A fix round: how the coordinator runs one (owner, 11 Oct 2026)

A round = several sessions fixing the applying flow's failing pool rows. Judged by ONE number: **rows "Confirmed" on `/admin/form-filling/lab`** (a pool run
cleared them), per hour. 11 Oct 2026: ~3 h, 6+ sessions, 2 rows confirmed; 75 of 131 commits were tooling, and the coordinator had told the owner
the wrong cause for the waiting ([why.md](why.md)).

## Start of a round (the coordinator, in this order, a few minutes)
1. **The Mac first:** `uptime`, `sysctl vm.swapusage`. Swap over ~70% or load far above the core count: it is memory, not CPU (11 Oct: UTM 3 GB + 8
   sessions ~2.5 GB, load 31). Ask the owner to quit the VM; list the finished sessions they can close (each ~400 MB). Do not add parallel runs on a swapping Mac.
2. **Read the By cause tab** (`/admin/form-filling/lab`, or `~/jobadabra-web/tools/site-run.sh node jobs/needs-fix-causes.mjs --rows`). Rows in **Run first** (never run, or no run since their fix)
   go to the pool owner for a run BEFORE any fixer starts: 10 of 29 rows were never-run shapes, not failures.
3. **Weigh by real demand before choosing a cause** (owner, 11 Oct 2026): `/admin/form-filling/lab`'s scorecard gives each platform's share of users' matched jobs
   ("Of matched jobs"; 11 Oct: Greenhouse 55%, Ashby 34%, everything else 0-3%). A cause on a 0-3% platform waits unless its fix is generic and cheap; a
   platform with a high share and a low real fill ("Blind spot": Ashby real forms filled 57%) comes first even when no pool row is red. Success of the round
   is also the real-use fill share of the big platforms, not only pool rows confirmed.
3. **One session per cause** (the biggest unclaimed), not per row. The brief = `~/jobadabra-web/tools/site-run.sh node jobs/needs-fix-causes.mjs --brief "<cause>"` (rows, newest captures, exact commands, proof order, rules) + your one line of judgment (`--note "..."`); "Run first" refuses. The brief says its target: "rows of this cause confirmed by a pool run", and the
   owner pastes it into a NEW session (the paste is the owner's approval; a message to a running session waits for the owner in that window).
4. **Prove a fix in four steps, fastest first** (owner, 11 Oct 2026: proof used to take hours): (1) 3 of 3 real asks of the app's AI on the saved page
   (`ladder-score`, plan path); (2) the row's network record replayed offline (`node replay-net.mjs`; `npm run row -- "<pool row>"` only for a row without a network record, 15-90 s: its pages, the live run's AI answers, the app's own server, the real
   extension; it must reach further, and `--old` must not: a differential only, offline replay is unverified (spec `docs/superpowers/specs/2026-10-13-capture-once-measure-many.md`: 0 rows matched live; a row with a CV upload, 17 of 39, misses the account judgment after it; compare like with like: a CI capture replayed on a Mac misses page-kind asks from the page width alone, whatever the build), so step 3 proves it); (3) ONE live run of the single row from the fixer's own worktree before landing, held, ~1 min
   (`npm run live -- <url>`, no Electron, or `npm run record-sites -- --only`), through the fair heavy lock (never uploaded); (4) the scoreboard: the pool owner runs all fixed rows in one
   batch on main, and "Confirmed" needs two clean runs. A fixer lands after step 3 and then goes idle; it never queues for the batch.
5. **No new tooling during the round.** A gap goes on a list for after, unless it blocks the fix itself (then say so to the owner).

## During
- **Before telling the owner why something is slow or broken, measure it** (swap, load, the lock's holder, one log). 11 Oct: "the shared Notion test page"
  was asserted without opening one run log; 59 of 59 logs said sqlite. A wrong cause cost a brief and an hour of belief.
- **A worktree name is not an owner:** before telling a session to cancel, change or wait because of a run, a lock waiter or a claim, name the session that owns that pid
  (parent pids -> `~/.claude/sessions/<pid>.json`; `node tools/round-status.mjs` prints it). 11 Oct: a run in worktree `fix-combobox-state` was blamed on the wrong session.
- **A new tool is proven on a small fixture with a known answer first, a real capture second** (a replay, `row-to-case`, a harness step). A fix keeps
  the fix order (the real capture, fix-recorded-sites 0a). 11 Oct: proving `row-to-case` on the hardest capture first (taken after the fix, a French
  posting, autofill after upload) took ~2 h of "no difference" from three replay flaws before one yes. **No yes or no after 30 minutes: stop**, land what
  is tested, report to the coordinator.
- **One session owns a row's live visits for the day** (owner, 12 Oct 2026): the per-site limit is 3 live visits a day, and on 12 Oct HelloFresh's were spent by
  the pool pass and two other sessions before its fixer's proof. The coordinator names which session owns each row's visits; the others use `npm run row` / the
  replays to work on it (their verdict is no proof: offline replay is unverified), or ask the owner before spending a visit on a row another session works. `npm run live` checks the ledger before it queues for the heavy lock.
- **A new CI check is proven green on a draft PR before it goes on main** (owner, 12 Oct 2026). Run it from a branch, fix what it finds, add it only when it
  passes; a check that fails on every PR is ten red marks in the PR list for what is not a problem of those PRs. 12 Oct: the "harness tests" job was added to
  every PR first; it failed on #391-#394 (2 old failures on main, a staging step only a shard exposes) and on #396-#398 (cut before the fix).
- **A tooling goal gets an overall budget and a one-line "what this unblocks" before work starts** (owner, 11 Oct 2026). The 30-minute rule covers one
  step; this covers the goal. When the budget is spent, the coordinator stops and asks the owner "continue or stop?" with what was achieved, instead of
  approving one more step. 11 Oct: "real-page row cases deterministic in CI" ran ~4 h in reasonable 30-minute steps (A, A2, live latency, ordinal
  fallback, speed gate) and never got there, while small hand-cut recorded pages already guarded every fix that day.
- Report confirmed rows per hour, and what each waiting session waits for (one line each).
- A finished session says "done" and the coordinator tells the owner it can be closed.
- When the owner asks where the sessions stand: skill **report-sessions-roundup** (one table: Session, Work, Status, Waiting on, Progress %, ETA; closed sessions left out).

## End of a round
Confirmed rows before -> after; the lessons, each in its strongest form ([knowledge.md](knowledge.md)); the list of gaps for the next tooling slot.
