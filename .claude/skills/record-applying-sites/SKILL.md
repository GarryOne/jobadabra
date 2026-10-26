---
name: record-applying-sites
description: Record, grow and coordinate the pool of real sites the applying flow is tested on: record a NEW site once to its form, re-record only on a signal (never a schedule), discover new flow shapes, read real use (what installs' fills miss), the report on /admin/lab-form-filling, and the hand-off of failing shapes to fix-recorded-sites. Use when the owner says "record sites", "run the smoke pool", "grow the pool", "run discovery", "improve filling", "review extension failures", or when taking over the applying test pool from another session.
---

# Record the applying sites (the pool)

The pool is ~50 real postings, one per **flow shape**, run live and HELD (never an account button, never Submit) with the real extension in the
e2e harness. It answers "did a real site change under us, and how far does each flow get?". This skill **runs, grows and coordinates** it. It does
not fix shapes: a failing one goes to `/fix-recorded-sites`; one that needs the owner's real state is reproduced on the twin, on demand (docs/live-test.md).
Spec: `docs/superpowers/specs/2026-10-10-applying-reliability-layers.md` (four layers); flows map: `docs/flows/applying.md`.

## Taking the role (do this first)
Whoever owns the pool and its run queue writes its own session name into `~/Library/Application Support/Job Pilotto QA/coordinator.txt` (one line, then what it is), when it starts and whenever its name changes: every other skill reads that file to find who to report to. `ListAgents` shows your own name on its first line. Tell the peers once ("I am the pool coordinator now, report to <name>").

## What exists
- **Runner** `desktop/e2e/record-sites.mjs` (`cd desktop/e2e && npm run record-sites`), logic in `lib/record-sites.mjs` (every mode orders through `lib/record-sites-order.mjs` `orderPool`: never run first, then the fewest runs in 14 days, then the oldest last run, then the pool's order; rested rows are skipped and listed; only `--only` is the fixer's own choice; a share is the front `runShare`; `parseLive`, `signature`, `compare`,
  `NEVER_VISIT`), upload in `lib/applying-report.mjs`. It never schedules itself: there is no schedule: the owner decided (11 Oct 2026) that the pool runs BY HAND only, ask once.
- **The daily discovery batch** (owner, 17 Oct 2026; the one scheduled run): `record-sites.yml` `schedule` 06:00 UTC → job `pick` (`discovery-pick.mjs`, no AI) → job `smoke` records the picked
  rows (≤5, rows file as RECORD_SITES, `$3` a calendar week) → `discovery-report.mjs` judges them and sends ONE Telegram message (Build Log bot) only when something new failed → job `pool-pr`
  opens a PR adding rows that reached a new shape to `smoke-sites.json` (never merged by CI). Inputs: `GET /applying/discovery-input` (narrow key). Nothing to do by hand; to try it:
  `gh workflow run record-sites.yml` does NOT run the batch (only the schedule does); test the pieces with `node --test desktop/e2e/test/discovery-*.test.mjs`.
- **On a GitHub runner, by hand** (owner, 12 Oct 2026: start simple, grow it, report to the coordinator before growing): `.github/workflows/record-sites.yml`,
  workflow_dispatch (`e2e/test/pool-ci-triggers.test.mjs` fails on any schedule but the batch's one cron, a push, a PR trigger or any caller). every row of the repo's pool list; default = bot-tolerant rows; `gh workflow run record-sites.yml -f only='<row words>|<more>' -f share=<n>`.
  The app asks through its API engine on the Tests key via the metering proxy (each row prints `live: AI spend $x`); hard caps in the workflow: 3 rows, $0.50 a run. One CI pool run at a time through a queue that never drops one (`pool-ci-wait.mjs`: each run waits for the earlier ones; never a concurrency group, which cancels a pending run: Ocado's dispatch, 12 Oct 2026).
  CI's own site ledger (2 visits a host per UTC day across all CI runs, by hand both of them (each visit records its kind): each run uploads a `record-sites-state-<run>` artifact, the next reads them all, `lib/pool-ci-state.mjs`; NOT the Mac's, so a host can get 3 + 2). A bot wall on the runner's IP = "blocked (CI IP)", never a failure; no Electron leg on CI.
  Nothing uploaded; the result is the table in the job log and the artifact (day report, `smoke.log`, `evidence/<day>/<row>/`). Red for a row that did not finish, the tripwire,
  a refused AI (`live: AI refused`), or a row below its last CI run on main or on this PR. Each dispatch spends money: on the owner's or coordinator's ask.
- **A recording proves nothing live** (owner, 14-15 Oct 2026): a fix is confirmed OFFLINE on the row's recording (the Fixed tab's "Confirmed offline"); a CI recording run sends no proven record any more (the proven-record upload, its site route and its list tool are retired).
- **No live run on a PR** (owner, 13 Oct 2026: "I don't want PR to generate an AI cost"): there is none;
  a live CI run is `record-sites.yml` started by hand only (`only` = row words), on any branch: `gh workflow run record-sites.yml --ref <branch> -f only="<row>"`.
- **Recordings are a debugging tool** (owner, 17 Oct 2026, `docs/rules/apply-flow-workflow.md` "The rule for recordings and replays"): a failure (Report this form, the daily replay, a bake-off row)
  → record THAT one site once → reproduce and bisect offline → fix → freeze it as a page case. Testing is offline (#657): the daily `.github/workflows/site-replays.yml` (~7 rows, one per kind of form users meet;
  never on a PR) replays each row's newest network record with main's build (`replay-records.mjs`: no site, no model call, $0), alerts only on a worse outcome, and starts the refill / lists a re-record only for the rows it flags.
  Do not re-record a row nobody uses, and drop one whose re-record will not reproduce.
  A live pool visit is for a NEW record only: a row whose record is old, missing, or not "same as live".
  - **Record on the Mac first** (`cd desktop/e2e && JP_NET_RECORD_DIR=<dir> npm run record-sites -- --only "<row>"`: plan `claude -p`, no API cost, the replay runner's fonts);
    **CI only when the Mac is blocked** (a bot check, the Mac's site limit; say which): `record-sites.yml` keeps its records encrypted as `net-records-<run>` for 14 days, but replays never read them (owner, 15 Oct 2026): a CI recording reaches a replay only after `records-publish.mjs` publishes it through the guard.
  - **Publish the Mac's records:** `node desktop/e2e/records-publish.mjs <dir>` (the newest per row, encrypted with `net-record.pub.pem`, ADDED to the pre-release `net-records` as its own bundle; the other bundles stay, the newest record per row wins); the PR job reads it first. Publish only your new records: no need to fetch the set first.
  - **Decrypting the set** (only to edit a record, e.g. its kept answers): the private key is the Keychain item `job-pilotto.capture.key` (account `job-pilotto`); write it to a temp file for the openssl step and delete it at once; never print it.
  - A row not "same as live": find its cause BEFORE re-recording, in the spec table "Why a row does not replay as live" (`docs/superpowers/specs/2026-10-13-replay-by-network.md`: the first missed ask via `JOB_PILOTTO_MODEL_MEMO_MISSES`, then 9 known causes, 14 Oct 2026). Re-record only when the table says so (an old recorder, a live run cut short); a build that really got worse is the product's bug, and the replay is its cheapest reproducer. A new cause goes into that table.
  - A row whose Fixed-tab verdict is "Needs a recording" or whose regression verdict is "Site changed" (`/admin/lab-form-filling`, "Confirmed offline") is what the pool should re-record or run live next: the offline replay could not say.
- **The pool is ONE list in the repo:** `desktop/e2e/smoke-sites.json` (owner, 12 Oct 2026: job postings are public pages, so every row lives here and CI runs it;
  the old rule "never commit a posting taken from a profile" is RETIRED). What stays private is the owner's own details, CV and answers: no run ever holds them
  (fake applicant, privacy tripwire), and they never enter a commit, an artifact or a log. A posting address carries no query part that could carry a person
  (`personalQueryKeys`, test-guarded). `~/Library/Application Support/Job Pilotto QA/smoke-sites.json` is now only a Mac's optional extra list, read and never
  written (a name already in the repo wins: `poolShapes`).
- **Reports:** `~/Library/Application Support/Job Pilotto QA/smoke-reports/<day>.json` + one `.log` per run + `discover-<day>.json`. They name real postings: they stay on the Mac.
- **Evidence bundle** (11 Oct 2026): every finished run keeps `smoke-reports/evidence/<day>/<shape>/` = `evidence.md` (the four lines that matter: page kind with frames and the digest flag, the digest's validated answer, what was pressed, where the page went), `run.log`, `app.log`, `ai-calls.json`; the day's report quotes the same lines under `results.<shape>.lines`. **A run that was killed or cut short (no end of the watch) records and uploads nothing.** Read the bundle first when you say which blocker a fix is for; `lib/evidence-bundle.mjs`, `test/evidence-bundle.test.mjs`.
- **End picture of every local run** (owner, 11 Oct 2026: a must, where the extension STOPPED; local only, never uploaded; a tripwire hit deletes it; a run that cannot take one says `no end screenshot: <why>`, an error in its verdict). **Look at it first.** **Full page, one per step** (owner, 11 Oct 2026): every picture is the whole page (also a panel that scrolls inside it; a cap says `cut at <n> px`), with the extension's own panel in it as the person sees it. Each new page or step also gets `step-01-<kind>.png`, `step-02-<kind>.png`, … (at most 12, beside `end.png`; a replay's are `replay-step-NN-<kind>.png`; printed as `live: N step picture(s) kept in <dir>` / `row: step picture: <path>`; a missing step shot is only a warning). **Look at `step-*.png` in order, then `end.png`.** Where: pool recording `smoke-reports/evidence/<day>/<row>/end.png`; `node e2e/live.mjs` / the Electron live run `<capture dir>/end.png` (path printed: `live: end screenshot kept`); a saved capture `replay-candidates/<day>/<row>/end.png` (the live run's) beside the replay's `end-replay.png`; an offline replay (`npm run row`, `rows`) `<capture dir>/end-replay.png` (printed as `row: end screenshot: <path>`), to set beside the live `end.png`. A run whose form judge said `blocked` prints `BLOCKED (dialog|error|overlay|gone)` and is a needs-fix, never a success (`parseLive` `blocked`).
- **/admin/lab-form-filling** (owner-only QA page, not `/admin/real-form-filling`, which is real users): tiles, fixed-site replays, "The pool" table (platform from the END host,
  flow words), the runs. Bearer = Keychain `job-pilotto.site.api_key` (memory `reference-owner-pages-access`). Uploads carry hosts, site names and signatures only,
  never a posting address (`applying-report.mjs`; a test fails on a path, query or token); never uploaded from CI or control runs (`REAL_EXTENSION_DIR`).
- **Other layers** it sits beside: journey scenarios (`desktop/test/journeys.test.js`), recorded pages (`desktop/e2e/recorded/`, `npm run recorded`), the fleet digest (`boards[].dropped`).

## Commands (all from `desktop/e2e`, in your own worktree: `tools/worktree.sh smoke-<topic>`)
| What | Command |
|---|---|
| A run's share (`RECORD_SHARE`, default 10: the shapes least recently run first; `SMOKE_PER_NIGHT` is its old name) | `npm run record-sites` |
| Some shapes | `npm run record-sites -- --only <words of the shape>` |
| The whole pool (~55 x 2 min; least tested first, so a stopped pass is resumed by running it again) | `npm run record-sites -- --all` |
| Find new flow shapes from the loaded profile's jobs (a few per host, more from boards) | `npm run record-sites -- --discover --limit 30` (~45 min) |

`--discover` also asks /admin/lab-form-filling for "Next sites to add" (hosts real users apply on that the pool lacks, each used by >= 3 installs; `lib/wanted-hosts.mjs`, owner key from the Keychain) and tries postings on those hosts first; a suggested host with no posting among the profile's jobs is printed and put in the discover report (`noPosting`), never skipped silently. A shape discovery finds goes into the repo's `smoke-sites.json` (commit it so CI runs it; test guard). The site list is empty until 3 installs share a host.

`--discover` names a new shape by the posting's employer and, when the same host has a shape that was never run, fills that one instead of adding a row (474c641).
Longer waits: `RECORD_SECONDS` (default 90). The settings were `SMOKE_*` until 15 Oct 2026; the old names still work with one warning (`tools/record-env.mjs`). A posting gone (HTTP 404/410) is noted and replaced, never a regression. Exit 1 = a shape reached less than ITS last run.
**Rows run without Electron by default** (owner, 11 Oct 2026; speed-5x landing 3): each row runs on the app's own server under plain node (`live.mjs`): ~35-65 s a
row instead of 69-97 s, no 27 s app start, the same reached/filled on 3 paired rows, the privacy tripwire on. `RECORD_ELECTRON=1` (or `RECORD_NO_ELECTRON=0`) runs the
Electron app for a row that needs the real app; the run's first lines say which path ran.
**What a candidate holds** (`replay-candidates/<day>/<shape>/`): every page and frame at the extension's ask, its CSS, the live AI answers (`model-memo.json`), the live presses
(`presses.json`); `RECORD_KEEP_CANDIDATES=1` keeps passing rows too. **After a fix batch lands, `npm run rows` replays the day's rows offline** (4 tabs, minutes, no AI cost):
a row that now stops earlier than its live run is a regression CANDIDATE only, confirmed on the row live: offline replay is unverified (spec `docs/superpowers/specs/2026-10-13-capture-once-measure-many.md`: 0 rows matched live; a row with a CV upload, 17 of 39, misses the account judgment after it; compare like with like: a CI capture replayed on a Mac misses page-kind asks from the page width alone, whatever the build).
**Captures library** (capture once, measure many, 13 Oct 2026): EVERY row's capture, passing or not, is kept in `<QA folder>/captures/<day>/<row>-<time>/` (Mac) and as CI's 30-day `pool-captures-<run>` artifact (`npm run captures -- pull` copies them here). `npm run measure` replays them offline, but it is **UNVERIFIED** (its positive control has not passed: 0 rows matched live; rows with a CV upload, 17 of 39, miss the account judgment): measuring runs stay live batches until the spec says the control passed. The per-site limit is unchanged.
**Where the captures live and how a fixer finds one** (11 Oct 2026 capture pass): on this Mac only, never in git (they hold real pages), under `~/Library/Application Support/Job Pilotto QA/replay-candidates/<day>/<shape>/`
(`<shape>` = the row name lowercased, runs of other characters turned into `-`, cut at 60 characters); a fixer needs no path: `cd desktop/e2e && npm run row -- "<pool row name>"` finds the newest day's folder.
A row that stops at the posting keeps no folder (nothing to replay). A capture made before the offline app seeded the full applicant (9f6ff67), or with a kit seeded on the posting (before 717a560), replays its page kinds but its FILL asks miss:
`npm run row` says "captured with an older applicant seed"; count that as "needs re-capture", not as an unfaithful replay. A form opened by a press in a page the capture never recorded (Richemont's `/apply`) ends the replay at "route not recorded".

## The rules that bite
- **The machine-wide heavy lock decides when a pool run starts** (`tools/heavy-lock.sh`, the primary checkout's copy for every session, first come first served): one run, and a 2nd beside it only while free+inactive memory is over 7 GB and swap is low (one pool run peaks at 3.3 GB); never a 3rd. It queues you and prints the holder. Pool and live runs are on SQLite in a throwaway profile: **no Notion page, no shared port** (11 Oct 2026: 59/59 logs "store under test: sqlite", `notion-requests.log` empty; each run has its own ports, profile and artifacts folder). Only `notion-real` takes a Notion page lock (`lib/notion-page-lock.mjs`). **No slot messaging** (owner, 11 Oct 2026): don't ask peers for the page or a slot, don't send "done"; just start, and the lock queues you fairly. Never bypass it (`JOB_PILOTTO_HEAVY=0`).
- **Live runs only, by hand, from a worktree that has the privacy tripwire** (`e0fce93`: it checks every typed field against the owner's own values and fails the run and deletes its capture on a match). Live runs are the only thing that takes the heavy lock now: the push gate runs no browser and takes none (11 Oct 2026). A run takes ~62-70 s on a quiet Mac (load < 10; measured at load 20-48 it only looks slower). `RECORD_KEEP_CANDIDATES=1` keeps passing rows too; a row carries `presses.json` and its ask-time states, which `npm run row` (offline replay, `desktop/e2e`) needs: a row from before that has none, so a fixer runs it live once first. An offline replay is for fixing; **Confirmed still needs two clean live runs**.
- **Per-site daily limit (owner, 11 Oct 2026; `desktop/e2e/lib/site-ledger.mjs`):** at most 3 live visits per host per day across all sessions and live paths; a 4th is refused naming the site and the last run, and a host that showed a block page rests until tomorrow (the AI's bot-check flag counts only when it is sure, >= 0.8, or the form did not fill: a contradicted flag is logged "possible bot check (contradicted)" and the host stays open; owner, 12 Oct 2026). Only the owner lifts it: `JOB_PILOTTO_SITE_LIMIT_OVERRIDE=<host>` (logged); never work around it.
- **Say before a held run** what the window does and what is HELD (headless Chrome, fake applicant, no consent, no account button, never Submit), and how long.
- **Background + Monitor, never sleep** (global rules). Start the run writing to a log, then arm a Monitor on its summary lines:
  `tail -n 0 -F <log> | grep --line-buffered -E "^record-sites: |regression|rror:"` (one event per site: `reached <step>`, filled/left counts), and a second one for the end: save the run's PID at start (`echo $! > <scratch>/pid`) and watch `while kill -0 $PID 2>/dev/null; do sleep 3; done; echo ended`.
  Never `pgrep -f record-sites.mjs` inside a Monitor: the Monitor's own command line contains the pattern and matches itself, so it never ends (anchor it, `pgrep -f "^node record-sites.mjs"`, if you must). Test the pattern with `grep -c` on a log so far. Each event: one line on what it shows, then decide (progressing / done / stuck).
  First sign of life within ~20 s or say the run failed. Stop only your own run, by saved PID, never `pkill -f` (it kills other sessions' suites).
- **NEVER_VISIT:** LinkedIn, Glassdoor, Indeed, levels.fyi, Reddit are never run (`lib/record-sites.mjs` `NEVER_VISIT`; discovery once visited an Indeed posting before it existed).
  Check any new candidate source against it. Never log in, never get past a login wall or bot check (401/403/429 or a check is a "bot/code" result, not a bug to defeat).
- **Isolation:** the harness cuts off the live app, profile, CV, Keychain and paid AI and asserts it (`lib/extension.mjs`, `startRealExtension`). After a run, check the live app's
  `logs/app.log` has no lines from it. Never hand-roll a launcher.
- **Distinct flows, not distinct addresses:** a candidate joins the pool only with a flow signature the pool lacks (page kinds in order, the host the journey ended on, how far it got).
  Platform is decided from structure (the end host), flows from the extension's own page-kind decisions, never from addresses or words.
- **No local flows matrix as a gate** (owner, 9 Oct): the pool and the matrix never block a push; live sites are moody.

## A round
1. **Start it:** the heavy lock queues you (first come first served, a 2nd run only with spare memory); no asking peers for a slot.
2. **Run** (a run's share, or `--only`/`--all`, or `--discover` when the owner loaded a new profile), held, with Monitor. Report per site as it lands.
3. **Read the result:** regressions first (a shape that reached less than its last run), then the sites that reached the earliest step, then bot/code holds (documented, left alone).
   Compare with the last report; a site that failed once is run again before it counts.
4. **Hand off** each failing shape, one line each, to `/fix-recorded-sites` (the shape, the log path, the frame folder, what the log cannot tell). The ready prompt per cause: `node tools/needs-fix-causes.mjs --brief "<cause>"` (docs/rules/rounds.md step 3). Several sessions may each take a different shape:
   give every one its own worktree and scratch folder (global rule "Several agents at once"), and the flow core goes to one session at a time (claim message).
   A shape that needs the owner's accounts or Gmail goes to the twin, on demand (docs/live-test.md).
   **Landed fixes come back to you:** a fixer hands you "landed <hash>, extension <version>, run <shape>". Update the runner to that build, run just that shape (held, Monitor), upload it, and send the fixer the step
   reached, the page-kind lines and the app.log path. A row clears on `/admin/lab-form-filling` only through such an uploaded run (the pool is only ever started by hand); a recorded page passing does not clear it.
5. **Grow the pool** (when asked or after a profile change): `--discover`; read what it added to `desktop/e2e/smoke-sites.json` and why (the new signature), then commit it. A gone posting (HTTP 404/410, "posting gone", never red): replace its url with a posting of the same shape (discover lists candidates from the profile's jobs).
6. **Report to the owner:** counts (run, reached form / posting / bot, regressions, new shapes), what moved since the last report, what was handed to whom. Say "done" to the peers.

## Reading real use: "Next sites to add" and the platform scorecard (10 Oct 2026)
`/admin/lab-form-filling` also says where real users apply and how it goes (`?json` has `next` and `scorecard`; the owner key from the Keychain, never printed). Read both at the start of a round, then act:

| Scorecard verdict | It means | Do | Skill |
|---|---|---|---|
| Not in the pool | real use, no pool site on that platform | add a site on it: `--discover` (suggested hosts are tried first), or a public-feed posting; never a user's posting into the public file | this skill |
| Weak in both | tests and real fills both fall short | fix first: it costs users most | `fix-recorded-sites` |
| Blind spot | the pool reaches the form, real users' fills do not | the pool tests the wrong shape: find what real fills miss, then add a recorded page | the real-use section below, then `fix-recorded-sites` |
| Test failing | real use is fine, pool sites fall short | reproduce, and check the site did not change | `fix-recorded-sites` |
| Fine | | nothing | |

- **Rank by demand, not by install count:** a platform with most of the matched jobs and no pool site comes first, even from one install ("Of matched jobs" against "Of the pool"). Hosts ("Sites") are only listed once 3 installs used them; countries under 3 installs show as "other".
- **Under 5 real forms is no evidence** (the scorecard shows "—"): judge by the pool alone, and say so. Workday has no real forms until an app with the board names (720f344) is in use.
- Say in the report which platform rows you acted on and which you left, with the verdict. The data is counts and platform names only: never quote a host as an install's.

## Real-use signal: what installs' fills miss (was the skill `record-applying-sites`, folded in 15 Oct 2026)
Every extension fill writes a record (Notion "Job Apply — Agent Runs", Agent = Extension): a field-by-field table and a Debug data JSON (the form as read, each answer and its source, dropdown attempts, errors, extension version).
1. **Collect:** `python3 tools/fill-failures.py --days 14` (`--json` for detail): fields left unfilled, grouped by reason and job site, most frequent first. Ignore groups whose latest version is older than main's stamped version unless they still occur.
2. **Diagnose** the top groups from 1-2 example runs (`debug.form` against `debug.answers` and `debug.dropdowns`): no answer in the kit/profile is a data gap, not code; a dropdown with no matching option is `matchOption`; an answer the field did not take needs real input; an unrecognised field type is `__jobPilottoDescribeForm`.
3. **Read the open fill-failure issues** (`gh issue list -R GarryOne/jobadabra-lab --label fill-failure --state open`): one issue per field a real fill
   left (site, question, cause, extension build, scrubbed snapshot); the only source that names the field on sites the pool lacks (triage of 20 Oct 2026: 5 of 7 real ones).
   `node tools/fill-fixture.mjs <n> --repo GarryOne/jobadabra-lab` makes a replay fixture, or says "record the site" when the snapshot cannot show the field
   (a dropdown whose choices load from the site): that site is yours to record. A fixture that is red on main goes to `fix-recorded-sites`.
4. **Hand the shape on:** a "Blind spot" platform needs a **recording of the failing shape** (re-record on this signal, bounded by the site limit) and a recorded page; the fix is `fix-recorded-sites`. Fixtures are public: only a scrubbed snapshot or public form structure (`worker/test/fill-replay.test.js` rejects emails, URLs, phone-like numbers). Never make the extension click Submit or change what counts as a consent box.

## Open threads to carry (10 Oct 2026; drop each when closed)
- Discovery is serial (~90 s a candidate, ~45 min per 30) because the whole smoke holds the one heavy lock (not because of Notion or ports: each run already has its own). A `--workers` option is not built: it needs a second lock slot or workers inside one locked process, only when free memory covers two runs (measure first; two runs also double the `claude -p` page-kind calls on the owner's plan), and one shared results object so the report and the upload do not race.
- Ask the owner: a `prestart` that prints npm's error on failure; renaming the Jobs "Closed" counter; multi-step AI answers for account recorded cases.
- Chanel's Workday dialog has a fourth option, "Autofill with Resume", with no route in the page-kind answers (`desktop/lib/page-kind.js` `ROUTES`); the run still reached the form. Decide with the owner whether it needs a route.

## Traps found while building the pool (each cost time)
- Never run the twin or a long run from a worktree you ship from: shipping rebases it (and a `ship.sh` without keep-by-default removes it).
- The guard hook misreads `>`, `=` and `$VAR` paths in commands run from the primary checkout: run from a worktree, with literal paths.
- A negative-only recorded case must watch its whole window; count tabs OPENED, not left. A "gone: <selector>" check on an element that starts hidden is true before anything happens: assert an outcome (a field filled).
- The live harness's stall dump is capped (12 buttons): a missing button in it is not evidence; look at the frames, and check the frames folder belongs to YOUR run (the next site overwrites it).
- A removed worktree's results are dropped by the Stop hook (fixed); a name that already exists in `desktop/e2e` (`lib/replay.mjs`) was overwritten once: grep before naming a file.

- The `/admin/lab-form-filling` pool count changes only when a run ENDS (`sendPool` at the end of smoke or discover); the Mac's own list changes at once. A half-finished run shows nothing there.
- Never `git checkout` in the primary checkout: other sessions and uncommitted changes live there. Work in your own worktree.

## When a row must be captured again (12 Oct 2026)
A row capture (the pool's candidate, on this Mac: `~/Library/Application Support/Job Pilotto QA/replay-candidates/<day>/<row>/`, never in the repo) is only as good as the build and applicant that made it.
- **Capture again** (one held run: `RECORD_KEEP_CANDIDATES=1 JP_NO_REPORT=1 npm run record-sites -- --only "<row>"`, heavy-lock class proof, fake applicant, never Submit) when: the capture predates the offline app's full applicant (9f6ff67, 11 Oct 17:07 +02) or the live row's contact fix (6b857a6): its form-answer asks miss; or the prompt of an AI ask changed (the answers prompt: 34b349d 16:50 and 279556b 17:28 +02) and your fix does not need that change.
- **What refuses a stale one:** `npm run row` says STALE (before the replay format); a cold ask says "run again with --ask-cold"
  (the new build's own model asks, once on the plan path, kept in the case); a replay whose memo misses names the differing parts ("system:1:profile (lines 30-37 of 36)": `lib/ai/model-memo.js`).
- **No case is cut from a capture** (`row-to-case` dropped, owner 15 Oct 2026): a fix's proof is a ladder fixture (a decision) or a hand-made recorded page (a field or control).
- A site that asks for removal gets its case deleted.

## Stop conditions
- The heavy lock is held by a peer, or a peer asks for your slot back: stop your own run by PID and say so.
- A run shows the isolation assertion failing, or lines in the live app's log: stop everything, say what was reached, fix the isolation first.
- Two rounds in a row with the same shape failing for the same reason: stop re-running, write what is known and hand it to `/fix-recorded-sites`; do not loop the pool to see it again.
- The owner says stop.

## Pool life cycle
Rows have a stage (New, Needs a fix, Working, Fixed, Daily watch, Archived). Archived rows are never re-run (only `--only` names one); `desktop/e2e/archive-pool-rows.mjs` lists candidates (dry run; `--write` archives). Details: docs/rules/apply-flow-workflow.md "Pool life cycle".

## Daily watch list
Rows with `"stage": "watch"` in `smoke-sites.json` are recorded live every day by `watch-live.yml` ($25 a month, one Telegram message only when a flow got worse than its last live run). To add a platform: add its row with `"stage": "watch"` in a PR (a test account goes in the `POOL_TEST_ACCOUNTS` secret, never in the repo). Details: docs/rules/apply-flow-workflow.md "Daily watch list".
