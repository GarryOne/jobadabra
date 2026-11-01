# Fresh-install smoke of what users download (report only)

Owner, 1 Nov 2026, five report-only test methods; this is #5: "daily fresh-install smoke". Verdict: **once a day, download the newest stable release's installer from GitHub, install it on a clean Mac runner and a clean Windows runner and open the app. It runs with no commit behind it, so it finds what moved under us (runner OS, a bad asset), and blocks nothing.**

## Problem
Every build is smoke-tested once, when it is built (`desktop.yml`: `mac-smoke.mjs`, `windows-smoke.mjs smoke`). The Windows app is built and installed again every Monday (`windows-smoke.yml`, mode `full`, 4 green scheduled runs since 5 Oct). But nothing installs **the file a person downloads today**: the Mac smoke is by hand only (`mac-smoke.yml`, last run 10 Oct), and a published asset that was deleted, truncated or re-uploaded, or a runner image that moved under it, is found by the first user. That is the "tests the app when nobody changes code" case (synthetic).

## Behaviour
- One workflow, `fresh-install-smoke.yml` (replaces `mac-smoke.yml`, same Mac job, one `tag` input kept for by-hand runs), two jobs, **Mac** and **Windows**, both report only.
- Which build: the newest **stable** release (`gh release view`, no tag: the one the Download link serves), or the `tag` input (empty = that). Mac: `Jobadabra-mac-arm64.zip` (installed) and `Jobadabra-mac-arm64.dmg` (the Mac Download link, checked to exist); Windows: `Jobadabra-windows-x64.exe`; a stable release without one of them is a red run (the user-facing link is broken).
- What runs is what already exists: `mac-smoke.mjs` (signature, bundled Python, Keychain round trip, native terminal, the Jobs list opens) and `windows-smoke.mjs <exe> smoke smoke` (silent per-user install, bundled Python, Credential Manager round trip, the Jobs list opens). Nothing is rewritten.
- Red = the job fails; the result line goes to the job log (no `$GITHUB_STEP_SUMMARY`, `tests/test_no_step_summaries.py`) and the screenshots are kept 14 days. Nothing blocks a merge or a beta (`tests/test_red_main.py`: ignored, report only).
- GitHub's cron is the start (`23 3 * * *`); the Worker timer replaces it when the bot Worker has moved to `jobadabra-web` (GitHub cron is unreliable, memory `feedback-github-cron-unreliable-use-worker`).

## Cadence by risk (owner, 1 Nov 2026: "their frequency should be different")
| Scenario | Likelihood of breaking without our change | Runs |
|---|---|---|
| The stable installer a user downloads still installs and opens, Mac and Windows | Low-medium: a runner image or OS update, a bad re-upload; cheap to check (about 2 min Mac, 4 min Windows, free on a public repo) | **Daily** (new) |
| A fresh build of main installs and opens (Windows) | Low: code changes show up in the build's own smoke | Weekly, as today (`windows-smoke.yml`, unchanged) |
| A fresh build of main installs and opens (Mac) | Low: every beta and release builds and smokes it | On each build, as today (`desktop.yml`); nothing new |
| The installer is notarized and Gatekeeper accepts a downloaded copy | Not testable yet: the Mac build has no Apple Developer ID (`RELEASE.md`) | Parked until the Developer ID exists |

## Not covered
Mounting the `.dmg` (only its existence is checked); the quarantine flag a browser download sets (no browser on the runner); beta releases (only the stable one is what users download); the in-app update swap (parked JOB-194).

## Acceptance
1. The workflow starts on its cron and by hand with an empty or explicit `tag`; the Mac and Windows jobs install the stable release's generic assets and print their result line.
2. A run on a tag with no generic Mac or Windows asset is red with "No <asset> in <tag>", never green.
3. `tests/test_workflow_runners.py` lets `fresh-install-smoke.yml` (not `mac-smoke.yml`) use macOS; `tests/test_red_main.py` classifies it as report only; nothing else reads the old file name.
4. First by-hand run after the merge is green on both OSes (or names what it found).

## Progress
- [x] History read: windows-smoke.yml (5c5f50a, 9dfe94e), mac-smoke.yml (10 Oct, 5 runs), the two smoke scripts, `desktop.yml`'s build-time smoke (proof: none: reading only, findings are in this spec)
- [x] PR 1/2: `fresh-install-smoke.yml` (Mac + Windows, daily, report only), the two test updates, this spec (proof: tests/test_workflow_runners.py)
- [ ] PR 2/2 (`jobadabra-web`): a row on the Synthetic Monitoring tab and the Overview card for the upgrade test and this smoke
- [ ] First by-hand run read
