---
name: fix-recorded-sites
description: Fix the applying flow's failing or low-reaching shapes one at a time, offline, from each site's recording. Take the top cause on /admin/form-filling/lab "Needs a fix", reproduce it by replaying the row's network record (no site visit, $0), say which part of the self-improving mechanism the fix improves, fix it for every site, add a recorded page that fails on the old build, land with tools/ship.sh, and read "Confirmed offline". Use when the owner says "fix recorded sites", "fix failing forms", "fix the pool's worst sites" or names a shape that stops early. Also for a page stopped at "posting"/"no-form", with no apply route, or classified wrong (the rung method).
---

# Fix recorded sites: one shape at a time, offline

Goal (owner, 9-14 Oct 2026): from the posting to a filled form, stopped before Submit, on any site; **never fix the same website twice**. Each site is recorded once
(skill `record-applying-sites`); every test, comparison and proof of a fix is an offline replay of that recording. A live visit is not part of this loop:
if the recording lacks the route your fix needs, ask `record-applying-sites` to record the journey further (spec `docs/superpowers/specs/2026-10-15-record-once.md`).
Detail moved to files here: [reproduce.md](reproduce.md) (decisions made, how to reproduce), [rung-method.md](rung-method.md) (a page judged wrong), [lessons.md](lessons.md) (read once at the start).

## 0. Pick the work (one line each to the owner)
- **The list is "Needs a fix" on `/admin/form-filling/lab`** (owner-only; Bearer = Keychain `job-pilotto.site.api_key`, memory `reference-owner-pages-access`; the same rows are in `?json`).
  Worst first: regressions, the earliest stop, the least filled form. A form reached with under half its asked fields filled is a **shortfall**. A code or bot check is a documented hold, not on the list.
- **Take a CAUSE, not a row** (owner, 11 Oct 2026; `docs/rules/rounds.md`): the **By cause** tab, or `~/jobadabra-web/tools/site-run.sh node jobs/needs-fix-causes.mjs --rows`. A row "Run first" (never recorded, or not since its fix) is the recorder's, not a fix.
  Weigh by demand (the scorecard's "Of matched jobs"); a "Blind spot" platform (real fills worse than the tests) goes first: its signal is in `record-applying-sites` "Reading real use".
- **Also the open fill-failure issues** (`gh issue list -R GarryOne/jobadabra-lab --label fill-failure --state open`; one per field a real fill left, with its build
  and snapshot): `node tools/fill-fixture.mjs <n> --repo GarryOne/jobadabra-lab` makes the replay fixture (red until fixed: your reproducer, it lands with the fix);
  "record the site" goes to `record-applying-sites`. The fix's commit says `Fixes GarryOne/jobadabra-lab#<n>`, so the issue closes when it merges.
- **Claim it:** `node tools/claim-shape.mjs claim "<row>" --session <your name> --alive <names ListAgents shows>` (exit 1 prints the holder: next row). Release it whenever you stop.
- **Replayable first (20 Oct 2026):** make each issue's fixture (`fill-fixture.mjs`) and look for its shape in the fetched records before anything else. An issue with no snapshot and no recording of its shape is **parked with a comment** ("not reproducible; reopen on a report that carries a snapshot"), never chased by recording other sites blind ([lessons.md](lessons.md) "A fix session's plan").
- **Ask the whole plan's approvals once, up front (20 Oct 2026):** each CI recording, memo refill or rule change the plan may need, in one list to the coordinator. A relay counts only with the owner's exact question and answer, and `gh workflow run` still needs his yes in this window.
- **Skip what is not a failure:** an email/told outcome (a correct hold), a site answering 5xx, a row already fixed on main (`git log origin/main --grep '<site>'`, `Pool-row:` trailers).
- **Worktree** `tools/worktree.sh fix-<shape>`, scratch `<scratchpad>/fix-recorded-sites/`, no subagents, say the tier (usually 2). One row per session; side work goes to a new session with a brief.
- **Claim the flow core only once the cause is proven**, never on a hypothesis: your open PR is the claim; read each file's `Invariants:` block first; changing one is the owner's call, said in the commit.
- **Never a live run for a fix.** Recording is `record-applying-sites`' job (3 live visits a host a day, the privacy tripwire, #754's "never typed" identity check). Only the owner lifts a limit.

## 1. Which kind of failure is it? (say it in one line before you start)
- **A rung problem:** the page was judged or climbed wrong ("stopped at the posting", "no-form", a wrong `page kind:` line, no apply route). Method: [rung-method.md](rung-method.md).
- **A field problem:** the form was reached, fields stayed unexplained ("form · N unexplained of M"): a field not filled, a control not operated, a question not read. Method: section 3.
- **A lost answer** (`page kind:` by structure rule, no confidence, under ~3 s): compare the extension's line with the app's line for the same request before touching a rung.
- **A stale row:** the row's `version` is older than main's (`node desktop/scripts/extension-stamp.mjs --at origin/main`), or a later recording reached further: check first.
- Both on one site: the rung first (the form is never reached otherwise), then the fields.

## 2. Reproduce offline (small, isolated, with a positive control)
1. **Read the evidence before any hypothesis:** write ASKED (the sketch), ANSWERED (`page kind:`, `digest:`), DONE (what was pressed, where the page went) from the row's evidence and `step-*.png`. Detail: [reproduce.md](reproduce.md).
2. **Replay the row's network record:** `cd desktop/e2e && node replay-net.mjs <record dir> <out dir>` (the site's own scripts and replies, the recording's kept AI answers; no site, no model call); fetch records with `net-records-fetch.sh`.
   - **A row the gate marks 🖥 "ask changed"** (your fix changed what the app asks; its first miss differs in a `user:*` part): fill the memo on the Mac, once per changed ask: `cd desktop/e2e && npm run fill-memo -- <records dir> "<row>"` (plan `claude -p` for the missed asks only, about $0.06 an ask, fake applicant, tripwire on; say the cost to cc first), then `node records-publish.mjs <full fetched set>` (it REPLACES the whole release: fetch it first, `--dry` first). The network record is never touched.
   Its numbers count only for a row whose replay is "same as live" (/admin/form-filling/lab "Replay vs live"); a row that is not: read the spec table "Why a row does not replay as live"
   (`docs/superpowers/specs/2026-10-13-replay-by-network.md`) first. It may be your build's regression (then the replay is your reproducer) or a recording out of date (then ask for a re-record).
