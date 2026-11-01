# Live test: a twin of the owner's app

> **Verdict:** to see a fix work on the owner's real state and real websites, run `cd desktop && npm run twin`.
> A second app (its own window, port and browser) on a fresh copy of the real app folder, with Notion replaced by a one-way mirror.
> Nothing it does reaches the owner's app window, Chrome windows, Telegram or real Notion. Never Submit. (Owner, 8 Oct 2026.)

| | Owner's app | Twin |
|---|---|---|
| Folder | `~/Library/Application Support/Job Pilotto` | `…/Jobadabra (live test)/home`: a fresh clone at each start |
| Notion | "Job Pilotto - mac - Photographer" | "🧪 Job Pilotto – Live Test" (one-way mirror, synced at each start) |
| Token | the app's own current token: `desktop/e2e/lib/real-notion-token-main.mjs` decrypts it from the real `secrets.json` (safeStorage, read-only, env of the copy tool only, never printed; no fallback; macOS may ask once to allow the app's key) | Keychain `job-pilotto.notion.token-live-test` (404 on every real database: checked at start) |
| Browser | the owner's Chrome | its own visible Chromium window, one tab, fresh profile with the sign-ins carried over, extension copy on the twin's port |
| Port | 47111 | a free one (`twin.json`) |
| Telegram, schedules, Always on, telemetry | on | off (`desktop/lib/twin.js`) |
| Form learning with the site (fill records, reasons, proposal use out; recipes and meanings in) | on | on: its fills are real use (`desktop/lib/telemetry.js` learningOff, 9 Oct 2026) |
| AppleScript on Chrome / Terminal | yes | off |
| Apply with Claude / Take over with Claude | your Chrome (`--chrome`) | the twin's own Chromium only: `--no-chrome` + a Playwright MCP on its port, the submit guard as init script, job-site passwords masked (`--secrets`) |
| Engine's Keychain (Telegram bot) | yes | none (`src/secret_store.py` `isolated()`) |
| Google sign-in (read-only Gmail and Calendar: the sign-up's confirmation mail) | yes | **read from the real store** (owner, 10 Oct 2026), the three `job-pilotto.google.*` items only (`TWIN_MAY_READ`); never written |
| Ready to send (owner secret) | yes | **read from the real store** (owner, 17 Oct 2026), the one item `job-pilotto.ready.owner_secret` (`desktop/lib/keychain.js` `TWIN_OWNER_SECRET`), read-only: the twin is the same install, so its Send tonight / Run now reach the site as the owner's. The night's forms are filled on the server, never submitted |
| Real websites, Keychain site passwords, AI | yes | yes (real AI spend: say the cost) |
| Keychain writes (a new site password, a Google sign-in) | yes | never: the twin's own file `isolated-secrets.json` in its folder (`desktop/lib/keychain.js`, `src/secret_store.py`); it reads that file first, then the real site passwords only |

## Run it
- `cd desktop && npm run twin` (or `--no-sync` to skip the sync). Ctrl-C stops the app and its browser.
- **Drive it with `npm run twin:drive -- <command>`** (in `desktop/`; `desktop/e2e/twin-drive.mjs`). Every click and keystroke is outlined in
  orange with a "Claude: …" caption first, so the owner watching sees what is pressed; a form's Submit is refused in any language.
- **Update it live, without closing it: `npm run twin:drive -- refresh [--tabs]`** (9 Oct 2026). The twin's worktree goes to `origin/main`; a changed extension is rewritten in place and reloaded
  through `chrome://extensions` (NOT `chrome.runtime.reload()`: Chrome 153 leaves a command-line extension disabled after it); a change to the app's main process (`desktop/lib`, `main.js`, `app-core/src`) restarts
  the app alone, with its whole process group and its ports; anything else reloads the window. The browser, its tabs and sign-ins stay (`--tabs` also reloads the tabs so their panel gets the new script, which
  loses those pages' fill state). Not covered: a change to `twin.mjs` itself needs one restart of the twin. Code: `e2e/lib/twin-refresh.mjs`, guarded by `e2e/test/harness/twin-refresh.test.mjs`.

  | Command | Does |
  |---|---|
  | `inspect <session>` | the app's view (left, pending, proposals) + the page's own state per pending field (never a password) |
  | `reopen <session>` | the card's "Open in Chrome" path (the form reopened with the fill mark when its tab is gone) |
  | `press <text> [why]` | a visible click in the **app** on the control showing that text (Applying, a session, Apply). Drive the app through its own screens like this, never with `app "window.pilot.…"`: the owner watches the app too (9 Oct 2026) |
  | `click <tab> <selector> [why]` | a real click in the twin's browser (`tab`: part of its address) |
  | `type <row title> <text>` | types into a Needs your attention row and presses Enter |
  | `app "<js>"` / `page <tab> "<js>"` | reads state from the app window / a tab |
  | `shot app\|<tab> <file.png>` | a screenshot |
  | `arrange` | both windows to the front, the browser on the right half |
- **Watch in short steps** (global rule "Watching a live run"): after `reopen`, the extension's first line ("page kind", "filling") must come within
  ~20 s; then read the log every ~5 s and decide: progressing, done, or stuck (stop and look).
- **The browser starts with one tab** (the extension's install page is blanked and reused) and a **fresh profile each start**: only site sign-ins
  (cookies, local storage) are carried over from `…/Jobadabra (live test)/browser/` and saved back at stop. Its extension copy has "all sites"
  access built in, as granted once in the owner's Chrome.
- **After each fill** the twin's log has one `fill: fields: N filled, M left` line: every field's outcome, source and reason, as the page holds it at the end.
- Its log: `…/Jobadabra (live test)/home/logs/app.log`. The owner's `app.log` must show none of its lines.

## Accepting proposals (17 Oct 2026)
`LIVE_USE_PROPOSALS=1` on a held run or replay takes the fill's proposed answers the way the person's "Use" press does (`lib/proposals-to-use.mjs`; a menu answer only when one of the form's own choices says it), then the extension goes on by its own rules (Next only when the form judge says ready; never Submit). Off by default. A live visit with it needs its own yes.

## Rules
- Never the owner's main app window or process; never Submit; nothing destructive anywhere.
- DOM reads are narrow: never read a password field's value.
- Notion writes only ever reach the mirror. The mirror is overwritten at each sync: never edit it, never the source of anything.

<details><summary>Setting the mirror up again (once per workspace)</summary>

1. Notion → an internal integration "Job Pilotto Live-Test" in the owner's workspace; share only the Live Test page with it.
2. `security add-generic-password -U -a job-pilotto -s job-pilotto.notion.token-live-test -w '<secret>'`
3. `python3 tools/notion_copy.py create --token job-pilotto.notion.token-live-test --parent <Live Test page id>` → save the printed ids as
   `NOTION_*=<id>` lines in `~/Library/Application Support/Job Pilotto (live test)/ids.env`.
4. `npm run twin` does the first full copy (about 10–20 min; later syncs only update).
</details>

## Working with the twin as an agent (owner, 9 Oct 2026: "instruct yourself how to work with the twin when doing updates in the code")
On demand only (owner, 14 Oct 2026): the live apply loop and its skill were removed; form bugs are found and proven offline from recordings (`/fix-recorded-sites`). Use the twin to reproduce an app bug the owner saw, never as a loop.
The twin is for looking at the REAL app on a REAL site while you build. The loop, in order:
1. **One twin, started once.** `pgrep -f e2e/twin.mjs` first (the Live Test folder and its Notion mirror are shared: a second twin collides; ask the peer who runs it). Start it from a worktree
   of its own (`tools/worktree.sh twin-<topic>`, then `cd desktop && npm run twin` in the background, a Monitor on its log for `^twin: (running|refresh)`). Say in one line what its window will do
   and what is held back (never Submit, no password values). It sits on a blank tab until the first press: that is the twin waiting, not a stall.
2. **Never edit in the twin's worktree.** Edit in your own worktree, land with `tools/ship.sh`, then `npm run twin:drive -- refresh` (about 9 s). Do not stop and restart the twin to pick up a change:
   that loses the browser's tabs, the signed-in sessions and the half-filled form. Read what refresh printed: `extension reloaded (x.y.z)` must show the new version (the copy is stamped: `desktop/scripts/extension-stamp.mjs`); `NOT running` is a bug to report.
   Restart the twin only when `e2e/twin.mjs` itself changed, or when the owner asks.
3. **It shows main, not your branch.** Refresh fast-forwards to `origin/main`. An unpushed change is looked at with `npm run shot -- <page> --js ...` (one screen, 5 s) or `npm run real-extension`;
   the twin is for the pushed one, on the real site.
4. **Drive it visibly:** `npm run twin:drive -- press "<text>"`, never `window.pilot` calls behind the screen. The driver cannot click native macOS dialogs (the app's "still working, quit?" prompt):
   refresh stops the app's whole process group itself. A bot check is solved by the owner by hand, never by us.
5. **Wait with Monitor, not sleep:** `tail -n 0 -F "<Jobadabra (live test)>/home/logs/app.log" | grep --line-buffered -E "<the lines that matter>"` (`[fill] \S+ answered` (the engine that answered: Claude, OpenAI, Codex), `opened collapsed`,
   `stage .*: the application form`, `account judgment`). At each event say in one line what it shows and decide: progressing, done or stuck. First sign of life is expected within ~20 s.
6. **Read the log before guessing:** timings are in `app.log` (`[extension]`, `[fill]`, `[review]`). A page that looks stale is first a missed redraw (leave the page and come back), then a bug.
7. **After the run:** report what showed, with numbers. Leave the twin running if the owner is still looking; stop it (and remove its worktree) only when asked or when done for good.
Pitfalls found on 9 Oct 2026: `chrome.runtime.reload()` leaves the extension disabled in Chrome 153 (use `refresh`); killing only the `node .bin/electron` shim leaves the real Electron on the ports; a
`//` comment in the middle of a line can swallow the code after it (the knockouts key never reached the app).


## Post-merge check (`npm run twin-check`, 15 Oct 2026)
After merges that touch `extension/` or the fill, one command runs 5 real forms (Ashby, SuccessFactors, Greenhouse, Workday, Lever: pool rows, `desktop/e2e/lib/twin-check.mjs` PLATFORMS) HELD on main, with the grown applicant, and prints one table.
- **Needs the owner's yes in the session's window each time.** `cd desktop/e2e && npm run twin-check` prints the one-line ask (sha, forms, minutes, cost) and starts nothing; `-- --yes` runs it (background + Monitor on its log).
- It runs the rows through `npm run live` (the app's path without Electron: the real extension of this checkout on the real site, the privacy tripwire, the per-site daily limit, never Submit), not the twin's window: one machinery, no second one to keep.
- **Red** on: a fill error (an error line, a thrown error in the app log or the extension's console), a press the safety floor refuses (Submit words, or "Decline/Reject…" as a press), the tripwire, or a drop vs that row's last check (a step less, fewer fields filled). A popup close that says no is shown yellow.
- Reports: `~/Library/Application Support/Job Pilotto QA/twin-checks/<time>-<sha>.json` + `table.md` + each row's `end.png` (the panel picture). Guard: `desktop/e2e/test/harness/twin-check.test.mjs`.
