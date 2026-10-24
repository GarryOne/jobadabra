# Report this form: from a trace kept while the form is filled, not a new recording

> 🔄 **Changed 19 Oct 2026 (owner):** Report is a popup ON the panel (what goes, an optional note, Send / Cancel), no trip to the app and no bottom-left ⚑; the app scrubs, holds and uploads. A Stop halts the recording but KEEPS what was recorded, so Report after a Stop sends it. "Nothing leaves before Send" now means before Send in that popup (personal details are removed automatically first).

> ✅ **Verdict:** while Jobadabra fills an application, the extension keeps a **trace in memory** (every page and answer from the job posting on, sign-in pages never).
> ⚑ Report this form hands that trace to the app **at once: no reload, no new recording**. The scrub, last gate and preview stay as today; nothing leaves before Send.
> **Owner decisions, 16 Oct 2026 (via job-pilotto-cc):** always record (a refresh breaks SAP sessions; a visible "Recording" on a sign-in page kills trust); option A below
> (a held debugger, Chrome's bar visible during the fill); on by default, with a plain-words setting and a wizard line.

**Why:** #993 started a report at the posting by moving the tab, but that still re-runs the journey and reloads when the tab is already on the posting. Owner: "record always, and
when he presses Report we send the recording already made, right away, without a refresh." **Replaces** #993's reload-at-posting start (removed in the same change).
**Unblocks:** a reported stuck step whose record holds the whole journey from the posting, so `reports-fetch → row-to-case → replay` reproduces it with no account.

## History (read 16 Oct 2026)
- Collector: `extension/report-recorder.js` (15 Oct, cca3722 attaches through `attachDebugger`, ends on Stop); worker side `messages-report.js`; app side `desktop/lib/report-handlers.js`, `report-form.js`, `report-scrub.js` (+ token scrub, #993), `net-keep.js`.
- The fill does **not** hold a debugger: `flow.js` `debuggerTurn` attaches per press and detaches (`:56-118`). Nothing to reuse; this spec adds the one long-lived attachment.
- Setting: `reportForm` (`report-handlers.js:10`, `!== false`, so already ON for existing installs); today it only decides whether ⚑ is drawn.
- Replay: `net-record.mjs` `netReplay` serves by exact URL, normalised URL, then path + order; report entries already have that shape (`reports-fetch.test.mjs`).

## Decisions

### 1. Capture: a held debugger per app-managed tab (option A)
- On a tab the app opened (`attachDebugger` rule: `#jobpilotto-fill` or `armed:`), from the **first navigation to the posting** until the session ends, the tab closes, or Stop: `Network.enable`, listen, keep.
- **The fill's own debugger users share it.** Menu clicks and real typing (`flow.js`, `fill-verify.js`, `ladder/fill-climb.js`) attach and **detach** today; they must not detach the trace. One module `extension/trace-debugger.js` owns attach/detach per tab and reference-counts the users: the last user leaving detaches only when the trace is not wanted. Guard test: no other file calls `chrome.debugger.attach/detach`.
- Switch off = **no attach by the trace, no bar** (today's behaviour exactly; the fill's short attaches stay).
- Reads response events only: **never** `postData`, request headers, cookies (`Set-Cookie` dropped by the header allow-list). Unchanged from `report-recorder.js`.

### 2. Sign-in pages: never recorded, the rest of the journey kept
- Detection: the existing any-frame `input[type=password]` check, run on `Page.frameNavigated` / `loadEventFired` and every 1 s while a page is shown.
- On a hit: **(a)** that page's document response, and every request since its navigation began, is **dropped from the buffer at once**; **(b)** the debugger is **detached** (Chrome's bar disappears on the sign-in page); **(c)** a gap is kept: later entries carry the next `seg` number (no URL, no host of the sign-in page). When the tab navigates away from a password page, the debugger reattaches and capture resumes.
- A password field that appears late (JS-rendered) is caught by the 1 s check; what arrived in between is dropped with the page (the drop covers from the navigation start). Fail closed.
- Honest limit: between the sign-in page's first byte and its detection (≤ 1 s) bytes sit in memory, then are dropped; never written, never sent.

### 3. The buffer: memory only, capped, per tab
| Part | Value |
|---|---|
| Where | extension memory (worker). Never `chrome.storage`, never disk. Worker sleep: **measure first** (§8); if the buffer is lost on a sleep, move it to a `chrome.offscreen` document (still memory only) |
| Format | the report entry shape of `report-recorder.js` (= net-record entries + bodies): scrub, gate, upload, fetch, replay unchanged |
| Bodies skipped | images / media / other binary: **no `getResponseBody`** (the scrub blanks or drops them anyway); size from `encodedDataLength` |
| Size cap | **30 MB raw per tab, 60 MB over all tabs** |
| Pinned head | the **first 3 pages** (the posting with its redirects, then the next two) are never evicted |
| Eviction | when over the cap, whole oldest pages go first, never the head, never the page now shown; the buffer records `truncated` |
| Time cap | **3 h per tab** from the first page; older pages beyond that are evicted like the size cap |
| Entry cap | 4000 entries per tab |
| Dropped when | the application's session ends, the tab closes, Stop is pressed, the switch is turned off, the app quits, or the extension reloads |

### 4. Report this form: hand over, don't record
- Every entry point (panel ⚑, the labelled button, the corner flag, the app / ⌘K path) calls **one function** `reportFromTrace(tabId)`. `report-start` no longer exists; `report-stop` becomes `report-send`: the worker POSTs the buffer to `/extension/report-form` as today.
- If the tab moved past the posting, the card asks once: **"The whole journey (recommended for fixing)"** / **"Only this page"** (entries of the page now shown). No reload, no "the page will reload" sentence.
- If the buffer is empty (switch off, tab not app-managed, a sign-in page now): the card says why in one line; nothing is invented.
- The app's scrub, `lastGate`, preview and Send are unchanged. Nothing leaves before Send.

### 5. Settings, wizard, the bar explained once
- Setting `reportForm` is ON by default (new **and** existing installs; it already is: `!== false`). **Renamed** in plain words: **"Keep a trace of each form fill, so you can report a problem and we can fix it"**; one line under it: *Stays on this Mac, sent only when you press Report and confirm, never sign-in pages, deleted when the application ends.*
- **Wizard:** the same line with one checkbox, checked, near the existing privacy note (`index.html:62`).
- **Chrome bar:** explained once, where a fill starts (the start card / panel line): *Chrome shows a debugging bar while Jobadabra keeps the trace.*
- Off = today: no trace, no bar, ⚑ not drawn.
- ⌘K: a "Keep a trace of each form fill" toggle entry (every new action goes in the palette).

### 6. Replay: the gap
- The report's first entry is the posting; no account is ever needed. After a gap the entries resume at the first page after the sign-in. `reports-fetch` (`segmented()`) splits the record by `seg`: `entries` = the **last segment** (the one holding the stuck step, starting at the first page after the gap), `earlier` = the pages before it, kept for the fix to read and never replayed.
- No code path for a page kind: the cut is only "a gap marker".

### 7. What changes vs. the 15 Oct spec
| | Before | After |
|---|---|---|
| Recorded | after the press, one page | during the fill, memory only |
| Leaves the Mac | only after Send | same |
| Sign-in page | refuses the whole report | the page is never in the buffer; the rest stays |
| Chrome bar | during the report | during the fill (switch on) |
| Token / credential in bodies | scrubbed by name (#993) | same, and the sign-in page is absent |

### 8. Measure before landing (in the PR)
Memory (heap + buffer bytes) and CPU of a long fill (the largest recorded journey), switch on vs off; worker restarts seen; the longest sign-in detection delay. Numbers go in the PR body.

## Tests (first)
1. A fixture journey posting → redirect → sign-in (password) → form: the buffer holds **zero entries from the sign-in page** (url, headers, body), the pages after it are present, one gap marker; the report **replays offline** from the first page after the gap.
2. Memory cap: over 30 MB per tab evicts oldest pages, keeps the head and the current page, sets `truncated`; 60 MB total.
3. Switch off: no `debugger.attach` by the trace; nothing kept.
4. Dropped on session end, tab close, Stop (buffer empty, listener gone).
5. The class: every report entry point calls `reportFromTrace`; a test fails when `Page.reload` or a second start path exists.
6. One debugger owner: no file but `trace-debugger.js` calls attach / detach.
7. Privacy floor kept: never reads `postData` / cookies / request headers (existing guard in `report-recorder.test.js`).

## Open items / limits
- MV3 worker suspension may drop the buffer: measured first, offscreen document as the fallback.
- A password field on a page that is not a sign-in (a change-password form) is also never recorded: fail closed.
- The 30 MB / 3 h numbers are a first guess; the measurement in §8 may move them.

## Progress
- [x] Owner approves this spec (the owner merged #997 on 16 Oct 2026) (proof: none: the owner's merge of the spec PR)
- [x] 1. One debugger owner, ref-counted: `attachDebugger` / `detachDebugger` in stop-state.js; `trace.js` holds it, releases it on a password page and resumes (proof: desktop/test/trace-debugger.test.js, desktop/test/trace.test.js)
- [x] 2. The buffer: cap, pinned head, eviction, drop on end (proof: desktop/test/trace.test.js)
- [x] 3. `report-send` from the trace, the card choice, #993's reload start and `report-recorder.js` removed (proof: desktop/test/report-panel.test.js)
- [x] 4. Setting renamed (it is its own ⌘K entry by its heading), wizard checkbox, the bar explained once in the panel (proof: desktop/test/report-panel.test.js)
- [x] 5. `seg` gaps -> `entries` / `earlier` in reports-fetch (proof: desktop/e2e/test/reports-fetch.test.mjs)
- [x] 6. Memory / CPU measured: in the PR body (proof: none: the numbers are in the PR body)
