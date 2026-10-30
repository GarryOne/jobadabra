# Capture once, measure many: pool measurements without live visits

> ✅ **Verdict:** every live pool visit keeps its whole journey; one command re-measures any build on saved journeys, offline, $0, unlimited.
> Live visits stay for a row's first capture and a change's final proof. The per-site limit is unchanged; no proxy, no rotation, no override.

- **Why:** 13 Oct 2026, 10 paid dispatches refused in one night by the per-site limit: every measuring run (dead-end acting batch, fill-ladder's
  measuring run, before/after of a fix) re-visited the same hosts. Owner: "This is not sustainable. I want us to not be blocked."
- **Owner:** session job-pilotto-capture, coordinator job-pilotto-cc.

## What exists (git history, read 13 Oct 2026)

| Piece | State |
|---|---|
| Whole-journey capture (`lib/capture-journey.mjs`, every page/frame/state, CSS, model answers, presses) | ✅ since 11 Oct (speed-5x, e68d362, c0932ab) |
| Offline replay of one row / a day (`npm run row/rows`, `lib/row-replay.mjs`), memo-only by default ($0) | ✅ since 11 Oct (2e9fa3f, 78e3fcd) |
| Captures kept for **every** row | ❌ failing rows only (`worthSaving`); passing rows only with `SMOKE_KEEP_CANDIDATES=1` |
| CI keeps captures | ❌ `SMOKE_CANDIDATES` is written on the runner and **not uploaded**; only app.log, ai-calls, pictures |
| Tables on a replay (`lib/pool-shadow.mjs`, `lib/pool-acted.mjs`, ending, fill numbers) | ❌ they read live report folders only |
| A positive control (replay on the capturing build = the live numbers) | ❌ only per-row evidence lines (speed-5x trust check, 3 rows) |

So the gap is three things: keep every capture, keep CI's, and a `measure` command whose output is a report folder of the **same shape**
the tables already read (`<day>.json` + `<row>.app.log`), so `lib/pool-shadow.mjs`, `lib/pool-acted.mjs`, `pool-endings` and fill counts can analyze it unchanged.

## Design

1. **Keep every row's capture** (smoke.mjs, Mac and CI): `saveCandidate(..., always: true)` into a captures library, beside today's
   failing-only candidates (unchanged, fix-recorded-sites reads them). Each capture also records the build that made it (commit, extension version),
   the run's result row (reached / filled / left / usd / ending) and its app.log: the positive control's "live" side.
   - Mac: `<QA folder>/captures/<day>/<row>/` (outside the repo, as today).
   - CI: an artifact `pool-captures-<run id>` (see **Owner decision 1**).
2. **Pull CI captures to the Mac library:** `npm run captures -- pull [--days 7]` (gh run download of the `pool-captures-*` artifacts into
   `<QA folder>/captures/`; idempotent, by run id). `npm run captures -- list` shows rows × days × build.
3. **`npm run measure -- [--days N | --run <id> | <capture dirs>] [--old <ext dir>] [--ask]`:** replays each capture with the CURRENT build
   (`replayRows`, 4 tabs, one browser), turns each replay's app log into the live run's output shape (as `lib/bare-capture.mjs` does) and
   `parseLive`s it, then writes `<out>/<day>.json` + `<out>/<day>-<row>.app.log`. Then prints, from that folder, the same tables:
   shadow (agree / would_act / worse), acted (worked / failed / worse), endings per row, fill (filled / left / tries per control), AI asks
   (kept-answer hits, misses) and tokens per row.
   - **AI: memo-only by default** ($0): an ask the capture never made is counted as a miss, never answered. `--ask` answers misses through the
     plan's `claude -p` (Mac only, the identity tripwire on, $0 on the plan). CI never asks: no paid call from `measure`, ever, without the owner.
   - **Memo-only measures "same decisions, new code"** (cc, 13 Oct 2026): every NEW AI question a build adds (a silent ask, a picture climb) is a
     miss offline and is listed by route, never guessed. `--ask` spends the owner's Claude plan quota ($0 money, not free of limits): it is capped
     (`--ask-max`, default 20 asks a run) and the count is printed.
   - **`--compare`:** the captures' own live tables beside the replay's, row by row, with each difference named (the positive control).
