# Releasing Jobadabra

> **In short:** **every night at 04:00 Zurich**, if the app changed, a build is made, **every end-to-end suite runs on it, and when all pass it becomes the stable release**
> (friends' apps offer it, the website serves it, their Notion and GitHub runs follow by themselves). Red or no build: nothing changes. A build on demand
> (`gh workflow run desktop.yml`) is only a pre-release to try; promote it with **`tools/release-stable.sh`** (which runs the same gate).
> **A beta by hand, in one shot: `tools/beta-release.sh`** (= `gh workflow run desktop.yml -f beta=true`): always builds, then the nightly's gate approves it for beta testers or leaves it a pre-release.

## 1 · Channels

| Channel | Who gets it | How it's made |
|---|---|---|
| 🔨 **Build** (a GitHub pre-release) | nobody until approved; 🧪 **Beta** once the gate approves it: people who switched the beta on | nightly at 04:00 Zurich (cron: 02:00 and 03:00 UTC, the step lets the one at 04:xx/05:xx Zurich go on) if anything the app bundles changed since the last release, or on demand: `gh workflow run desktop.yml` (always builds). Not per push (`.github/workflows/desktop.yml`) |
| ✅ **Stable** ("Latest" on GitHub) | friends' apps + the website's Download buttons | **the nightly pipeline** (below), or you with `tools/release-stable.sh` |

### The nightly pipeline (`desktop.yml` → `e2e.yml`)
1. **04:00 Zurich:** `desktop.yml` builds Mac + Windows if the app changed since the last release that reached someone (a stable, or a build approved as beta; a build that failed its gate does not count, so the next night tries again; tests alone do not count), as a pre-release. GitHub may start a scheduled run late.
2. **When the build finishes**, `e2e.yml` runs **every suite on the build's own commit** (`desktop/e2e/plan-run.mjs`; only for the nightly build: one made by hand is for trying).
3. **When all suites pass and `build.yml` is green on that commit**, its `promote` job runs `tools/release-stable.sh` (the Windows installer must be the build's own). Friends get the update by morning.
4. **A red suite, a red `build.yml`, a failed Windows job, or no build:** nothing is promoted; stable stays; the next night's build carries the fixes.
There is **no waiting period** and no telemetry check: the end-to-end journey is the gate. Dry run of step 3 for a release: `gh workflow run promote-dry-run.yml -f tag=<tag>`.

**Beta approval is per platform, each on its own (owner, 6 Oct 2026):** one release and one version for both. Shared checks (`tools/release-checks.sh`: unit suites,
additive schema) + Mac/Linux suites green → `Beta-approved:` (Macs get it). Shared checks + every Windows suite green → `Beta-approved (Windows):`
(`tools/beta-approve.sh --windows`, from `e2e-windows.yml`; Windows apps get it). Each app reads only its own line: neither platform waits for the other's suites.
Apps older than 0.5.15 still read the old rule (Mac line, and on Windows both lines).

Version numbers: plain `X.Y.Z` since 0.5 (no alpha/beta suffix: the channel says how proven a build is). `desktop/package.json`
holds the start (e.g. `0.5.0`); each build counts the patch up (`0.5.1`, tag `desktop-v0.5.1`). To start a new version, change it there.
Older builds are `0.4.0-alpha.N`; the updater and the release tools still order them correctly.

## 2 · Release a stable build

1. Push to `main`. The build takes ~20–30 min: Mac `.dmg` + `.zip`, then the Windows installer; it's published as a pre-release.
2. Try it yourself: download it from GitHub Releases (or wait for your own app to offer it once it's stable).
3. Promote it:
   ```sh
   tools/release-stable.sh                              # the newest build
   tools/release-stable.sh desktop-v0.5.3      # a specific one
   ```
   **A beta that both platforms approved is promoted as it is** (owner, 12 Oct 2026, the manual hot path): the same tag, the same version, the same build. The script reads the
   release notes, and when `Beta-approved:` (Mac) and `Beta-approved (Windows):` both name this build's commit it asks for no fresh run. `FRESH_E2E=1 tools/release-stable.sh <tag>`
   asks for one as before. The canary and a staged rollout come with more installs (about 5 now); the daily auto-promote and the e2e promote job keep the rules below.
   Without both approval lines (a build the beta gate never approved), the rule below applies.

   The **end-to-end journey** is the gate, and it runs here rather than on every push: the script needs a green run of *that build's commit*, no older than two
   days. With none, it **starts one on the tag and waits for it** (about 15 minutes), then decides by its result; a red one stops the promotion. (A schedule
   runs it twice a day; a push runs only the suites whose files changed; see `desktop/e2e/README.md`.) `E2E_NO_START=1` (the daily canary auto-promote, which
   cannot start a run) never starts one and accepts the newest run on main instead. `SKIP_E2E=1 tools/release-stable.sh` overrides it for a hotfix while the
   journey itself is broken: say why in the release notes. The decision itself is `tools/e2e_gate.py` (tested in `tests/test_e2e_gate.py`).
   It refuses a build whose Windows installer isn't there yet — but that guard is weaker than it looks, and the
   release it promotes is the one `/releases/latest` (what `desktop/lib/updater.js` reads) points at:
   - `desktop.yml`'s Mac-only fallback copies the **generic** `Job-Pilotto-windows-x64.exe` from the last good release
     when the Windows job fails, and the guard greps that generic name. Before promoting, check the release has its own
     versioned `Job-Pilotto-<version>-x64.exe` and that its size equals the generic one (30 Sep 2026: alpha.131–133 had
     no installer of their own and still looked promotable).
   - Pushing twice in a row leaves a **draft** behind: GitHub replaces a superseded *pending* run in the
     `desktop-release` group (`cancel-in-progress: false` still drops a pending one), and `tools/prune-releases.sh`
     deliberately skips drafts, so they linger until deleted by hand.
4. Done. Friends see **"Update to 0.5.3"** in the menu at their next start or within 6 hours.

### Canary auto-promote (retired as the release path)

> Replaced by the nightly pipeline above: `canary-promote.yml` has no schedule any more and is only run by hand to print its decision. The rule below still describes `tools/canary_promote.py`.

> Daily, `.github/workflows/canary-promote.yml` → `tools/canary_promote.py` promotes a build **by itself** when all hold:

- ⏱️ the **canary**: the oldest test build newer than stable, out **≥ 48 h** (kept up to 7 days; one rule in
  `canary_promote.py`, `prune-releases.sh` and the app, pinned by `tests/fixtures/canary_builds.json`)
- ✅ `build.yml` green on its commit
- 🩺 no **new** problem for its version: no `telemetry` issue lists it (unless stable's version is listed too), and,
  if its Chrome extension version changed, no open `fill-failure` issue names the new extension version
- 📈 **proof it was used and worked** (app reports, `GET /telemetry/version` on the website): silence never passes
  - used: health reports on that exact version on **≥ 2 days**, first → last **≥ 48 h**
  - worked: **≥ 5 successful runs**, failure rate ≤ stable's **+ 5 points** (stable without data: ≤ 10 %)
  - clean: **0** crash / run_failed reports for it
  - fresh: last report **< 24 h** old
  - no key or site down → wait
- then it runs `tools/release-stable.sh <tag>`; the job summary says what it decided and why (with the numbers)
- failed for sure (red CI, a new problem issue, a crash / run_failed) → the canary is **dropped** (release page deleted, tag kept)

> 🧪 **Your app's trial** (menu → **Get Test Builds**, once): it installs the canary and **stays on it** for 2 days
> ("Test build 0.5.3 — trial 1 of 2 days" in Check for Updates and Settings → Diagnostics), not every newer build.
> Promoted, dropped or 7 days old → it offers the next canary.

- 🚪 **Escape hatch:** menu → **Update to the Newest Test Build Now…** installs the newest build and leaves this
  canary's trial (no more offers until the canary changes). Friends (stable) are unaffected.

> 🔑 **Secret to set once:** repo secret `JOB_PILOTTO_TELEMETRY_KEY` = the site's stats key
> (same value as the Worker's `STATS_KEY`, Keychain `job-pilotto.site.stats_key`). Without it, it always waits.

| | |
|---|---|
| **Turn on** | `gh variable set JOB_PILOTTO_AUTO_PROMOTE -R GarryOne/jobadabra --body on` |
| **Stop it** | `gh variable set JOB_PILOTTO_AUTO_PROMOTE -R GarryOne/jobadabra --body off` (or delete the variable) |
| **See the decision** | `python3 tools/canary_promote.py --dry-run` (changes nothing; with `JOB_PILOTTO_TELEMETRY_KEY` set to see the usage numbers) |

While off, it still runs daily as a dry run. Promoting by hand (above) keeps working either way.

## 3 · What updates on a friend's side

| Part | When | How |
|---|---|---|
| **App** (Mac/Windows) | they click "Update to …" | `desktop/lib/updater.js`, the same way on both: download, quit, put the new version in place, reopen. Mac unpacks the `.zip` and swaps the `.app`; Windows waits for the app to exit, installs quietly (`/S` — no wizard) and reopens it |
| **Python pipeline, Chrome extension** | with the app | bundled in it; the extension reloads itself when the app is newer |
| **Notion schema** | next app start | `desktop/lib/schema.js` adds missing columns and choices, removes `retired` columns |
| **Always on** (their GitHub repo) | next app start | the app writes its own tag into their workflows (`@desktop-v…` + `code_ref`) |
| **Telegram bot** on their Cloudflare | ⚠️ not yet | deployed once; not redeployed on updates |

The app, its Notion schema and the GitHub runs always move together, so a run never writes a column the workspace
doesn't have. Code that adds a column still survives an older workspace (`cron_runs._without_missing`).

## 4 · Checklist before promoting

- [ ] You used this build (or the code it was built from) for a while: no errors in Recent activity.
- [ ] A schema change? The new columns are in `config/notion_schema.json`; removed ones are in `retired`, and nothing reads them.
- [ ] A workflow change? Old tags still work: the app pins friends' repos to *their* version, not yours.
- [ ] Release notes read well for a user (they're generated from the commit messages).

## 5 · If a release is bad

- **Stop it spreading:** promote the previous good build again: `tools/release-stable.sh desktop-v0.5.2`.
  Apps only offer *newer* versions, so friends who already updated stay on the bad one until a fixed build is promoted.
- **Release list:** stable releases stay; only the newest 3 test builds keep a release page (`tools/prune-releases.sh`, run after each build). Tags are never deleted.
- **Fix forward:** push the fix, let it build, promote it.
- **Notion:** retired columns are deleted with their values, so retire only columns nothing reads (the run's page
  keeps the details).

## 6 · First install for a friend

1. Send the stable download: **Mac** `…/releases/latest/download/Job-Pilotto-mac-arm64.dmg`,
   **Windows** `…/releases/latest/download/Job-Pilotto-windows-x64.exe`
   (`https://github.com/GarryOne/jobadabra/…`).
2. Mac: drag it to **Applications** (updates need it there). The first open shows **"Jobadabra" Not Opened** (the app
   isn't notarized yet): click **Done** (never Move to Bin), then **System Settings → Privacy & Security** → scroll to
   *"Jobadabra" was blocked* → **Open Anyway** → confirm. Once only. (Right-click → Open no longer works on recent macOS.)
   Opened from the disk image by mistake? The app offers **Move to Applications** itself.
   Keychain prompt: **Always Allow** (login password). It comes back **once after each update** until the app has an
   Apple Developer ID: macOS ties keychain access of apps without an Apple team ID to the exact build. Builds still share
   one self-made signature (`MAC_SIGN_P12` secret, Keychain `job-pilotto.mac-sign.*`).
3. The setup wizard does the rest: keys, Notion, CV, Profile; Always on is optional.

<details><summary>Not done yet</summary>

- Redeploy a friend's Cloudflare Telegram bot when its code changes.
- Apple Developer ID ($99/year, the owner's call): notarized, so no "Open Anyway" on first install.
</details>

## 7 · Product brain (daily recommendation)

One action a day, in the **Jobadabra Brain** Telegram bot: ✅ Explore it → a plan in Notion → ✅ Approve plan. Nothing
is explored, built or published without a tap. Workflow `product-brain.yml` (05:00 UTC), plumbing `tools/product_brain.py`,
buttons `api/brain.js` (private repo `jobadabra-web`), decisions in Notion **🧭 Product Brain · Decisions** (Project Hub → 🧭 Strategy).

<details><summary>Setup (once)</summary>

- Notion: connection **Jobadabra Brain** (internal), shared with the Decisions database only → GitHub secret `NOTION_BRAIN_TOKEN`.
- Telegram: @BotFather → new bot → GitHub secret `BRAIN_BOT_TOKEN`; your chat id → `BRAIN_CHAT_ID`.
  The same token and id + a random `BRAIN_WEBHOOK_SECRET` as Worker secrets of `www` (private repo `jobadabra-web`), then
  `setWebhook` to `https://www.jobpilotto.top/api/brain/telegram` with that secret.
- Repository variable `BRAIN_DATABASE_ID` (set). Cost: about $0.10–0.30 a brief (Sonnet, capped turns).
</details>

## 8 · Windows: what is Mac-only today

Every release builds, installs and smoke-tests the Windows app (`desktop.yml`'s `windows` job: silent per-user install,
the bundled Python, the Credential Manager, the in-app terminal, the wizard's screens, and PyAV decoding a generated
WAV). `build.yml` runs the desktop suite on Windows on every push, so a Windows-only break fails the push that caused
it — the fast gate is what `tools/pre-push-check.sh` reads before letting another commit stack on top. And
`windows-smoke.yml` does the same build-and-install every Monday with **no release attached**: if it goes red while
nothing was pushed, the runner image or the bundled native pieces moved, not our code.

These parts are still the Mac's alone. Read this before promising a PC user feature parity:

| Part | On Windows | Why |
|---|---|---|
| Chrome tab control (`desktop/lib/form-tab.js`) | the app cannot list, focus, close or reload Chrome's tabs by itself | it drives Chrome through AppleScript. A form panel that died is now reloaded by the page's own panel first (the extension), so only the *fallback* is missing: the app says to reload it yourself rather than guessing |
| The extension folder's keystrokes | the install card gives the PC its own sentence | a PC's folder dialog has no "Go to Folder" (⌘⇧G) |
| Apply with Claude | the session runs in the app's own terminal (node-pty, smoke-tested); only the "Open filled form" tab hand-off falls back to opening the posting | AppleScript again |
| Google sign-in → Always on | not handed over: connect Google in the repo itself | `desktop/lib/google-keys.js` reads the Mac's Keychain only |
| Interview transcription | decoding is tested on Windows; the recogniser is not | its models are a ~520 MB download, so CI never runs them |
| Both installers | unsigned: SmartScreen "More info → Run anyway" (PC), "Open Anyway" (Mac) | no certificate yet — the owner's call |

**Nobody has used the app by hand on a PC.** The first Windows user should install it, finish the wizard, run a
search, open a posting, fill it from the extension and open Settings → Connections; `Settings → Diagnostics` has what
to send back. Until then, what is proven is what the smoke test asserts, and nothing more.
</details>
