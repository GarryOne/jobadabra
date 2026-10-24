# Notion later: try without Notion, connect it to track

Status: approved by the owner 3 Oct 2026 · plan written by Opus 5.5 · to be implemented by Sonnet 5.5.

## 1. Decision (do not re-open)

- **Notion stays the one home of user data.** The rule "one copy, Notion is the source of truth, the Mac keeps keys,
  large files and caches" does not change for anything that is *tracked*.
- **What changes:** Notion is no longer a required wizard step. It moves to **Optional extras**. A user who skipped it
  can **try** the product: search, fit scores, the Jobs list, Strategy. The first time they **track** anything (⭐ Save,
  Dismiss, Prepare, Apply, Applied elsewhere, Add job, Log anything, interviews, Focus, Gmail, Telegram, Always on), the
  app asks them to connect Notion (one click, OAuth with the template) and then does what they asked.
- **Rejected:** (a) a full local store until Always on, (b) an hourly or daily Notion sync. Both mean two editable
  copies: the drift class removed on 28 Sep 2026.
- **Always on does not move data.** It changes only *where* runs happen (GitHub or this Mac); both use the same Notion.
  Turning it on or off never copies anything between SQLite and Notion.
- Why: Stage 1's exit is installs → weekly active users. The Marketing page already says "First value in <10 min:
  CV in → 10 matches… Notion, Telegram, Always on later". The code contradicted it.

## 2. Rules for the implementer (read before you start)

1. Work in a worktree: `tools/worktree.sh notion-later`. Copy this spec into it (it is uncommitted in the primary
   checkout) and commit it with commit 1. Never edit the primary checkout.
2. Read `CLAUDE.md`, `CODEMAP.md` and the skill `.claude/skills/desktop-change/SKILL.md` first. For UI, read
   `.claude/skills/ui-look-and-feel/SKILL.md`.
3. No subagents. Read narrowly (grep, then read ranges).
4. Tests first for each behaviour below; watch them fail for the right reason. "Done" = all three suites green as CI
   runs them: `JOB_PILOTTO_DISABLE=mail,notion,telegram,google_jobs python3 -m unittest discover -s tests`,
   `cd worker && npm test`, `cd desktop && npm test`.
5. Commit subjects ≤ 72 characters, imperative, no reasons in the subject (the pre-push hook enforces it).
6. **Users who already have Notion connected must see zero change.** Every new branch is `if (!notionGate.connected(storage))`.
   If you find yourself changing a Notion-connected code path, stop and re-read this spec.
7. Push after each commit that is green (`git fetch && git rebase origin/main && git push origin notion-later:main`).
   Commits 1–4 are unreachable until commit 5 removes the wizard gate, so pushing them early is safe. Never force-push.
   After each push: `git -C ~/job-pilotto pull --ff-only` (check that it doesn't overlap uncommitted work there first).
8. No AI spend: nothing in this change may start an AI call that didn't run before. The post-connect sync (§5 C3)
   runs with `--score-max 0 --enrich-max 0 --auto-kit-max 0`.
9. Don't build one-off repair code for the owner's data. The migration step in §5 C3 is product code (every
   "try first" user needs it).

## 3. The three states

| State | Condition | Window opens on |
|---|---|---|
| **Setup** | `!settings.setupDone` | the wizard (current step) |
| **Trying** (new) | `setupDone && !connected` | the app, **Jobs** view |
| **Connected** | `setupDone && connected` | the app, Focus (unchanged) |

`connected(storage)` = `!!storage.secret('NOTION_TOKEN') && !!storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID`.
It's one function, used everywhere (§5 C1). Don't write the check inline again.

### What works in Trying

| Works (local) | Asks for Notion (gate) |
|---|---|
| Search now / scheduled searches on this Mac | ⭐ Save, Dismiss, Prepare (kit), Apply, Apply with Claude |
| Fit scores (engine reads `profile.md` via `JOB_PILOTTO_PROFILE_FILE`) | Applied elsewhere, Add job by URL, Recruiter message, Log anything |
| Jobs list (from SQLite: `src/desktop.py jobs()` with `notion_jobs=None`, already works) | Focus view, Applying view, Interviews view, Calendar view |
| Strategy view (search terms, places, rebuild from CV) | Profile → contact details and answers editing |
| Wizard rebuild / "Replace my strategy" (local save) | Settings: Always on, Telegram, Gmail and Calendar |
| CV upload, Chrome extension install, Google Jobs key | Daily target on Focus |
| Recent activity (local `runs.json`; `runHistory.list` already returns `null` without a token) | |

**Dismiss is gated too** (decided): there are no local-only job statuses. If it were allowed, a SQLite-only status
would have to be migrated, and that's the second copy we refuse to build.

### Data in Trying (the only local "user data", and it is temporary)

| File | Content | Becomes |
|---|---|---|
| `profile.md` | the drafted Profile **including** the `## 📇 Contact details` section (`contact.markdown(merged)`) | Notion Profile page |
| `answers.md` | the drafted standard answers | Notion Application Answers page |
| `config/search.json`, `config/preferences.json` | already the cache of ⚙️ Search settings | ⚙️ Search settings page |
| `data/jobs.sqlite` | crawl + scores (a cache, as today) | Job Matches rows via the normal hash-based sync |
| `cv.pdf` | the CV | Profile "📎 CV" via `files.syncCv` (already idempotent, runs at start) |

Nothing else is written locally in Trying. If you need another local file, the feature belongs behind the gate.

## 4. User-facing words (use exactly; owner tone: short, direct, no hype)

- **Extras card** (first card in Optional extras, `is-wide`, icon `database`):
  title **Notion** · line *"Track applications, kits and interviews in your own free Notion workspace. Needed to
  save jobs, apply, and for Always on, Telegram and Gmail."* · button **Connect with Notion** (primary when not
  connected; when connected: "Connected ✓" + secondary **Manage** → Settings → Notion).