4. **Nothing reaches a site:** an address the capture never recorded is a 404 and a counted "route not recorded" (as `npm run row` today).

### What a replay can and cannot measure (said up front)

| Measure | Offline? |
|---|---|
| Page kind, every judge's answer, shadow question (agree / would act / worse) | ✅ decision on the recorded page |
| Fill: which fields read, filled, left, tries per control, tokens | ✅ on recorded forms |
| Endings | ✅ where the run follows recorded states |
| **Effect** of a press the capturing run never made (acted "worked") | ❌ the page after it was never seen: counted "unseen", needs one live proof |

**A prompt or schema change makes its rows "not measured" offline** until a live visit (or a capped plan-path re-ask: `--ask`, in the
gaps file) refreshes their captures. **Code-only changes are fully measurable.** (cc + owner, 13 Oct 2026)

The acting batch's **effect** column therefore still needs live visits, but only for doors whose press is new; the rest of its numbers
(how many it would press, where, at what cost) come offline. Every live visit (a measuring run's, a proof's) also refreshes that row's capture, so the library follows site changes (cc, 13 Oct 2026);
`measure` uses each row's newest capture unless `--days` asks for more.

### Safeguards: offline numbers never pass for live ones (owner via cc, 13 Oct 2026; a test each in PR 2)

