# LinkedIn jobs on every Find jobs, headless: plan

Spec: [2026-10-31-linkedin-headless-design.md](../specs/2026-10-31-linkedin-headless-design.md). Tier 2 (engine + extension + store writes of a credential): tests first, named test files only locally, CI runs the suites.

> **Verdict:** 3 PRs, each useful alone and off by default. Nothing reads LinkedIn before PR 2; nothing visible ships before the owner's yes on the sketch.

## What is reused (checked 31 Oct 2026)
- Owned browser: `desktop/lib/background-browser.js` (headless, own profile, own extension copy). `hosted/ready-fill/extension-copy.mjs` gives that copy `https://*/*` host access and the same `background.js`, so a tab marked `#jp-read-<ticket>` is read by `extension/visit.js` in it with no new reader (`extension/background.js:132`).
- Run + ingest: `desktop/lib/visits.js` `runAll(sites, {openTab, ...})` already takes an injectable opener, per-site wait, quiet/site timeouts, states (`siteLine`), Stop (`signal`) and `remember()` into `src/sources/visits.py`.
- Searches: `src/sources/visits_portals.py` `portals()` builds the LinkedIn URL from strategy roles and places (only the first role/place today; PR 2 takes up to 3).
- Secrets: `desktop/lib/keychain.js` (isolated file under e2e/twin: never the owner's Keychain).
- Extension consent patterns: `extension/options.js:23` (optional `cookies` toggle), `extension/allow.js` (`permissions.request`).

## PR 1/3 Session: switch, three doors, consent, cookie copy
- Setting `linkedinJobs` = `{on, asked, declined}` (not `linkedin`: the profile import's) (one owner: `desktop/lib/linkedin-session.js`; the dialog's verdict is the only writer of `asked`/`declined`).
- Cookie copy: extension asks `permissions.request({origins: ['https://www.linkedin.com/*'], permissions: ['cookies']})` inside its own consent UI, reads only `li_at` and `JSESSIONID`, posts them over the authenticated loopback; app stores in Keychain `job-pilotto.linkedin-jobs.session`. Turning the switch off: item deleted, `permissions.remove`.
- UI: Settings → Connections row, Find jobs ask (1st/2nd press while off, "Not now" twice = never), Suggestions entry while off, ⌘K "Turn on LinkedIn jobs". One consent dialog behind all three.
- Tests first: Keychain round trip (isolated, never `security`), only-allow-listed cookie names/host, value never in logs (scan), off deletes, ask counters (1st, 2nd, never after On or two declines), registry/palette, class tests (card-system NOT_A_CARD, text-fields-allowed, input type, renderer class tests). Run the whole desktop lint.
- Gate: Chrome Web Store text reviewed with the extension change; manifest keeps `cookies` and `https://*/*` optional only.

## PR 2/3 Reader: the LinkedIn step inside Find jobs
- `desktop/lib/linkedin-headless.js`: if `on` and a session exists and the runtime is downloaded: start the owned browser, `Storage.setCookies` (CDP, loopback-verified like `browserCommand`), `runAll(searches, {openTab: cdpOpen, signal})`, then `Storage.clearCookies` for linkedin.com in a `finally` (Stop, error, deadline).
- Searches: ≤ 3 from the strategy (AI-judged lists), ≤ 3 pages each; pause 2–5 s; deadline = the rest of Find jobs' one deadline; what is skipped is said.
- States from the spec table, one writer (the step's result); login/checkpoint/401/403/429 end it, no retry, 429 skip a day. Page-kind judgments stay AI calls (`src/ai/decide.py`).
- Guard test: `browserArguments` has no user-agent override or stealth flag.
- E2E on fixtures: `linkedin.com` host-mapped to a local server (guest list, login page, checkpoint, 429), fake cookie `FAKE-LI-AT`; Find jobs with the switch off makes no request; Stop closes the tab and clears cookies; value scan of logs.
- Time: the step is not an engine stage (`tests/test_three_minutes.py` counts those): `lib/search-beside.js` ends it at 170 s of the press's 180 (test/search-beside.test.js).

### Design (PR 2/3, 31 Oct 2026, read from the code that exists)
- **Reused as is:** the owned browser's extension worker imports the same `background.js` and its manifest gets `https://*/*` (`hosted/ready-fill/extension-copy.mjs`), so a tab marked `#jp-read-<ticket>` is read by `extension/visit.js`, which posts `/extension/visit-done` with `blocked: 'login'|'check'` (the page kind it already judged). `visits.runAll` takes `openTab`, `signal`, `tee`, `siteMs`.
- **Small additions, nothing parallel (checked for an existing owner first: `git grep` in `desktop/lib`, not from memory):**
  1. `src/sources/visits_portals.py` `linkedin_searches(search, limit=3)` + `src.desktop linkedin-searches`: up to 3 LinkedIn search URLs from the strategy's own roles and first place (the lists are already AI-judged); `portals()` is unchanged.
  2. `lib/background-browser.js` `send(method, params)`: one CDP command on the verified browser socket (cookies, new tab, close tab).
  3. `lib/cdp-session.js` already is that client (`openCdpSession`: send/on/detach, loopback only, from the live view): reused, not rewritten. The tab opens as `about:blank`, the step attaches, enables `Network`, then `Page.navigate`s to the marked address, so the first main-document response is seen: 401/403/429/999 = `limited`. Nothing else reads statuses today.
  4. `visits.runAll` result keeps `blocked` (it drops it now), so `login` = `signed-out` and `check` = `check` come from the page kind the extension already judged, not from the words.
- **The step (`lib/linkedin-headless.js`, one writer of the state):** switch on + session in the Keychain + runtime downloaded → `Storage.setCookies` (the two cookies, `Secure`, `HttpOnly`) → `runAll(searches, {openTab: Target.createTarget, signal, atOnce: 1})` with a 2–5 s pause between searches → in a `finally` the same cookies are expired (`setCookies` with a past `expires`) and the tabs closed, whatever ended it (done, Stop, error, deadline). A state other than `done` ends the step with no retry; 429 writes `linkedinJobs.pausedUntil` (a day).
- **Where it runs:** beside the engine's search inside `searchOnce` (`lib/pipeline-tasks.js`), on the press's one deadline (`JOB_PILOTTO_SEARCH_AT`); it never delays the engine and says what it skipped. Its pages go to the store through the existing `remember`/ingest route and the existing light scoring run; the lines go to the search's own log, so Recent activity lists each read.
- **Guards:** no user-agent override or stealth flag in `browserArguments`; the cookie value never in a log line, a task row or the store (a scan of the step's output for the fixture's `FAKE-LI-AT`); switch off = no cookie call, no browser start (assert on the injected seams); Stop clears the cookies.
- **Order (tests first):** searches (Python) → `runAll` keeps `blocked` → `send`+`targetSocket` on the owned browser → the step with fakes for every state → the wiring in `searchOnce` → the e2e step on a host-mapped fixture (guest list, login, checkpoint, 429).

## PR 3/3 Rules and docs (the relaxation, in the owner's words)
- CLAUDE.md Safety line, `docs/rules/why.md:13`, `docs/rules/applying.md:53`; `extension/refused-read.js` NEVER list and `src/sources/refused_reads.py` stay (not this path), with a Why saying so.
- Decision Log row in Notion after landing (skill notion-map).

## After the PRs
- Owner's own signed-in try on local main (skill try-fix-in-local-main). A checkpoint = stop and ask; we never disguise.

## Progress
- [x] Spec drafted (proof: docs/superpowers/specs/2026-10-31-linkedin-headless-design.md)
- [x] Sketch rendered, light + dark (proof: none: images are in the PR body of 1/3, nothing committed)
- [ ] Owner's yes
- [ ] PR 1/3
- [ ] PR 2/3
- [ ] PR 3/3
- [ ] Owner's signed-in try