- **Why connect: the advantages** (owner, 3 Oct 2026: "clearly describe the advantages"). One list, defined once
  (`NOTION_BENEFITS` in `renderer/pages/notion-connect.js`) and shown in the dialog, the view gate card and Settings →
  Connections → Notion. The extras card shows the first three. Icons from the existing icon set; each line is an
  icon + a bold lead + a few words:
  1. ☁️ **Safe in your own cloud**: free, and it survives a lost or reset computer.
  2. 📱 **On every device**: check and update your applications from your phone.
  3. 🔍 **See everything the app knows**: every job, fit reason, kit and answer, readable and editable. No technical
     skills needed.
  4. 🛟 **Easy help**: when something looks wrong, you can see why right in Notion, and share just that page if you want help. (We never see a user's Notion.)
  5. 🔓 **Unlocks more**: saving jobs, kits, applying, interviews, Focus, Always on, Telegram buttons, Gmail checks.
  6. 🔒 **Yours**: in your own workspace, never on our servers; export it or leave any time.
  Don't add claims beyond these. "Survives a lost computer" is true for tracked data, not for keys or recordings, so
  don't widen it.
- **Gate dialog** (`<dialog id="notion-connect-dialog">`):
  title **Keep track in your Notion** ·
  reason line first (from the action) e.g. *"Connect Notion to save this job."* ·
  the benefits list above ·
  footnote *"One click with Notion's own sign-in. Your strategy and matches move there too; nothing is kept twice."* ·
  buttons **Connect with Notion** (primary) · **Not now** (secondary) ·
  after an OAuth failure, a link line: *"Or paste a token: Settings → Connections → Notion."*
- **"Not now" asks why, in one tap, optional** (chips under the buttons once Not now is clicked, then the dialog
  closes; closing without a chip is fine): *I don't use Notion* · *Privacy* · *Later* · *Something else*. Keys:
  `no_notion`, `privacy`, `later`, `other`. No free text (it would be user words in telemetry).
- Reason lines (key → text): `save` "to save this job" · `dismiss` "to hide jobs you don't want" · `prepare` "to draft
  an application kit" · `apply` "to apply and keep the record" · `applied` "to track an application" · `add` "to add a
  job" · `lead` "to track a recruiter lead" · `log` "to log this message" · `interviews` "to keep interview transcripts"
  · `focus` "to see what to do next" · `cloud` "for Always on" · `telegram` "for Telegram buttons" · `gmail` "for Gmail
  checks" · `profile` "to edit your details and answers". Sentence = "Connect Notion " + reason + ".".
- **View gate card** (Focus, Applying, Interviews, Calendar in Trying): the same title, body and button as the dialog,
  in a `card` with the view's reason, built by one component (`notionGate(reasonKey)` in `components.js`, added to
  `gallery.js`).