| # | Rule |
|---|---|
| 1 | Every line `measure` prints is labelled **`offline (memo)`** or **`offline (plan)`**; an offline and a live number never share a table (`--compare` prints two tables side by side, each labelled). |
| 2 | **Any miss = not measured** (changed 13 Oct 2026 from "over 10 % of asks": HelloFresh's ONE missed page-kind ask of 16 took the fill from 5 to 1). The row names the step and the differing part; the top line counts the reasons (`page kind: use differs x4`), so a prompt change shows at once. |
| 3 | A press no capture saw is **"unseen"**, never "worked" or "failed". |
| 4 | **A fix is "proven" only by a live run** (Pool-row / live-proof, as today). Offline numbers decide what to try, never what is done (this spec + skills fix-recorded-sites, record-applying-sites). |
| 5 | **Gate:** until the positive control (PR 3) passes, every `measure` output carries **"unverified"**. |

## Owner decisions (13 Oct 2026)

- ✅ **1 → A:** a 30-day `pool-captures-<run>` artifact, pulled to the Mac library.
- ✅ **2 → 30 days** on the Mac, older days pruned.

<details><summary>The options as asked</summary>


1. **Where CI captures live.** They are scrubbed (structure, no values, fake applicant, no owner identity: CI uses the API key, not `claude -p`)
   and today's public artifact already holds the same rows' app.log, AI calls and step pictures. Options:
   - **A (recommended):** a `pool-captures-<run>` artifact, retention 30 days, pulled to the Mac library for keeps. No new store, no new secret.
   - B: pushed to the private `job-pilotto-internal` repo (a deploy key secret; durable, unreadable to the public).
   - C: Cloudflare R2 behind the narrow key (durable, new code on the worker).
2. **Library retention on the Mac:** keep 30 days of captures (~5-17 MB a row; ~3 rows a CI run) — or keep all.

</details>

## Success measure

- **Positive control:** `npm run measure -- --compare` on the CI captures of one pool batch, on the build that captured them, gives the same
  per-row ending and the same shadow / acted / fill tables as the live run. Target: identical aggregate tables; per row ≥ 9 of 10 identical,
  each difference named (row-to-case showed real-page interleaving can differ: see memory project-row-to-case-state).
- **The point:** the dead-end acting table (minus the effect column of new presses) and fill-ladder's measuring numbers re-computed for a new build
  on yesterday's captures with **0 live visits, $0**, in minutes.

## PRs (2-3)

1. **Keep every capture** (smoke.mjs + pool-smoke.yml artifact + build stamp + result row in the capture); test: a passing row keeps its capture.
2. **`npm run measure`** (+ `captures pull/list`), reusing `replayRows` (lib/row-replay.mjs) and `parseLive` (lib/smoke.mjs) as they are, no second replayer: replay → report folder of the live shape → the existing tables; tests on a fixture capture
   (a fake site, memo-only) that measure writes the same `<day>.json` keys the tables read, and that a miss is counted, never asked.
3. **Positive control** on one CI batch, numbers in this spec; skill steps (fix-recorded-sites, record-applying-sites, fill-ladder's
   measuring) say "measure offline first, one live visit for the proof".

## Progress
- [x] Owner decisions 1 (artifact, 30 days) and 2 (30 days on the Mac) (proof: none: the owner's answers in session job-pilotto-capture, 13 Oct 2026)
- [x] Spec approved by cc (13 Oct 2026, + notes: new asks are misses, --ask capped; live visits refresh) (proof: none: cc's message to job-pilotto-capture, 13 Oct 2026)
- [x] PR 1: every live row keeps its capture (Mac + CI artifact), build stamp, result row, #601 (proof: desktop/e2e/test/capture-library.test.mjs)
- [x] PR 2: `npm run measure` + `captures pull/list`, the tables on a replay folder, safeguards 1-3 + 5 with a test each, #603 (proof: desktop/e2e/test/measure.test.mjs)
- [ ] PR 3: positive control on one CI batch (numbers here) lifts "unverified"; skills: measure first, live proves (safeguard 4)
  - [x] Control run 1, 13 Oct 2026, CI run 38382905555 (artifact `pool-captures-38382905555`, build 97d37ab, ext 0.9.457), replayed on 97d37ab: FAILED. Lever not measured (a page-kind ask missed); Personio offline data_missing 5/8 vs live ready 7/7 (proof: none: numbers above, logs in session job-pilotto-capture)
  - [x] Causes found (proof: desktop/test/kept-answer-client.test.js)
  - [x] Control run 2, 13 Oct 2026, #612's live proof of Personio (run 38385564241, grown applicant, live 12 filled / 2 left): the capture keeps the form answer (5 kept answers, was 4). Replayed as thin, 2 of 4 asks hit; as its own applicant (grown), **3 of 4 (75 %)**: the one miss is the account judgment after the CV upload (cause 4). Not measured, so "unverified" stays (proof: desktop/e2e/test/measure.test.mjs @e7ae589)
  - [x] Each capture replays with its recorded run settings (applicant, model, engine, store); a missing one = not measured, #617 (proof: desktop/e2e/test/measure.test.mjs @5836747)
  - [x] Cause 4's reach (CI pool runs to 13 Oct 2026, 73 row visits with an AI ask): **17 of 39 distinct rows (35 of 73 visits) upload a CV, and all ask the AI after it** (the form answer and the account judgment). Until cause 4 is fixed, whole-row numbers are measurable offline on at most 22 of 39 rows (proof: none: counted from the CI runs' app logs in session job-pilotto-capture)
  - [ ] Causes 3-4 and the replay's next step (network record + the site's own scripts, or per-action snapshots): session job-pilotto-replay-design, Discussion #615

### Control run 1: causes (13 Oct 2026)

| # | Cause | Fix |
|---|---|---|
| 1 | Side by side, a row's log keeps only lines naming its host; the app's miss lines name none, so misses went uncounted (Personio: 2 alone, 0 side by side) | PR 3: `measure` replays one row at a time |
| 2 | **CI captures never kept the form answers**: on the API key the worker asks with its own client, outside the memo (desktop/lib/server-env.js `aiClient` is set only for Claude Code / OpenAI / Codex) | PR 3: under the e2e memo only, the API key's client is wrapped by it (`keptAnswerClient`) |
| 3 | Platform layout: CI live is Linux Chrome (15 px scrollbar), the replay a Mac (overlay scrollbar): Lever's page-kind sketch frame width 1185 vs 1200, so the ask misses | Gaps file: record the scrollbar width, force it in the replay |
| 4 | The page's own state after an upload ("×" remove button) is not replayed: the account-judge sketch differs | Gaps file |

So, until 3-4 are fixed: **a CI capture measured on a Mac is trusted only on rows where every ask hit**; a Linux-only layout difference shows as "not measured", never as a wrong number.
