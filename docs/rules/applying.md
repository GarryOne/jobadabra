# Applying: the extension, Claude's takeover, the flows and the flow core

Read before touching anything in the applying flow (`extension/`, `desktop/lib/*flow*`, `FLOW_CORE`/`FLOW_FILES` in `desktop/e2e/flows.mjs`).
Linked from CLAUDE.md. Why each rule exists: [why.md](why.md#applying). The map of scenarios: [docs/flows/applying.md](../flows/applying.md);
the ladder: [docs/flows/ladder.md](../flows/ladder.md).

## Written questions are drafted, never left bare (owner, 16 Oct 2026; changes the 11 Oct "expected hold")
- An open question in the person's own words ("describe an incident you root-caused", "why us") gets a DRAFT from their facts only (CV, experience bank, LinkedIn export, saved answers, the posting for focus), in their voice. Thin facts: an outline of `• Add: ...` lines to complete. Never an invented employer, project, number or incident.
- It is typed and marked (`data-jobpilotto-draft`): the panel lists it "Drafted for you: review"; it counts as left (never "Ready to submit") until the person edits it or presses Keep as is; an outline until its Add lines are gone.
- "Review my answer" (`extension/panel-written.js`, `/extension/review-answer`) reads the person's text or the draft and offers one improved version; it types only on the person's "Use this version" press, and never over text that changed since the review.
- Guards: `worker/test/written-answer.test.js`, `worker/test/written-panel.test.js`, `desktop/test/written-draft.test.js`. Why: [why.md](why.md).

## The extension first (owner, 8 Oct 2026)
The plain **Apply** button (the Chrome extension alone) is the product, aimed at **non-technical users first**. Every step (posting → Apply →
account sign-up/sign-in → email confirmation → the form) is built for the extension to do end to end. A new capability goes into the extension's
flow first; "Claude can do it" is not a reason to skip it. **Apply with Claude** is the safety net, below.

## Claude finishes a stuck page (owner, 10 Oct 2026)
> **Off for now** (owner, 15 Oct 2026): the takeover below is hidden behind one flag (code kept). A stuck page points to the panel's footer "Report" (a popup on the panel that sends the recording, 19 Oct 2026) instead; no "Let Claude finish", no "Resume Claude", no countdown, and `claudeAuto` is ignored. The rest of this section describes it for when it is enabled again.

Spec: `docs/superpowers/specs/2026-10-10-claude-finishes-stuck-pages.md`. It replaces the 8 Oct "never started by itself" and the 9 Oct "hidden, off by default".
- Offered only when Claude is READY (`lib/claude-ready.js`, window twin `renderer/claude-help.js`): a Claude engine, Claude Code installed and signed
  in (Git on Windows). A non-technical user has no Claude Code, so never sees it.
- On the stuck page the panel (`extension/panel-claude.js`, its own classic script) and the session card (`renderer/claude-offer.js`) offer:
  Let Claude finish this page · I'll do it myself · ☐ Always let Claude finish when I'm stuck (`settings.claudeAuto`). The first press shows one
  consent line (Continue stores `settings.claudeConsent`).
- **How it starts:** the person's press, or, with "always" + "Do it for me", a visible 5-second countdown with Cancel. "Let me check each step"
  never counts down. A notice opens the card once per session.
- Floors: never Submit, never a captcha or SMS code; **at most one takeover per application** (`lib/take-over.js`, refused and logged).
- Claude teaches the extension (`lib/takeover-teach.js`): controls Claude filled that the extension had left are reported by fingerprint as failed
  outcomes without a recipe (counts only).
- New accounts get their own generated password per site (`passwords new`), and the session card records "Account created on X · terms
  accepted: '…' · code from your email" (`application-journey.js` invariant 6).
- Apply with Claude itself (the job row's ⋯ menu): `desktop/lib/apply.js` `claudeOne` → `desktop/lib/claude-session.js`, one
  `claude --chrome` session per job with the bundled `apply-to-job` skill. Passwords via `python3 -m src.ai.passwords` into the Keychain /
  Windows Credential Manager; confirmation emails via `python -m src.sources.google verify`. Never Submit.

## The assistant mode: "Do it for me" or "Let me check each step" (owner, 10 Oct 2026)
One choice (Settings → Profile → Application assistant, `renderer/assistant-mode.js`), stored as `settings.accountAutomation`, read only through
`automationOf` (`desktop/lib/site-accounts.js`).
- **full = "Do it for me", the DEFAULT**: on an account page the extension accepts the account's consent (as the account AI names it,
  `needs_kind: consent`, at most 3 presses per tab) and presses the account button; the confirmation link from the mail is opened, or its code
  typed into the box the account AI named, when Gmail is connected (the code is never logged; `lib/account-confirm.js`, `extension/account-fill.js`);
  the closer look (`lib/escalate.js`) runs on an unclear account page (a screenshot, typed values hidden, at most 10 a day).
- **assist = "Let me check each step"**: it fills; the person does the consent, the button and the codes; no closer look.
- Never in either: an application's Submit, a captcha or bot check, an SMS code, a choice on the application form that no saved base fact answers (below).
- **One exception: consent and data-notice boxes** (owner, 17 Oct 2026: "the app should tick them by default because it's a formality. The setting should be enabled by default.
  It should be auto. Only on explicit disablement from the settings the user will need to tick them manually."). Settings → Consent boxes ("Tick consent and data-notice boxes for me"),
  ON unless the person turned it off; the extension asks the app on every fill (`/extension/me` → `acceptConsents`). The AI's reading decides which box is one (category `legal`,
  any language); an unread or rejected control stays for the person (27 Oct 2026 consent-control rule below), and a statement of fact about the person (certify, affirm, attest) is never ticked.
  Off: the page panel's "Tick these for me". Everything else on this line stays: never Submit, never a choice no base fact answers. Guard: `desktop/test/consent-tick.test.js`.
- **Equivalent consent menus use that same setting** (owner, 27 Oct 2026: the Consent boxes switch was visibly on but an applicant privacy-policy dropdown stayed empty). The existing form-answer call reads legal controls too: category `consent` means an unambiguous agreement, distinct from personal facts and attestations. A validated high-confidence reading becomes a gated legal kind, never an ordinary answer. Native selects take only the exact offered affirmative option; custom menus ask the existing option-pick seam about the actual list with a fixed `{agreement, choice}` reply. No shortcut from one option, English words or a remembered ordinary answer. Off leaves controls unchanged. Rejected consent readings stay for the person, including in the checkbox pass. Required counts and traces read the settled control after the pick. Guards: `worker/test/consent-floor.test.js`, `worker/test/consent-flow.test.js`, `desktop/e2e/test/consent-controls.test.mjs`, `desktop/test/consent-transport.test.js`.
- **One exception to "401/403/429 is a no": refused sites read in the person's browser** (owner, 19 Oct 2026: "we don't want to crawl job boards, many requests a day, but rather employer sites, once... we can state clearly in the app (have a settings), in the privacy" / "if he's accepting this, then let's do"; boards added by him the same day). **Only from the person's press** (owner, 26 Oct 2026: "shouldn't start automatically in the backgruond. It should be suggested to the user as an action button"; "there should be a button on the card where the "find jobs" finished"; "I don't think we should have a switch at all"): a finished Find jobs run counts the due sites (`lib/refused-offer.js`) and its card offers **Find jobs using your browser** (`renderer/pages/browser-offer.js`, also ⌘K); the press (`lib/refused-now.js`, the one gate; no Settings switch, no timer, no Check for new jobs or job-open trigger) is seen by the extension's one-minute look, which then (`extension/refused-read.js`) reads each site that refused the engine up one ladder, one at a time with a pause, public https pages only; never LinkedIn, Indeed, Glassdoor, levels.fyi, Reddit, Xing or a login page (checked in the extension, in `src/sources/refused_reads.py`, and on the page it landed on):
  1. the engine's own request; 2. a Chrome download, `credentials: 'omit'` (no cookies, no logins); 3. a **real tab** (owner, 20 Oct 2026, `extension/refused-tab.js`): one minimized **incognito** window (no cookie or login of the person: it opens only if Chrome allows the extension in incognito AND the window reports `incognito: true`, else nothing is loaded; Focus says to switch on "Allow in Incognito"), 5 sites a day at most, up to 15 s for a passive check to clear BY ITSELF, no click, no typing, never focused. The app's AI says what the page is (`refused_state.page_state`: page | passive_check | captcha | login | refused; status and login address are floors).
  **A passive check may clear by itself in a real tab; a captcha is solved by the user, never by us** (owner, 20 Oct 2026). A captcha in a background read stops and is offered in the app as "needs a quick check from you" (the site stays in the list of sites only you can open); the check stays in the tab's hidden incognito window (`extension/refused-held.js`, 10 minutes, never focused by us) and only the person's press of "Show the check" (Focus) brings it forward, after which the solved page is read (owner, 21 Oct 2026: tabs stay hidden, informed only on a captcha); while applying, the panel says "This site wants a quick check: solve it, then I'll continue" (`BOT_CHECK_NEED`) and fills once the form shows. A refusal, a login page or a check that does not clear is a stop. A press skips a site (each install's own clock) for 7 days after any step opened it, 30 after every step stopped, 1 day on a 429; the step that worked is remembered and shared (`browser_read` `step`, `route`: `valid_route`) so other installs start there.
  The page goes to the engine like a page the person opened (`visits_read.read`); each pass is one Recent activity row with a line per site. Guards: `tests/test_refused_reads.py`, `tests/test_refused_state.py`, `desktop/test/refused-reads.test.js`, `desktop/test/refused-reads-button.test.js`, `desktop/test/extension-refused-read.test.js`, `desktop/test/extension-refused-tab.test.js`, `desktop/e2e/test/refused-tab-guard.test.mjs`.
- **A choice a base fact answers is filled from the Profile** (owner, 17 Oct 2026: "Why 'A choice (visa, relocation, demographic, any knockout)' is left for me?
  We should have this information in the Profile, as a standard/base."). Visa, permit, relocation, residence, salutation and other knockout choices: the AI maps the
  saved fact to one of the form's own options, in its language (`use: fill` with the fact it rests on); the code validates it (the value is a listed option; a
  country passes in any language by the standard country names, `worker/src/country-names.js`). An unsure match stays proposed and goes to Answer once;
  demographics are filled from the answer given once; a choice no fact covers is left; a certification or attestation stays the person's; never Submit.
  **A declaration of fact is not legal** (owner, 20 Oct 2026: "The demographic questions should be filled by extension. This is not something sensible. It's reducing the user's time waste on the form filling"; a public-official, criminal-record or accommodation question is category `knockout`: filled from a saved answer, else left so the app asks once and keeps it; `legal` is only a consent, terms, a privacy notice or a certification). Guard: `worker/test/declaration-rule.test.js`.
  **A legal-looking choice is asked once** (owner, 20 Oct 2026, #40, "Ask once, remember"): a question the AI calls `legal` that the form answers with options (a select, radio group or dropdown) is treated as `knockout` by the field's type (`legalChoice`, `worker/src/answer-declarations.js`): typed from a saved answer, otherwise left so the app asks once and keeps it; only a single "I agree / I certify" tick (checkbox) or typed text stays the person's. Guard: `worker/test/legal-choice.test.js`.
  Guard: `worker/test/choice-from-fact.test.js`.
- **A search menu is searched, then its catch-all is chosen** (owner, 27 Oct 2026, fair round form 102, Greenhouse School: "search, then Other"): a menu that searches as
  you type may open on only the start of its list. When no choice shown means the answer, the AI names what to type (the answer's own name, then the list's own catch-all);
  the extension types each for real and the AI picks among what it found. The catch-all ("Other") is picked only after the answer itself was searched and not found.
  Code: `desktop/lib/option-pick.js` (searchable), `extension/page/fill-menus.js` searchFor. Guards: `desktop/test/option-pick.test.js`, recorded page `education-menus-first-page-1`.
- Changing what a mode does or its default is the owner's call, with a Decision Log entry.

## A form bug is fixed in the self-improving mechanism, for every install (owner, 8 Oct 2026)
- A field, control or upload slot a form leaves unfilled is never fixed "for that website". Say first which part of the mechanism it improves:
  a generic operator (`extension/page/controls.js`, `upload.js`), the fingerprint (`page/skeleton.js`), a meaning in the alias pack
  (`alias-schema.js`), a recipe (data keyed by fingerprint, `recipe-schema.js`), or noticing the miss. Notion: "Self-improving form filling: design & plan".
- Test the SHAPE with a fixture; the real site is one live sample. A variant still unhandled is reported with its fingerprint and listed for the
  person, never skipped silently.
- **Validate a form fix on the real extension:** `cd desktop/e2e && npm run real-extension` (isolated, `desktop/e2e/lib/real-extension.mjs`), with a positive
  control: `REAL_EXTENSION_DIR=<the build before the fix>` must fail it. A new case gets its own test there through `startRealExtension`, never a
  hand-rolled launcher. Say in the reply what it showed.

## Reading pages: AI decides, structure finds, floors guard
- Whether a page is ready, what became of an action, what a message means, whether something is a bot check, which step of a journey this is:
  **decided by AI with a fixed answer the code validates** (`desktop/lib/page-kind.js`, `account-judge.js`). Structure may only **find** a control;
  a floor (one press per tab, never a consent, no AI = nothing pressed) may only AND with the AI's answer.
- Before writing code that decides anything about a page, say in one line which decisions are AI, which are structure, which are floors.
  Guard: `tools/hardcoded-page-words.mjs`.
- One page decision: the AI's kind (`page-kind.js`; `extension/tab-pages.js` `pageRole` only without AI). Never add a second page classifier.
- **What a contact box means is the AI's reading too** (owner, 27 Oct 2026: "AI reads contact boxes"; form 103 "Preferred First & Last Name" typed "Tester"): the quick step's label patterns
  (`page/fill-read.js` PROFILE_LABELS) type first, so a details-only fill still works; contact boxes ride along in the answers call when it is made anyway (never a call of their own,
  `extension/flow.js` openQuestions), and where the AI's answer disagrees the AI's is typed (`page/fill.js`), never over the person's own edit. Guard: `worker/test/fill-contact-ai-meaning.test.js`.

## Applying flows: change one, run them all (owner, 8 + 10 Oct 2026)
- **The journey gate**: a push touching any flow file runs the applying scenarios as event sequences (`tools/journey-gate.mjs`, `JOURNEY_TESTS` in
  `desktop/e2e/flows.mjs`, seconds, no browser). A live bug becomes a scenario in `desktop/test/journeys.test.js`, failing first.
- Touching the decision core (`FLOW_CORE`): its steps run with every other e2e on CI (`apply`, `applyflows`); the browser matrix is no push gate.
  `cd desktop && npm run flows` (~5 min) is an on-demand check for a big flow change.
- One step locally: `E2E_STEPS='the app has an applicant,<journey>,<step>' node suite.mjs applyflows`.
- A new scenario gets a row in `docs/flows/applying.md` and in `MATRIX`, with a step or test that fails first.
- **One owner per state:** where an application stands is `desktop/lib/application-journey.js` (app) and `extension/tab-identity.js` (which
  application a tab is); never a new field or storage key for it elsewhere. Spec: `docs/superpowers/specs/2026-10-10-application-journey.md`.

## The flow core: one session at a time, invariants first (owner, 10 Oct 2026)
- **The claim is automatic** (12 Oct 2026): your open PR (or pushed branch) holds `FLOW_CORE` / `FLOW_FILES`; no message to peers, no "released". `node tools/flow-fresh.mjs --others` lists the
  other open PRs on the same files; the required check "Core flow files up to date with main" fails when main changed a flow file this PR also changes, and `tools/ship.sh` rebases and pushes again by itself.
  Read each file's `Invariants:` block first. No new applying feature while a journey refactor is landing.
- **Claim a function, not the file, when that is all you edit** (11 Oct 2026): `node tools/claim-shape.mjs claim-part <file> <function> --session <me>` (`release-part` when done).
  Different functions of one file can be held at once; a claim without a function holds the whole file, one without a file the whole core, and each blocks the narrower ones.
  The tool refuses a file or function name that is not there. Still one message to the peers saying what you took. Guard: `desktop/test/claim-shape.test.js`.
- **Read the file's "Invariants:" block first.** Changing an invariant is the owner's call: say so in the commit. A new invariant gets its test in
  the same change (`desktop/test/flow-invariants.test.js`).

## Never fix the same website twice: four layers (owner, 10 Oct 2026)
Spec: `docs/superpowers/specs/2026-10-10-applying-reliability-layers.md`.
1. Journey scenarios (`desktop/test/journeys.test.js`, every flow push).
2. **Recorded pages** (`desktop/e2e/recorded/<shape>-<n>/`, `npm run recorded` in `desktop/e2e`, replayed by the journey gate when the extension
   changes), captured from the twin with `npm run twin:drive -- capture <tab> <case> <page> <your worktree>/desktop/e2e/recorded` (scrubbed;
   `desktop/test/recorded-privacy.test.js`). Named by shape; must **fail on the build before the fix** (`REAL_EXTENSION_DIR=<old extension/>`, name
   the failing check in the commit); its stubbed AI answers only what the extension asked.
3. The pool, offline (owner, 13-14 Oct 2026): each row's newest network record replayed, $0, no site: replays are for DEBUGGING (owner, 17 Oct 2026): by hand (`site-replays.yml`), never on a PR and on no schedule; the journeys (`journeys.yml`) likewise. The daily check of multi-step flows is a live run of one site per platform (its own workflow).
   The live smoke pool (by hand only, owner 11 Oct 2026) now only RE-RECORDS a row: on the Mac first, on a GitHub runner (`record-sites.yml`, capped) only when the Mac is blocked (bot check, site limit). No live run on a PR (owner, 13 Oct 2026: no AI cost on a PR).
   - **Signing in** (owner, 13 Oct 2026): the pool may sign in only with a test account listed in the Keychain (`job-pilotto.test-account.<host>.*`), never a person's own data, through the product's saved-password sign-in; still never Submit, never a captcha / SMS / email code, never "create account", and a refused sign-in is never retried.
     **Test accounts** (owner, 15 Oct 2026): accounts the owner made BY HAND (Workday per tenant, SuccessFactors; inbox `test-account-<site>@jobpilotto.top` since 16 Oct 2026; new accounts are made with it, the first two (Richemont, career74) were made with `igor.mardari96+jp@gmail.com`; a Cloudflare Email Worker stores each mail 7 days and the harness reads the verification link or code with `desktop/e2e/lib/test-mail.mjs` `latestMail(to, {since, waitMs})`, Bearer = the site key; `admin/test-mail.js`), kept as `job-pilotto.test-account.<host>.{email,password}` and shown in Settings → Credentials as "Test account". Tests read ONLY those items (a Mac with no `JP_TEST_ACCOUNT_HOSTS` lists them itself); his real application accounts are never read by a test, and the app never serves a test item to an application (`credentials.forExtension`). The tripwire also looks for each test password in the run's saved files and deletes them on a hit. No account for a host: the run is held at the account step as before. **The test email is a `test-account-*@jobpilotto.top` address (or, for the two older ones, a `+tag` address of the owner's inbox), never his plain real one** (16 Oct 2026: the first Richemont runs typed his real address into a login). **A signed-in row replays offline from its network record** (`node replay-net.mjs <record dir> <out>`: the record keeps the login response and the site's scripts, never a request body, so no password); the structure replay (`npm run row`) has no scripts and cannot sign in (Richemont, 16 Oct 2026: 6 filled, 7 left, live and replayed alike).
   - **A row not "same as live" is diagnosed before it is re-recorded** (owner, 14 Oct 2026): find the first missed AI ask, then the cause in the spec table "Why a row does not replay as live" (`docs/superpowers/specs/2026-10-13-replay-by-network.md`); a new cause is added there. A build that really got worse is the product's bug (the replay is its reproducer), never a replay gap.
4. Per-board drops in the digest (`/admin/form-filling/real-users/digest.json`, `boards[].dropped`).
- **A push changing a file a recorded replay loads (the extension's files, the app's `desktop/lib` modules the offline app runs; found by structure, `tools/replay-files.mjs`, plus every `FLOW_FILES` file: a journey scenario proves the ones no replay loads) must add a recorded page, a ladder fixture (a wrong decision: CLAUDE.md "Where a fix lives") or a scenario**; cases are no longer cut from captures (`row-to-case`, owner 15 Oct 2026), and each page it adds or changes
  must FAIL on origin/main's code (`tools/recorded-cases.mjs`, `tools/recorded-fails-on-old.mjs`, push hook). `Recorded-unneeded: <why>` only for a change with no failure seen: never with a `Pool-row:` or `Fixes/Refs #N`.
  `Recorded-pins: <why>` for a case that only pins behaviour that already works (same refusal); a follow-up that only corrects the case of a fix
  already on main says `Fix-commit: <sha>`, and the case is replayed on the code before that fix. A push that adds a recorded case names its row: `Pool-row: <row>` (the Fixed tab lists fixes by it) or `Pool-row: none <why>`. A field replay (`worker/test/fixtures/fill/`) is a second layer, never the proof.
- **The Fixed tab** on `/admin/form-filling/lab` (`#fixed`) holds each fix's status and guard. Optional commit trailer `Pool-row: <the pool row's exact name
  in the pool>` fills it (the commit hook and push gate refuse a value that is no row name, e.g. a capture folder's slug: `tools/pool-rows.mjs`). Close a fix only when the Fixed tab shows
  Confirmed, never on "it clears by itself".

## The ladder: fix a site at its rung (owner, 10 Oct 2026)
- A page decision climbs rung 0 structure rule, 1 kept answer, 2 text sketch, 3 numbered digest, 4 closer look (screenshot), 5 Claude takeover,
  6 the person; a rung that is unsure or contradicted hands the page up, never guesses (`extension/ladder/core.js`). Skill `fix-recorded-sites`;
  progress: skill `report-progress`.
- **Fix at the LOWEST rung that has the information, data before code** (a kept answer, a recipe, a prompt example).
- **A fix cannot break another site:** `desktop/e2e/ladder-fixtures/` + `desktop/e2e/ladder-baseline.json`; `cd desktop && npm run ladder-score`
  (`-- --offline` for stored answers); `tools/ladder-gate.mjs` (push hook) fails a flow push that makes a fixture worse. A fixture only gets better
  through `npm run ladder-score -- --offline --update-baseline "<why>"`; never edit an expectation to pass. Rates per source, never blended.
- A new shape from the pool or a live bug first becomes a fixture (`node desktop/e2e/ladder-capture.mjs`), seen wrong, then the fix.

## Test a flow live (owner, 8 Oct 2026)
- **`cd desktop && npm run live`** (LIVE_URL=<posting>, LIVE_LIKE='%host%', LIVE_SECONDS=120): the e2e app (own profile, SQLite store, no Notion) + a
  visible Chrome with the real extension, on a real posting read read-only from the owner's job list (`e2e/lib/apply-live.mjs`). It presses nothing
  on the page. About 3 minutes.
- **`npm run twin`** ([docs/live-test.md](../live-test.md)): the owner's real state mirrored, only when the owner's own data matters. A new outward
  path in the app (a sender, a schedule, AppleScript) gets its twin guard in the same change (`desktop/test/twin.test.js`).
- **Per-site daily limit (owner, 11 Oct 2026; `desktop/e2e/lib/site-ledger.mjs`):** at most 3 live visits per host per day across all sessions and live paths; a 4th is refused naming the site and the last run, and a host that showed a block page rests until tomorrow. Only the owner lifts it: `JOB_PILOTTO_SITE_LIMIT_OVERRIDE=<host>` (logged); never work around it.
- **A held run says so** (`HELD by the live test` in the log, the banner and the stall report; `LIVE_SUBMIT=1` lets the consent and the account
  button through). Before starting one, tell the owner what the window will and will not do; watch it with Monitor (global rules).
- Report what it showed: what worked, what did not, what the log cannot tell (then add the log line).
- **Nothing is typed under a dialog** (owner, 11 Oct 2026: "we should not start filling any form before we close all the popups/overlays"): before the fill, what covers the form's controls (`extension/on-top.js`) is closed with the AI's non-agreeing button (`popup-pick.js`, at most 3 tries); one nothing closes holds the fill ("held: a dialog covers the form", the pool counts it as needs-fix). Between the fill's stages (`extension/page/guard-gate.js`, answered by `extension/popup-guard.js`) a layer that opened meanwhile is closed the same way or holds the fill. After the fill the same check says "a dialog was left open over the form". A bar that covers no control never blocks. Guards: `worker/test/dialog-after-fill.test.js`, recorded cases `dialog-unclosable-holds-1`, `cookie-bar-beside-form-1`, `dialog-opened-by-fill-1`, `dialog-opens-mid-fill-1`, `dialog-mid-fill-holds-1`, `dialog-over-framed-form-1`.