- **Connect progress** reuses the wizard's existing messages (`onNotionProgress`), plus one new line while the
  migration runs: *"Moving your strategy and matches into Notion…"*
- **Existing workspace kept** (migration found a Notion workspace that already has a Profile): toast *"Your Notion
  already had a Profile, so it was kept. This Mac's version is saved in <folder>."*
- Welcome checklist: remove the line "Set up your Jobadabra workspace in Notion (free)". Step eyebrows become
  "Step N of 4". The privacy line in `steps-foot` becomes *"Your data stays in your accounts: this Mac, and your Notion
  when you connect it. Keys are encrypted in your Keychain."*

## 5. Work, as commits (in this order)

### C1 · `desktop/lib/notion-gate.js` + one result shape

- New file (one-line purpose comment at the top; run `node desktop/scripts/codemap.mjs`):
  ```js
  export const connected = storage => !!storage.secret('NOTION_TOKEN') && !!storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID;
  export const REASONS = {save: 'to save this job', /* … all keys from §4 … */};
  export const needs = reason => ({ok: false, needsNotion: true, reason, text: `Connect Notion ${REASONS[reason]}.`});
  ```
- In `desktop/main.js`, replace every existing "Connect Notion first…" return with `notionGate.needs('<key>')`:
  `importJob` (~L762, `add`), `addApplied` (~L767, `applied`), `leadCheck` (~L841, `lead`), `saveStrategy` (handled in
  C2, **not** a gate). Find the rest with `grep -n "Connect Notion first\|NOTION_TOKEN')) return" desktop/main.js desktop/lib/*.js`.
- Add a guard at the top of each handler that would otherwise fail deep in Notion code: `setStatus` (`save`/`dismiss`
  by status), the kit/prepare handler (~L1319, `prepare`), `apply` (~L1121, `apply`; keep `allowanceBlock()` first),
  the Log-anything/inbox handlers (`log`), interview save/relink handlers (`interviews`), `focus*` handlers (`focus`),
  `saveContact` and questions handlers (`profile`), `setDailyTarget` (`focus`), `cloudConnect` (~L694, `cloud`), the
  Telegram connect handler (`telegram`), `googleConnect` (`gmail`). In DEMO mode keep the current behaviour (guards go
  after the `if (DEMO)` lines).
- `lib/questions.js` currently throws "Connect Notion first" (tested in `desktop/test/app.test.js:332-333`). Leave the
  throw: it's a library contract. Only the IPC layer converts it.
- Tests: `desktop/test/notion-gate.test.js`: `connected` for the 4 combinations of token and profile id; `needs` shape
  and text for every key (every key in `REASONS` has a sentence).
- Log (AGENTS.md logging rule): when a guard returns `needs`, `appLog('notion', 'gate', {reason})`. Area `notion`.

### C2 · Local strategy in Trying

- `desktop/lib/strategy.js`
  - `profileTexts(storage)`: if `!connected` → `{profile: storage.readText('profile.md') || '', answers: storage.readText('answers.md') || ''}`;
    else unchanged. **Do not** throw any more when not connected. Check every caller (`grep -rn profileTexts desktop`):
    `rebuildImpact`, migrate's `profile copies` step (only runs when connected, fine) and the Profile page handler.
  - New `saveLocal(storage, {profile, answers}, {backup = false} = {})`: when `backup` and a file exists, copy
    `profile.md`/`answers.md` to `backup/strategy-<YYYYMMDD-HHmm>/` first; then write both with mode 0o600 (use
    `storage.writeText`; check that it exists and what mode it uses).
- `desktop/main.js` `saveStrategy` (L608–650): replace the early return at L611–613 with a branch:
  ```js
  if (!notionGate.connected(storage)) {
    // Trying (no Notion yet): the strategy is kept on this Mac until Notion is connected (lib/migrate.js moves it).
    strategy.save(storage, {search: …same as below…, preferences: …same as below…});
    step('local', {finished: true});
    const profile = draft.profile_markdown.trim() + (contact section built exactly as L632–634, with `known` = {} );
    strategy.saveLocal(storage, {profile: take('profile') ? profile : null, answers: take('answers') ? draft.answers_markdown : null},
      {backup: !!storage.settings().setupDone});
    for (const name of ['profile', 'answers', 'search']) step(name, {finished: true});
    setupDone + trackSetup exactly as L645; return {ok: true};
  }
  ```
  Extract the shared pieces (preferences with `daily_applications_target`, contact merge) into small local functions,
  so both branches use the same code. `saveLocal` must accept `null` for "leave that file as it is".
  The renderer's save window (`SAVE_STEPS` in `wizard.js`) needs no change: every step reports finished.
