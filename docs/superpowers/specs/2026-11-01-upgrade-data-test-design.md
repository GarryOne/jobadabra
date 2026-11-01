# Upgrade + data test (daily, report only)

> **Verdict:** every day, install an old release (N-1, N-2, N-3), let it fill its own data folder with the demo data it ships, update to the build of main, and check that every job, answer and setting is still there. **Report only:** nothing blocks a merge or a beta. Owner, 1 Nov 2026 (sketch §3, "upgrade + data test").

Session `nm`, coordinator mac-07; the Overview card is `to`'s (jobadabra-web-b4).

## Problem
An update that loses or rewrites a user's jobs, answers or settings is the worst failure a desktop app has, and it is the one nothing plays today:
- `desktop/scripts/windows-upgrade-proof.mjs` (25 Oct, weekly `windows-smoke.yml`) proves the *installer*: one uninstall entry, no leftover shortcut, a text file in the data folder is kept. No real data, no Mac.
- `desktop/e2e/suites/updates.mjs` proves which release the updater *offers*; "the install itself (swapping the app) is not run".
- The store changes in place (`src/store.py` ALTER TABLE on open), so a new column or a renamed file is exactly where an old store breaks.

## Behaviour (what runs, in the words of a user's update)
For each old release `R` of the last three (the three newest non-draft, non-beta GitHub releases that have an installer for this OS):
1. **Old release writes its own data.** Install `R`'s packaged app on a clean runner (isolated data folder via `JOB_PILOTTO_DATA_DIR`, never the runner's real one, never port 47111). Fill that folder with `R`'s *own* bundled Python and store code (`<app>/python/bin/python3`, `src/stores/sqlite.py`: `Applications.create`, `set_stage`, `Events.add`, `set_section`, as `mac-smoke.mjs` already runs it against an empty folder), driven by one small seed script that only uses that API subset: about 30 jobs across every stage, events, sections, plus plain-file writes for `profile.md`, `answers.md`, `knowledge.md`, a small `cv/cv.json` and a `settings.json` with every setting kind. The data is in `R`'s format by construction and no fixture has to be kept alive. If a release's API has drifted so the seed cannot run, that row says **seed failed (R)**, a state of its own and never "data lost". (Checked 1 Nov: "Look around first" demo mode is NOT usable for this: it copies read-only demo JSON to a temp folder and can never point at a user store, `desktop/lib/demo.js`.)
2. **Fingerprint** the data folder directly, no app needed: for `data/*.sqlite` one hash per cell (table, primary key, column), so a dropped or renamed column is a loss and an added one is not; for the user's texts (`desktop/lib/store/text-files.js`: profile, answers, knowledge, portrait), `cv.pdf` and `cv/` a hash per file; for `settings.json` and the config files (`desktop/lib/config-text.js`) a hash per top-level key. The lists are read from those files, never typed again.
3. **Update.** Replace the app with the build of main (built in the job, as `windows-smoke.yml` already does for Windows) the way a user's update does it (Mac: replace `Jobadabra.app` in `/Applications`; Windows: the installer with the updater's own arguments, `WINDOWS_INSTALLER_ARGS`), then start it once on the same data folder and let it open the Jobs list (`smoke-screens.mjs`), so every migration the start runs has run, then quit.
4. **Fingerprint again and compare.** Every old row, file and key must still be there with the same value. A change is allowed only when listed in `desktop/scripts/upgrade-expected.json` (a migration that rewrites a value on purpose: `{key, reason, pr}`; `*` matches any text, so one column can be allowed without the table). Anything else is a red line: `lost | changed | new-only` with table, key and the two hashes.
5. **The app opens it.** The new build opens the Jobs list (not the setup wizard) on that folder, through `smoke-screens.mjs`. Counting the jobs the list draws is parked (the data check above already compares every row; the count only adds the renderer).

Per run the result is one row per `R`: `{from, to, ok, rows: {before, after}, lost: [...], changed: [...]}` and a short summary; the job fails (red in Actions) on any loss, nothing else reacts to it.

## Not covered here (and where it lives)
- **The auto-update path itself** (the app downloads the installer from our releases and swaps itself): PR 3 of 3, because it needs the real installer step run against a fake release list (`desktop/e2e/lib/releases-fake.mjs`, as the `updates` suite does) pointing at main's artifact. Step 3 above does the swap by hand until then. Stated on the card, not hidden.
- Secrets in the Keychain (never read); the owner's real data (never used); `jobadabra-web` data (server side).

## Acceptance
1. Unit test of the comparison (`lost`, `changed`, `new-only`, an allowed change from `upgrade-expected.json`, an unknown table): one red case each, and the real pair of fingerprints from a fixture folder is green.
2. A **positive control** in the job: a second compare run on a copy with one row deleted must be red, or the job says so ("the compare does not see a loss") and fails.
3. A daily run on Mac and Windows with N-1..N-3 reads green on main today, or names the loss it found (that finding is a real bug and goes to a GitHub issue, not a patch here).
4. The run publishes its summary for the Overview card (shape below) and links the Actions run.

## Data shape for the Overview card (to)
The workflow's own last run is enough for "last run / cadence" (`upgrade-data.yml`, a `workflow:` card). The run also writes a summary the card can quote as "bugs caught": `{day, os, from, ok, lost, changed}`, published to the site like the other collectors (`/ops/data` kind) only if `to` wants more than the run's colour; asked, not assumed.

## Files
`desktop/scripts/upgrade-data-proof.mjs` (the runner, Mac and Windows), `desktop/lib/data-fingerprint.js` (pure: fingerprint + compare, unit-tested), `desktop/scripts/upgrade-expected.json`, `.github/workflows/upgrade-data.yml` (daily, started by the site Worker's tick or GitHub's cron as backup), test `desktop/test/data-fingerprint.test.js`.

## Non-goals
Blocking anything; Linux; restoring the old app after the update; testing the Notion store (SQLite only, the default); comparing UI screenshots.

## Progress
- [x] History read: windows-smoke/mac-smoke, updates suite, windows-upgrade-proof (25 Oct), demo.js, app-identity data files (proof: none: reading only, findings are in this spec)
- [x] Choices (mac-07 for the owner, 1 Nov): a) the build of main is built inside the job, b) order: pure compare, then the runner on N-1..N-3, then the auto-update swap, c) extends the existing Windows upgrade workflow; all in `jobadabra` (desktop) (proof: none: a scope choice relayed by the coordinator, 1 Nov 2026)
- [x] PR 1/3: `data-fingerprint.js` + unit tests + positive control (expected-change keys take `*` anywhere, so a migration is allowed for one column only) (proof: desktop/test/data-fingerprint.test.js)
- [x] PR 2/3: `upgrade-data-proof.mjs` + `upgrade-seed.py` + `upgrade-data.yml` on Mac and Windows with N-1..N-3 (proof: desktop/scripts/upgrade-data-proof.mjs); the seed was run with the bundled Python of the three real releases on 1 Nov (30 jobs, 366 entries each)
- [ ] PR 3/3: the auto-update path (fake release list, real installer step)
- [ ] Merged, first daily run read
