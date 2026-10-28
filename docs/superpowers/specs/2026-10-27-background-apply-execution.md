# Background Apply execution (27 Oct 2026; owner decisions 28 Oct 2026)

> [!NOTE]
> **Verdict (owner, 28 Oct 2026):** "Finish the Full automation / background applying flow." This is the one spec for Background and Full automation (the draft `2026-10-28-background-full-automation-design.md` was folded in here). The 27 Oct work is uncommitted in the worktree `hidden-apply-modes` (about 1,000 lines plus tests). Build on it; never delete or overwrite it.

## Owner decisions, 28 Oct 2026
- **The in-app live view design (approved 28 Oct 2026; relayed to this session by `jobadabra-ec`, which drew the mockup; I did not hear the owner say it):** the Applying page's review card (`#ss-decision`) becomes the live page. A strip shows the Live dot, the page address and zoom, then the page picture, a note line, then the actions. Four states: **Filling** (watch only, Stop) · **A bot check needs you** (framed, never solved by us) · **Review** (required fields left are framed; Submit off with "N required fields left") · **Ready to submit** (Submit on; `confirmation.js` then decides Applied). "Needs your attention" stays below: "Review in form" scrolls the live page, "Fill it in" types into it. "Open in my browser" replaces "Open filled form". Answers: (1) "Yes, build this"; (2) "Fixed window + Expand": about 430 px tall, scrolling inside, with an Expand to fill the app window; (3) "App button + page's own": the app's "Submit application" is off until every required field is filled, and the page's own Submit also counts; both are the person's press. Mockup: https://claude.ai/artifact/Lq3MeVUtavGRm8W2sZekPS. Before PR B's UI commit the usual light + dark, wide + narrow side-by-side still needs the owner's yes.
- **Two live view requirements (owner "Ok", 28 Oct 2026; relayed by `jobadabra-ec`):** (1) **B's first task, before any screen is built:** measure on the zoo/recorded pages whether a native dropdown's pop-up list (it may not draw in a headless screencast) and the file picker (choosing a different CV) work through the stream; write the result here. If either fails, propose a bridge or limit the live view to review + Submit, and ask the owner with a recommendation. (2) **Any client can use it:** stream and input go over a plain message channel; only a thin connection ties it to the Mac app's screen, so a later phone viewer (applying and solving checks from a phone, not in Full automation) reuses it unchanged. Touch typing on a phone (a hidden text field passing keys in) is later, not B. Purpose: glance, fix a field or two, solve a check, submit; anything longer goes to "Open in my browser", one click, the same filled page.
- **B0 result (measured 28 Oct 2026, Chromium 1248 `--headless=new` and headless shell, raw CDP as `live.mjs` drives it, fictional form):**
  | Control | Through the stream as is | Bridge measured |
  |---|---|---|
  | Native dropdown | ❌ pop-up never draws (focus ring did: the click landed); a click where an option would be does nothing; arrow keys do nothing on macOS | Type-ahead letter works (`g` → Gamma, change fired), but the person cannot see the options |
  | File picker | ❌ a click opens nothing (no dialog in headless) | ✅ `Page.setInterceptFileChooserDialog` reports the click; `DOM.setFileInputFiles` sets the chosen file, change fired |
  Custom (in-page) dropdowns draw in the page itself, so they stream like any element (not measured separately). Proposed bridges, both universal and both over the same message channel: a click on a native `<select>` sends its option list to the viewer, which draws its own list; the pick comes back and is set on the page's own control. A file chooser event asks the viewer for a file (the person's CVs, or the app's open dialog), then sets it. **Owner, 28 Oct 2026: "Build both bridges"** (in PR B), and confirmed the live view design above ("Yes, that's what I approved").