- `desktop/lib/pipeline.js` env (L72–76): after secrets, add
  ```js
  // Trying (no Notion yet): the engine reads the Profile and standard answers from this Mac (src/paths.py local_text).
  if (!notionGate.connected(storage)) for (const [variable, name] of [['JOB_PILOTTO_PROFILE_FILE', 'profile.md'], ['JOB_PILOTTO_ANSWERS_FILE', 'answers.md']])
    if (fs.existsSync(storage.path(name))) env[variable] = storage.path(name);
  ```
  and fix the comment "(Notion is required)". Never set these when connected: `local_profile()` would win over Notion.
- `main.js` `state` handler L435: `hasProfile` = `setupDone && (notionIds.NOTION_PROFILE_PAGE_ID || profile.md exists)`.
- Tests:
  - update `desktop/test/app.test.js:36`: connected → `JOB_PILOTTO_PROFILE_FILE` undefined (keep); add: not connected +
    `profile.md` present → set to that path; not connected + no file → undefined.
  - `profileTexts` local branch; `saveLocal` writes, backs up on replace, leaves a file alone on `null`.
  - Python: `tests/` already covers `local_profile()` in `daily.py`; add one test if `ANSWERS_FILE` has none
    (`grep -rn ANSWERS_FILE tests`).

### C3 · Moving in on connect (`desktop/lib/migrate.js` + `connectNotion`)

**Fresh vs existing workspace** (decides who wins):
- *Fresh* = `connectWorkspace` returned `built` (the app built it from the schema) **or** `templateRoot` was set (Notion
  just copied the template during OAuth). Its Profile, Answers and ⚙️ Search settings pages are empty placeholders.
  **This Mac's strategy wins.**
- *Existing* = anything else (the user picked a page that already held a Jobadabra workspace). **Notion wins**
  (source of truth); this Mac's files are backed up, never written over Notion.
- In `connectNotion` (main.js L464), on `result.ok`, **before** calling migrate: if `profile.md` or `answers.md`
  exists, `storage.saveSettings({notionMoveIn: fresh ? 'fresh' : 'existing'})`. Persisting it makes a step that fails
  retry next start with the same answer.

