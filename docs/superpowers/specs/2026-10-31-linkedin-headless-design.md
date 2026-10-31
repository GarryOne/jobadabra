# LinkedIn jobs on every Find jobs, headless

> **Verdict:** opt-in switch in Settings → Connections → LinkedIn. On: every Find jobs also reads the person's LinkedIn job searches in the app's own hidden browser, using their LinkedIn session copied from Chrome by the extension. Off (default): nothing changes.
> **Status:** draft for the owner's yes (31 Oct 2026, session `li`). Feasibility of a **signed-in** read is unmeasured (see Risks).

## Problem
- Today LinkedIn is read only in a visible tab of the person's own Chrome after they press "Find jobs using your browser" (`desktop/lib/visits.js`, `extension/visit.js`). The engine never fetches LinkedIn; `extension/refused-read.js:16` blocks it.
- Most people search on LinkedIn first. A Find jobs that leaves it out misses the biggest board unless they remember the extra press, and that press takes over a Chrome window.

## Owner's decisions (31 Oct 2026, exact words)
- Request: "Every Find jobs, if the user is logged in via Linkedin Jobs, should search and scrape jobs, using the user's login" … "but headlessly".
- How: "First option will focus the window. Right? I'd like to avoid this. Therefore, I'd go for option 2" → **the app's own headless browser, with the person's LinkedIn session copied from Chrome by the extension.** Not a hidden window in their Chrome, not LinkedIn's private API.
- Consent: "Opt-in, warned once" → off by default; one switch with one warning line.
- Signed-in proof (31 Oct): "My own try, local main". Build behind the off-by-default switch, then the owner turns it on once in their own app; a checkpoint stops us (disguise stays the owner's decision). No test touches their session.
- Web Store (31 Oct): "Accept, fallback desktop-only". If review rejects the cookie read, the path moves to the desktop-bundled extension build.
- Where the person finds the switch (owner, 31 Oct): "When the user presses Find jobs for the first, or for the second time, we should popup and ask about this." / "And/or it should be in the Suggestions card" / "Somewhere to easily found by the user".
- This relaxes, on purpose: CLAUDE.md Safety ("go past a login wall (LinkedIn …): only through the user's own visit"), `docs/rules/why.md:13`, `docs/rules/applying.md:53` (26 Oct: "shouldn't start automatically in the background").

## Behaviour
**One read per Find jobs, only when the switch is on and a session exists.**
1. The extension (in the person's Chrome) copies the LinkedIn session cookies to the app **when the switch is turned on and at each Find jobs while on** (refresh), over the existing authenticated loopback. It never reads them otherwise.
2. The app keeps them **only in the Keychain** (`job-pilotto.linkedin.session`; e2e: the isolated-secrets file, `lib/keychain.js`).
3. At the LinkedIn step the app starts the owned headless browser (`lib/background-browser.js`, reused, no second browser), sets the cookies in it for the read, opens the searches, and **removes the cookies from the browser's profile when the step ends** (so the profile never keeps a credential between runs).
4. The owned browser's extension reads each list page exactly like today (`extension/visit.js`: AI-judged cards, follow pages, stop at login wall or check) and sends it to the app; `src/sources/visits.py` ingests; scoring and filters are the normal path.
5. Searches come from the current strategy (roles × places, AI-judged: `tests/test_sources_follow_strategy.py`), at most **3 searches × 3 pages**, 2–5 s between pages, within the Find jobs deadline (`tests/test_three_minutes.py`); what did not fit is reported ("LinkedIn: read 2 of 3 searches, ran out of time").
6. Every search is a row in Recent activity; **Stop ends it** (tab closed, cookies removed).

### Where the person turns it on (three doors, one consent)
| Door | When | Action |
|---|---|---|
| Settings → Connections → LinkedIn | always | the switch + the one warning line |
| Ask on Find jobs | the 1st and 2nd Find jobs press while off and never asked twice before | one dialog: warning line, **On** / **Not now**. "Not now" twice = never asks again (the other doors stay) |
| Suggestions card | while off (and not on LinkedIn-less strategies, see non-goals) | entry "Also search LinkedIn, in the background" with one click that opens the same consent |
All three open **one consent** (the dialog); On requests the two optional permissions in the extension, whose own UI shows the consent text (Web Store rule), then copies the session. Each is in the ⌘K palette ("Turn on LinkedIn jobs"). One owner of "asked N times / answered": a small setting `linkedin.asked` (0-2) and `linkedin.declined` (0-2), changed only by the dialog's verdict.

### States (one owner: the LinkedIn step's result, written once per run)
| State | When | Card says |
|---|---|---|
| `off` | switch off (default) | nothing; no cookie access, no browser |
| `no-session` | on, no LinkedIn cookies found in Chrome | "LinkedIn: sign in to LinkedIn in Chrome, then press Find jobs" |
| `reading` | on, step running | "LinkedIn: reading search 2 of 3" |
| `done` | step finished | "LinkedIn: N jobs read" (or "none new") |
| `signed-out` | owned browser lands on a login page | "LinkedIn: sign in again in Chrome" (no retry this run) |
| `check` | checkpoint / verification / bot-check page | "LinkedIn asked for a check" (no retry, not solved) |
| `limited` | 401/403/429 | "LinkedIn asked us to slow down"; 429 = skip for a day, others for this run |
| `no-browser` | background browser not downloaded | "Download Jobadabra's browser (one time)" with progress and Cancel (existing add-on) |

Verdicts that change state: page kind judged by the AI (`src/ai/decide.py`), HTTP status, Stop, deadline. Nothing else.

## Safety (all of CLAUDE.md Safety still holds)
- Never solves a captcha or check, never uses an SMS code, never types a password; a login page or checkpoint ends LinkedIn for the run.
- **Never disguises the browser**: honest user agent (measured: `HeadlessChrome/156`, `navigator.webdriver=false`), no stealth plugin, no UA/fingerprint override. If a signed-in read needs disguise to work, **stop: new owner decision**.
- The copied session is a credential: Keychain only; never in logs, telemetry, the store, Notion or an upload; deleted when the switch goes off or on sign-out; refreshed only while on; removed from the owned profile at the end of each step.
- Pace: ≤ 9 pages per run, waits between pages, one LinkedIn step per Find jobs. Warning shown once, in the switch's own row: "LinkedIn may limit accounts it thinks are automated; we read slowly and only your job searches."
- Tests never use the owner's LinkedIn session or Chrome profile (see Test plan).
- `extension/refused-read.js` NEVER list and `src/sources/refused_reads.py` are **not touched**: this is not the refused-read path.

## Chrome Web Store (public listing is one of the five goals)
- Policy facts (developer.chrome.com/docs/webstore/user_data, 31 Oct 2026): authentication cookies are sensitive user data; disclosure is required even when data stays on the device; prominent disclosure and consent must be in the extension's own UI; collection only for a user-facing feature; "narrowest permissions". Extension ↔ native program on the same machine is exempt from the secure-transport rule only. Not stated: whether a local companion app counts as a "transfer".
- Design to stay inside: optional permissions only (`cookies` and `https://www.linkedin.com/*` requested at runtime when the switch goes on, removed when off; `extension/options.js:23` already toggles `cookies`); consent text shown in the extension UI before the first copy; read only the session cookies LinkedIn needs; send only over the loopback.
- **Residual risk:** a reviewer may reject "reads another site's auth cookie". Fallback: this path ships in the desktop-only extension build, not the Web Store one. Owner to accept.

## Acceptance criteria
0. The ask dialog appears on the 1st and 2nd Find jobs press while off, never after On or after "Not now" twice; the Suggestions entry shows while off and disappears on On; all three doors open the same consent; "Turn on LinkedIn jobs" is in ⌘K (class tests: card-system NOT_A_CARD, text-fields-allowed, input type, palette registry).
1. Switch off (default): no cookie read, no browser start, no LinkedIn request (assert).
2. Switch on + session + browser: one Find jobs reads ≤ 3 searches, jobs appear in the normal results with `source=linkedin`; Recent activity lists each read; Stop ends it within 5 s.
3. Each non-`done` state above is reached by a fixture and shows its words; none retries.
4. Cookies: absent from logs, `app.log`, store, telemetry (assert by scanning a run's output for the fixture's cookie value); absent from the owned profile after the step; Keychain item deleted when the switch goes off.
5. The step respects the Find jobs deadline and says what it skipped.
6. No user-agent override or stealth flag in `browserArguments` (guard test).
7. Every mode touched (Find jobs, "Find jobs using your browser", background apply sharing the owned browser) still passes its own test; the owned browser is shared, not duplicated.

## Test plan
- Unit: cookie filter (only the allow-listed names/host), Keychain round trip (isolated), state verdicts, search selection from strategy, deadline cut.
- E2E on the fixture server (no real LinkedIn): host-map `linkedin.com` to a local server (the existing `JOB_PILOTTO_E2E_BACKGROUND_BROWSER_ARGS` host map) serving a guest list page, a login page, a checkpoint page, a 429; fake cookie value `FAKE-LI-AT`.
- Real LinkedIn: **logged-out** probe only (done once, 31 Oct: 60 cards, no wall). Signed-in proof = the owner's own try on local main (skill try-fix-in-local-main), or a test account the owner provides. Never the owner's cookies in a test, probe or CI job.

## Non-goals
- LinkedIn's private/Voyager API; any login, password, 2FA or SMS handling; auto-apply on LinkedIn (Easy Apply); messaging, profile or feed reads; more than one LinkedIn step per Find jobs; other login-wall sites (Indeed, Glassdoor, levels.fyi, Reddit, Xing stay as they are).
- Parked, not built: per-search tuning UI, scheduling LinkedIn outside Find jobs.

## Risks
| Risk | Status |
|---|---|
| LinkedIn flags a copied session used from a headless browser (different fingerprint) → checkpoint or logout | **Unmeasured.** First signed-in try = owner's own on local main, switch on. A checkpoint ends the run cleanly; if it happens every time, the design needs an owner decision (we do not disguise). |
| LinkedIn restricts the account for automation | Accepted by the owner ("Opt-in, warned once"); pace and warning line keep it small, not zero. Existing note: `src/sources/visits_portals.py:16`. |
| Web Store review rejects the cookie read | Fallback: desktop-only extension build. |
| Guest page measured fine, signed-in page differs | Card recipe/AI judge reads whatever list arrives; unreadable page = `check`/unknown, never a guess. |

## Progress
- [x] Feasibility: honest headless loads the public search (31 Oct 2026)
- [x] Chrome Web Store policy read (31 Oct 2026)
- [x] Owner's answers: signed-in proof on local main; Web Store fallback desktop-only; three doors (31 Oct 2026)
- [ ] Owner's yes on spec + sketch
- [ ] PR 1/3 Session: switch, ask dialog, Suggestions entry, ⌘K, consent, cookie copy → Keychain, delete on off (no reading yet)
- [ ] PR 2/3 Reader: owned-browser LinkedIn step inside Find jobs, states, e2e on fixtures
- [ ] PR 3/3 Rules and docs: CLAUDE.md, why.md, applying.md, Decision Log row
- [ ] Owner's signed-in try on local main