- **B1 result (measured 28 Oct 2026, Chrome for Testing 1248 `--headless=new` with A's `browserArguments` and the owned extension copy, fictional form, app port 1):** the extension worker is up in ~0.5 s and its `chrome` API is bound in ~0.7 s (it is not bound when the worker target first appears, so wait for it). There is no startup page. `chrome.windows.create({focused: false})` opens one tab, and that tab streams screencast frames. Sampled every 250 ms during the run: the frontmost app never changed and no Dock entry appeared (positive control: the sampler does see a visible Chrome). This replaces the failed minimized-window premise. The download must be full Chromium (Chrome for Testing): the headless shell cannot load extensions.
- **What a person sees when a job needs them (captcha, login, review before Submit):** a **live view of the same held page in the app**, reusing Ready to send's `hosted/ready-fill/live.mjs` (measured 17 Oct: open p50 155 ms, input p50 79 ms). The person types, solves and presses Submit in it. "Open in my browser" (`ready-handoff.js`) stays as an extra. This closes the "owner design choice pending" below: no native window reveal.
- **Hidden browser, a Settings → Apply choice:** (1) **Jobadabra's browser**, Chromium, headless, hidden: **the default**. (2) **My Chrome**: the person's own Chrome, a normal visible window with focus. The minimized-Chrome option is dropped: owner, "Probably it's not much worth over the 3rd one" (it flashes focus anyway, per the 27 Oct finding). My Chrome's advantages are the person's sign-ins and site cookies, and passive "checking your browser" pages clear more often on a real profile (never disguised).
- **Mode capability API (#2317):** each mode names its batch runner in `MODES[].runner` (desktop/renderer/apply-settings-model.js). A mode with no runner is a disabled "Coming soon" card on every surface and can never be the saved mode. Main starts `modeRunner(applyOf(settings).mode)`. `fill` then `auto` get `runner: 'background'` in the PR that makes each one pass this spec's acceptance.
- **The Full automation recap is PR C of "What we learned"** (`2026-10-28-what-we-learned-design.md`, "Remember, by Apply mode"): after a Full automation run, a recap of what was answered and learned, with Change. Here: emit each submitted job's answers and receipt through the store so PR C can draw it. The recap screen is PR C's, not this spec's. Full automation does not ship to people before that recap exists.
- **Step order (one PR each):** A, the 27 Oct work committed as reviewable state, store, controller and safety, with modes still Coming soon. B, headless browser plus first-use download plus the in-app live view; `fill` gets its runner. C, Full automation gates, wait with Stop, receipts, README/privacy wording, then `auto` gets its runner (after the What-we-learned recap). D, the My Chrome choice.

## Problem and observable behavior

Settings already stores three Apply modes, but `fill` and `auto` still fall through to the visible Chrome Apply path (#2317 since shows them as "Coming soon" until their runners pass). Implement both modes through one app-owned session and the existing Jobadabra extension form flow. `check` keeps opening the visible review form.

| Mode/state | Browser/session behavior | Application outcome |
|---|---|---|
| Standard automation (`check`) | Existing visible browser review | User reviews and submits |
| Background automation (`fill`) | Same extension flow in a hidden/minimized browser window | Persist `ready_for_review`; user opens the same session and explicitly submits |
| Full automation (`auto`) eligible | Same hidden extension flow; submit only after the saved opt-in, eligibility, required-field/fact policy, per-day/employer caps, wait and Stop checks all still pass | `Applied` only after the existing confirmation judgment reports a receipt |
| Either background mode, preflight CAPTCHA | Persist a per-job manual override and route to manual review; retain the job | No automated attempt for that job |
| Either background mode, runtime CAPTCHA (including submit response) | Stop that job, persist manual handoff, reveal the same browser session with its current cookies/form/files, notify clearly | User solves it and presses Submit; automation never resumes, even after restart or a mode change |
| Unknown sign-in/2FA, missing required fact, attestation, ambiguous/unsafe page, unverified submission | Stop and hand off honestly; never invent facts or infer success | No false `Applied`; no retry that could duplicate the application |

## State and invariants

Per application: `queued → preflight → filling → ready_for_review` (fill mode); or `queued → preflight → filling → waiting_to_submit → submitting → receipt_confirmed` (auto mode). Any unsafe/unknown state goes to `needs_user_handoff`. CAPTCHA goes to terminal-for-automation `manual_submit_required`. An explicit user action may review/submit from that state, but no background event can transition it back into `submitting`. Persist these states by job/session identity so restart, repeated dispatch and races cannot duplicate fill or submit.

Standard automation remains visible. Background and Full automation must not create a visible browser window unless a manual handoff requires one. All actual form reads, decisions and fills continue through the extension. The browser process is app-owned; do not copy the system browser profile or expose cookies. Reuse the extension's session identity and existing Ready handoff data where applicable. The mode IDs stay `check` / `fill` / `auto`; the canonical labels are owned by d17's PR #2317.

## Data ownership and browser contract

Canonical per-job state is a named `Background Apply` section on its existing Applications record, read/written through `src/stores` for every adapter. Terminal and extension records are runtime caches, never authority to resume a submit. A serialized server controller persists a one-shot submit reservation before returning a command; reserved/unknown outcomes never retry. Reservation events supply limits across jobs/restarts. Store failures stop automation.

A dedicated browser uses only a Jobadabra-owned profile. It starts without a visible window; the actual extension creates minimized application windows and reveals that same live tab for review or a runtime challenge. Browser files are an optional first-use download with explicit consent and progress, never bundled silently. The hosted Ready/night extension workflow is reused; no second form filler.

### Hidden-launch finding (27 Oct, actual browser)

The minimized-window premise failed on macOS: `chrome.windows.create` initially activates a normal window before it minimizes. Keeping `focused:false` prevents the requested minimization; omitting it eventually minimizes but still emits an initial focus event. The fictional browser smoke caught both behaviors. This does not meet acceptance, even though filling, mode-3 receipt and runtime CAPTCHA paths pass.

Proposed reuse: the existing Ready `hosted/ready-fill/live.mjs` already streams and forwards human input to the same held headless page. A local viewer can therefore expose the exact live page without restoring or refilling it. Owner design choice is pending before this replacement handoff is implemented. Modes remain unavailable until hidden launch and interactive handoff both pass.

## Acceptance and evidence

- One canonical saved-mode dispatch; mode 1 unchanged, mode 2 never submits, mode 3 has explicit gate checks and requires an observed receipt.
- A fictional local browser integration exercises the real extension/session contract, including hidden launch and same-session reveal; a mode-ignoring canned runner is insufficient.
- Preflight/runtime CAPTCHA tests prove per-job persistence, manual routing/reveal and no automatic resume after restart, mode change or challenge resolution.
- Unknown facts/attestations/auth states stop; per-job idempotency and concurrency limits are proven.
- No real application, production submission, production applicant data or paid AI call during development. Tests use fictional local fixtures and existing deterministic browser contracts.

## Constraints and non-goals

No vendor/host-specific CAPTCHA or page rules, CAPTCHA solving/bypass, profile cloning, second filler, silent bundling of a large Chromium download, or visible launch in modes 2/3. Keep existing settings, eligibility defaults and user limits. Do not report full background modes complete until the fictional browser integration proves the end-to-end contract.

## Progress

### 1. Safe state and controller (PR A)

- [x] Audit current mode, Apply, extension session/outcome, Ready handoff, twin, browser launch and hybrid fill research. (proof: none: audit read-out, findings are in this spec's Hidden-launch finding)
- [x] Add failing focused state and browser-contract regressions. (proof: desktop/test/background-apply-store.test.js)
- [x] Owner decisions on hand-off view and browser choice (28 Oct 2026, above). (proof: none: owner decision, quoted above)
- [x] A: commit the 27 Oct work as reviewable state, store, controller and safety; modes stay Coming soon. (proof: desktop/test/background-apply-controller.test.js)
  - A moved to B: mode dispatch (onto #2317's `MODES[].runner`), the download module and its IPC (the module needs a `tests-desktop-windows.yml` paths line), `form-judge.js` `bot_check`/`submit_control` (needs a ladder fixture), and the headless smoke that replaces the native minimized-window smoke.

### 2. Hidden browser and live view (PR B; Background automation turns on)

- [x] B0: measure native dropdown pop-up and file picker through the live stream; result written above. (proof: none: measured with a scratch CDP probe on a fictional form, table above)
- [x] B1: the owned extension runs in headless Chromium with no window, Dock entry or focus change; result written above. (proof: none: measured with a scratch CDP probe, table above)
- [x] The hidden browser starts for real: headless flag, unfocused normal windows (a minimized headless tab repainted 2 of 5 changes, normal all 5), real `start()` on Chrome for Testing ready in 0.76 s with the token stored, reused on a second start, no page, no focus change. (proof: desktop/test/background-browser.test.js)
- [x] First-use Chromium download: module and IPC on the shared add-on (lib/optional-addon.js, LibreOffice's), digest-checked; the real install of Chrome for Testing 156 (195 MB) took 37 s, and the real `start()` on it loaded the extension in 0.88 s with no focus change. (proof: desktop/test/background-browser-download.test.js)
- [ ] The download's bar with Cancel on the Applying page, started only by the person's press (part of the screen's side-by-side).
- [x] Mode dispatch through `MODES[].runner` (one dispatch): the `background` runner comes only from the saved mode, skips the person's-Chrome extension gate, hands the chosen jobs to the hidden browser's queue, never falls through to the visible launcher, and refuses before any write while the browser is not downloaded. (proof: desktop/test/apply-dialog-mode.test.js)
- [x] Live view channel: `attachLive(channel, cdp)` in `live.mjs` (Ready to send's `attach` now wraps it): frames out, the person's mouse and keys in, over a plain message channel any client can carry; measured on Chrome for Testing 156 headless through the app's own CDP session (lib/cdp-session.js), fictional form: 7 frames, no error. (proof: desktop/test/live-view.test.js)
- [x] Native dropdown bridge: a press on a `<select>` sends its label and options to the viewer, the pick is set with input + change; measured on Chrome for Testing 156 headless through the app's own CDP session (lib/cdp-session.js), fictional form: 6 options, label "Country", Gamma set, 1 change. (proof: desktop/test/live-view.test.js)
- [x] File picker bridge: the chooser asks the viewer; only a path the app resolves is set, never one the viewer sends; measured on Chrome for Testing 156 headless through the app's own CDP session (lib/cdp-session.js), fictional form: `/etc/hosts` refused, the fictional CV set, 1 change. (proof: desktop/test/live-view.test.js)
- [ ] Live view screen on the Applying card; owner's yes on the light/dark, wide/narrow side-by-side.
- [ ] `bot_check`/`submit_control` in form-judge with a ladder fixture (owner's yes on its measured cost).
- [ ] End-to-end proof on a fictional local form: fill hidden, review in the live view, the person's Submit lands.
- [ ] `fill` gets `runner: 'background'`; PR B green and Gitar approved.

### 3. Full automation submits (PR C)

- [ ] Settings → Apply checks wired to the one-shot reservation (no required empty, saved facts, fit 80+, 20 a day, 1 per employer).
- [ ] 10-minute wait with Stop, shown on the Applying card.
- [ ] The automatic Submit press in the hidden browser, one attempt, never retried.
- [ ] Applied only from a receipt the confirmation judge reads; anything else goes to the person.
- [ ] End-to-end proof against a fake local submit endpoint (never a real site).
- [ ] README and privacy wording change from "never submits".
- [ ] Each submitted job's answers and receipt reach the store for the What-we-learned recap.
- [ ] `auto` gets its runner, after the recap screen exists; PR C green and Gitar approved.

### 4. My Chrome choice (PR D)

- [ ] Settings → Apply browser choice: Jobadabra's browser (default) or My Chrome (normal visible window).
- [ ] My Chrome runs the same flow; PR D green and Gitar approved.