**New migrate step** `{name: 'strategy from this Mac', …}` placed **right after `'workspace'`** in `STEPS` (it must run
before `'profile copies'`, which deletes local copies, and before `'search settings'`, which would link the empty
schema-built Search settings page and keep this Mac's search choices out of Notion):
```
if (!settings.notionMoveIn) return false;
if (settings.notionMoveIn === 'fresh') {
  profile.md   → notion.writePage(token, ids.NOTION_PROFILE_PAGE_ID, text)     (skip if no file)
  answers.md   → notion.writePage(token, ids.NOTION_ANSWERS_PAGE_ID, text)     (skip if no file)
  search       → strategy.publishSearchSettings(storage, {run, ensurePage, writePage})   (writes the cache to the page)
} else {
  copy profile.md / answers.md to backup/before-notion-<stamp>/ ; log the folder; tell the window (toast, §4)
}
strategy.dropLocalCopies(storage);           // only after every write above succeeded
storage.saveSettings({notionMoveIn: undefined});
return true;
```
- A throw anywhere leaves the files and the flag in place (the runner already catches and retries next start). Never
  call `dropLocalCopies` on a partial success.
- Check that `publishSearchSettings` overwrites an existing empty page (it takes `ids.NOTION_SEARCH_SETTINGS_PAGE` when
  set). If it skips when the page exists, add an `{overwrite: true}` option rather than deleting the page.
- `connectNotion`: change `migrate.run(storage, log)` to `await migrate.run(...)` and send
  `toWindow('notionProgress', {moving: true, titles})` before it. Handle `moving` in the progress listener (§4 line).
  Then call `syncCv()`. Then start the no-AI Job Matches sync below. Return `{...result, titles, kept: backupFolder|null}`.
- **Job Matches for the jobs scored before Notion:** after a successful connect, run once (don't await it in the
  connect result) through the normal run path, so it gets a ⏱️ Search runs row and shows in Recent activity:
  `python -m src daily --mode today --score-max 0 --enrich-max 0 --auto-kit-max 0 --log-run`.
  Verify in `src/daily.py` that `today` reaches `matches.sync` (L629: modes `scheduled|run|today`) and that it doesn't
  crawl. `matches.sync` is hash-keyed over every scored job in SQLite, so all earlier scores land in Notion with no
  extra code. Expect ~1 request per job at ~3/s (the pacer handles 429s). Skip this when Always on is on (the cloud
  owns runs; its next scheduled run syncs).
- Log: `appLog('notion', 'connected', {from, fresh, moved: [...steps], kept: !!backup})`. `from` is passed by the
  renderer: `wizard`, `gate:<reason>`, `settings`.
- Telemetry: one `setup` report `{step: 'notion_connected', from, minutes}` (minutes since first start, like
  `setupFunnel.track`). The website ignores unknown steps today (`site/src/telemetry.js`), so check that and add
  `notion_connected` there as a counted event, not a funnel column.
- Tests (`desktop/test/migrate.test.js`, fake fetcher like the existing tests):
  1. fresh: both pages written with the files' text, Search settings published, local files gone, flag cleared;
  2. existing: nothing written to Notion, backup folder holds both files, local files gone, flag cleared;
  3. fresh, the answers write fails: profile written, **both** local files still there, flag still set; the next
     run finishes the job;
  4. no flag: step returns false and touches nothing (already-connected users);
  5. step order: `'strategy from this Mac'` comes before `'profile copies'` and `'search settings'`.

### C4 · Connect from anywhere + the gates in the window

- New `desktop/renderer/pages/notion-connect.js`: `openNotionConnect({reason, from, then})`. It opens the dialog (§4)
  and runs `window.pilot.notionOAuth({from})`. It shows progress with the same texts as the wizard (move the listener
  code out of `wizard.js` into this module; the wizard imports it). On `ok`: `shared.state = await window.pilot.state()`,
  close, toast "Connected ✓", then `then?.()` (retry the action the user asked for). On failure: the error, plus the
  token link line. `notionOAuth` in main.js accepts `{from}` and passes it to `connectNotion` for the log.
- One helper for every IPC result: `if (result?.needsNotion) return openNotionConnect({reason: result.reason, from: `gate:${result.reason}`, then: retry})`.
  Put it in `pages/core.js` as `gated(result, retry)` and use it at each call site whose handler got a guard in C1.
  Prefer checking the result over checking state before the call: one source of truth (main), and Telegram/cloud
  callers get the same answer.
- Views: `focus`, `sessions` (Applying), `interviews`, `calendar` render `notionGate(reason)` instead of loading when
  `!shared.state.notion`. Don't hide nav items: a visible gate is the prompt. Profile view: the CV part works; contact
  details and answers show the gate card.
- Settings → Connections: `desktop/renderer/pages/settings.js` L60 `notion` entry: `required: false`, why
  *"Where your applications, kits and interviews are kept. Needed for Always on, Telegram and Gmail."* Always on,
  Telegram and Gmail "Turn on" buttons open the dialog first when not connected (their main handlers also return `needs`).
- Null-safety: 10 uses of `shared.state.notion` outside the wizard (`profile.js`, `strategy.js`, `startup.js`): make each
  safe for `null` (hide "Open in Notion" links, don't build URLs). `grep -rn "state\.notion" desktop/renderer`.
- Background loops in `main.js` that read Notion (Focus reminders ~L1911, interview reminders, Gmail schedule,
  Telegram polling, the view-cache warmers): guard each with `notionGate.connected(storage)`. Log the skip **once per
  start** (`appLog('notion', 'loop skipped: not connected', {loop})`), not every tick. Find them:
  `grep -n "setInterval\|setTimeout(" desktop/main.js` and check what each calls.
- After a successful connect, start these loops without a restart (they are started at app ready; re-run that start
  function or the relevant part).
- Tests: `components` gallery entry; `gated()` calls `openNotionConnect` on `needsNotion` and passes through otherwise;
  `npm run shot -- jobs` and `-- focus` in a Trying fixture (see `desktop/test` helpers for a storage with
  `setupDone: true` and no token). Look at both pictures before saying done.

- **Tracking who refuses Notion** (owner, 3 Oct 2026). This is the data that decides whether a local tracking store
  (rejected option "everything local until Always on") is ever worth building.
  - Every time the dialog or a view gate card is shown, one event with an outcome:
    `{step: 'notion_gate', reason, where: 'dialog'|'view'|'extras'|'settings', outcome, why?, minutes, shown}`.
    `outcome`: `connected` · `not_now` · `closed` (Esc/backdrop) · `failed` (OAuth error) · `viewed` (view card shown,
    no click: send at most once per view per start). `why`: the chip key, only with `not_now`. `shown`: how many times
    this install has seen the prompt (a counter in settings, `notionGateShown`). `minutes`: since first start.
  - Send it through the same opt-in path as the setup funnel: `telemetry.record('setup', …)` when reports are on, and
    `track('notion_gate', {reason, outcome, why})` for the product analytics. Nothing else: no job, no URL, no words.
    Renderer → main via a new IPC `notionGateEvent(payload)`; main validates every field against fixed lists (unknown
    value → dropped) before recording.
  - `appLog('notion', 'gate', {reason, outcome, why})` too, so a user's own log answers "why did it keep asking me?".
  - Website: count `notion_gate` reports on `/stats` (`site/src/telemetry.js` and the stats page): per reason, the
    connect rate (`connected / shown`), the `not_now` reasons, and installs that hit the gate 3+ times without
    connecting. Read how `setup` reports are stored and charted first, and follow that. Add a site test.
  - **Revisit trigger** (write it on the stats card and in the Decision Log row): over at least 30 installs that saw
    the prompt, if **more than 40%** never connect **and** `no_notion` is the top reason, re-open the local-tracking
    option.
  - Tests: the payload validator (unknown reason/outcome/why dropped, `why` only with `not_now`), the `shown` counter,
    and that no event is sent when reports are off.

### C5 · Wizard and start-up (this commit makes Trying reachable)

- `desktop/renderer/pages/core.js` STEPS → `['welcome', 'ai', 'cv', 'draft', 'extras']`. Keep
  `desktop/lib/setup-funnel.js` STEPS identical (there's a comment saying so) and its tests.
- `wizard.js`: every `goStep('notion')` → `goStep('cv')` (L101, 112, 118, 131, 133, 146). Delete the Notion step's
  handlers and `showNotionNext`/`notionReady` once `notion-connect.js` owns the flow. In `index.html`, delete the
  `.step[data-step="notion"]` block and its `#step-list` `<li>`. Add the extras card (§4) as the first card, with
  `from: 'wizard'`.
- `startup.js` L28–46:
  ```js
  if (shared.state.settings.setupDone) { show($('app')); loadJobs(); …remembered view…, else openView(shared.state.notion ? 'focus' : 'jobs'); }
  else { …wizard…; const resume = saved === 'notion' ? 'cv' : saved || 'welcome'; … }
  ```
  An install that stopped on the old Notion step resumes at `cv`. Remove the `setupDone ? 'notion'` resume.
- Website funnel: `site/src/telemetry.js` `SETUP_STEPS`: read how it is used before you change it. Old app versions
  still send `notion`. The funnel must count both old and new reports, so don't renumber in a way that breaks old
  rows (prefer step names over indexes). Keep `REASONS.notion` ("I don't use Notion") in `setup-funnel.js`: it's still
  a valid answer to "Leaving setup?", and now a useful signal.
- `finishSetup` (strategy-review.js L385) is unchanged: the first search starts and runs locally.
- e2e: `desktop/e2e/suites/wizard.mjs` now goes key → CV → strategy → extras → finish **without** Notion, checks that
  the Jobs list fills, then connects from the extras card (own token `E2E_NOTION_TOKEN_*`, never the shared wizard
  page; see the e2e memory notes) and checks: Profile page text = the local profile, Search settings has headings,
  `profile.md` gone, a Job Matches row per scored job. If the suite has no own token yet, add a secret
  `E2E_NOTION_TOKEN_WIZARD` and ask the owner to create the connection. Don't run it on a shared page.
- Tests: startup routing for the three states; resume from `wizardStep: 'notion'` → `cv`; setup-funnel steps.

### C6 · Rules and docs (same day, after C5 is pushed)

- `CLAUDE.md` → "Data ownership": replace the bullet "Notion is required in the Desktop App (decided 28 Sep 2026)…"
  with:
  > Notion is required to **track** (decided 3 Oct 2026, replacing "required at setup"): the setup finishes without
  > it, and a set-up app without Notion is in **Trying**: search, fit scores, the Jobs list and Strategy only. Every
  > tracking action returns `notionGate.needs(reason)` and the window asks to connect. The only user data on the
  > Mac in Trying is `profile.md`, `answers.md` and the search config cache; `lib/migrate.js` "strategy from this
  > Mac" moves them in at connect and deletes them. No other local copies; a new feature that stores user data goes
  > behind the gate. Always on never moves data (it changes where runs happen, not where data lives).
  Also fix the "Apply with Claude … and Notion connected" wording only if it's now wrong (it isn't: still needs Notion).
- `AGENTS.md` in the repo, if it repeats the rule: same text. `README.md` Quick start: Notion becomes an optional step.
  `docs/ARCHITECTURE.md`: one line on Trying.
- Notion (via MCP, at the end): Technical Reference "Data ownership" (replace the toggle "Product decision
  (recommended, not yet done): make Notion required" with the new rule), Decision Log (one row: "Notion later",
  3 Oct 2026, link to this spec), Run Log entry, Session Handoff "Current state". The Marketing page needs no change
  (it already says "Notion later").

## 6. Edge cases (each needs a test or a stated reason why not)

| Case | Expected |
|---|---|
| Already connected before this change | No visible change. No `notionMoveIn` flag, the new step returns false. |
| Trying user clicks ⭐, connects, OAuth succeeds | Strategy moves in, the save retries and succeeds, the job shows ⭐. |
| Trying user clicks ⭐, closes the dialog | Nothing changes. No local status written. |
| Connect succeeds, the move-in step fails (429 storm, network) | Connect reports ok, files and flag stay, retry next start. Profile reads come from **Notion** now (connected), which may be empty until the retry: show "Moving your strategy into Notion… (retrying)" on the Strategy view while the flag is set. |
| User connects a workspace that already has their old data | Notion wins; local backup; toast with the folder. |
| Trying user runs "Replace my strategy" | `saveLocal` with backup; no Notion call. |
| Trying user turns on Always on | Gate first. After connect, the normal Always on flow. Secrets copied include `NOTION_TOKEN` (unchanged). |
| Always on turned off later, or on/off repeatedly | Nothing is copied. Both modes read and write Notion; SQLite is a cache. |
| Telegram bot set up in Trying | Gated: buttons write Notion. |
| Demo mode / Look around | Unchanged (demo state has its own fake Notion ids). |
| Reset ("Reset Jobadabra on this computer") in Trying | Deletes local files as today; nothing in Notion to touch. |
| Export in Trying | The export includes `profile.md`/`answers.md` (check `reset.exportTo` copies the whole folder; add them if not). |
| Terminal runs (`src/paths.py follow_app`) in Trying | They follow the app's folders. With no Notion ids, the engine uses the profile file only if the env var is set: the terminal user sets `JOB_PILOTTO_PROFILE_FILE` themselves. Document it in one line; no code. |

## 7. Not in scope

- Any local tracking store, hourly or daily sync, or "Disconnect Notion".
- Changing what Always on, Telegram or Gmail do once connected.
- Pricing or allowance changes. The allowance counts applications, and applications need Notion.

## 8. How the owner checks it (in the PR/commit body of C5)

1. Fresh install (`Reset` → wizard): key → CV → strategy → extras → **Go to my jobs** without Notion: matches appear
   with fit scores.
2. ⭐ a job → dialog → Connect → the job is saved; Notion Profile/Answers/Search settings contain the wizard's strategy;
   Job Matches has the scored jobs; Recent activity shows the no-AI sync run.
3. `grep notion ~/Library/Application\ Support/Job\ Pilotto/logs/app.log | tail` shows `gate`, `connected` with `from`.
4. Click **Not now** → pick a chip → `/stats` shows one `notion_gate` with `not_now` and that reason (reports on).
5. The dialog, the gate card and Settings → Notion show the same six benefits.