3. **Prove the repro:** the SAME signature as the failure (the same `page kind:`/`ladder:` lines); the stub really called; the case FAILS on the old build (`REAL_EXTENSION_DIR=<old extension/>`). Debug with the network replay (step 2); `npm run row -- "<row>"` only for a row without a network record, and then as a differential only (owner, 15 Oct 2026).
4. **Time box:** 10 minutes on a probe, 30 on one proof step with no yes or no: stop, land what is tested, tell the coordinator.

## 3. Say what the fix is, then fix it (one block, before coding)
- **Which part of the self-improving mechanism it improves** (`docs/rules/applying.md`): an operator, the fingerprint, a meaning in the pack, a recipe (data), the page-kind AI's fixed answers, or noticing the miss. Prefer **data**; a code fix says why data could not.
- **Which decisions are AI, structure, floors** (CLAUDE.md "Judgments about a page are the AI's"): a heuristic becomes an AI field with a fixed answer the code validates.
- **The shape, not the site**; list the sibling shapes it helps and what it does not cover; a variant it cannot handle is listed, never skipped silently.
- **A field problem:** make a **recorded page** by hand from the shape, seen failing on the old build (`desktop/e2e/recorded/<shape>-<n>/`; AI answers taken from the real run, only to what the extension asked, never written to fit). **A wrong decision** (button, route, page kind, when to stop): a **ladder fixture** (`desktop/e2e/ladder-fixtures/`) is the proof. Cases cut from captures (`row-to-case`) are no longer made (owner, 15 Oct 2026: 0 landed, ~7 h of sessions in 48 h).
  `cd desktop/e2e && npm run recorded` on the old build (`REAL_EXTENSION_DIR`) must fail, then pass on the fix; write `control: {build, failed}` into its case.json (or `{guard}`). An app-side fix cannot fail a page on the old build: its control is a unit test failing first.
  Fix the root cause for the whole class, every sibling in the same change; files ≤ 500 lines; `npm run real-extension` after a filling fix; a journey scenario when the flow's logic changes.
- **A rung problem:** the fixture first, the lowest rung that has the information, data before code, 3 of 3 real asks, trailers `Rung:`/`Fixture:` ([rung-method.md](rung-method.md)).

## 4. Land and confirm (all offline)
- Commit trailer `Pool-row: <the row's exact pool name>` (it fills the Fixed tab; the commit hook suggests the closest). A push changing how the extension acts on pages needs the recorded page (or `Recorded-unneeded: <why>` only when no real site's failure is fixed).
- `tools/ship.sh --background [--title="<the whole PR>" if 2+ commits] --body=<file>` (never from the twin's worktree); the PR guards your fix with the **page case** you froze from the replay (it must fail on the old build; **every bug a replay finds ends as a page case**). No replay runs on the PR (owner, 17 Oct 2026); the daily `site-replays.yml` then shows "Confirmed offline": **your row reaches further and no "same as live" row drops.**
- **A before/after over many rows is CI's** (owner, 15 Oct 2026): `gh workflow run site-replays.yml --ref <branch>` and `--ref main`, both at once (~14 min on 5 runners, $0); compare the two runs' rows. On the Mac replay only the 1-3 rows the fix is about (`JP_REPLAY_ONLY`); `replay-records.mjs` refuses more outside CI (`lib/wide-local.mjs`).
- **"Confirmed offline"** on the Fixed tab (after merge, from the row's recording, 2 agreeing replays) closes a fix; a "regression" row is read through its "Our build" / "Site changed" verdict first. Until then say "landed, unconfirmed", never "done".
- Report one line per shape: shape, mechanism part, reached before → after, commit **on origin/main**, siblings helped.

## Stop conditions
- Release your claim on any stop. Reached the form or a documented hold (code, captcha, bot check, login wall, 401/403/429): stop, never get past them.
- Two fix rounds without reaching further: write what is known and hand the shape back. A red row that is a stated rule (a consent, a Submit, "Easy Apply"): do not change the rule; ask the owner.
- A route the recording lacks: ask `record-applying-sites` for the full journey; never visit the site. The owner says stop.

## Never
- Accept your own drop. Never accept your own drop: a row that fell because of your fix is the owner's call. Show the owner the daily replay's field-by-field diff (the job log of "CI · Site replays · all (offline)") and wait; the owner labels the PR `replay-accepted` and comments the `Replay-accept:` line. A hook blocks posting it; `REPLAY_ACCEPT_OK=1` only when the owner asked for exactly that accept in this chat.
- Submit, a consent, an account button, a captcha or SMS code; the owner's live app, profile, CV, Keychain or paid AI; a fix named after one website.
- A recorded case whose expected result or AI answer was written to fit the fix. A long foreground wait (background + `Monitor`). A fix built on a guess (lessons.md).
- Silently fixing a gap in the debugging process (a missing log, a report that hides evidence): list it and send it to the coordinator.

## Lessons (owner, 11 Oct 2026)
Every round that teaches something puts it in `lessons.md` (rule first, then incident, verified or second-hand) before you say "done"; promote it into this file only when it changes what to do first. Keep SKILL.md under 150 lines.
