# Finish the rename: JOB_PILOTTO / jobPilotto / job-pilotto → Jobadabra

> **Verdict:** one PR renames every old-name use (~3,000 uses in 1,229 files) to Jobadabra, with **small fallbacks only where a current user would lose something** (owner's pick, 1 Nov 2026: "Rename all, small fallbacks").
> **Done by a committed map, not a blind replace.** `tools/rename-map.json` names every kind of hit, its step and what stays; `tools/rename-apply.mjs` applies it; a guard test keeps the old name from coming back.

Owner, 1 Nov 2026: "Do we still have JOB_PILOTTO / jobPilotto ... in our app? it should be all jobadabra" · "Put everything in one PR" · "No need 16 PRs" · "We don't need to support any other users running on Job Pilotto" · "All the users are running now already on Jobadabra app version".
Done already: visible name, logo, domain, data folder, repos. This replaces the earlier plan of 16 PRs with readers for both names everywhere.

## What the owner chose

The Jobadabra app users run today still reads four old internal names. The owner picked **"Rename all, small fallbacks"**:

| Name | Treatment in this PR | Why |
|---|---|---|
| Keychain items `job-pilotto.*` + account `job-pilotto` | renamed to `jobadabra.*`; **read new, then old**; write new | a user's Notion/Google/LinkedIn/site-password items stay found |
| Updater asset names | **nothing to do**: releases have been `Jobadabra-*` since 31 Oct 2026 and `desktop/lib/updater.js` already reads `Job-Pilotto-*` for older releases (`tests/test_release_file_names.py` guards it); both stay untouched | an older install keeps finding its update |
| `appId` `app.jobpilotto.desktop` and `productName` "Job Pilotto" in `desktop/package.json` | **stay**; renamed in a later release (parked in Linear) | the microphone permission is tied to the appId; installs already out there update in place |
| "Job Pilotto Safe Storage" (Electron's Keychain item sealing all saved tokens) | **stays** (`app-identity.js` untouched) | renaming it logs everyone out of Notion and Google |

## Inventory (origin/main, 1 Nov 2026)

| Spelling | Files | Lines | What it is |
|---|---:|---:|---|
| `JOB_PILOTTO_*` | 638 | 2,278 | 258 distinct env vars; about 30 also GitHub repo `vars.` / `secrets.` |
| `jobPilotto` | 206 | 1,082 | `__jobPilotto*` page globals and a few local names |
| `job-pilotto` | 296 | 756 | Keychain `job-pilotto.*` + account, header `X-Job-Pilotto`, tmp-dir prefixes, `package.json` name, Sentry/PostHog labels |
| `jobpilotto` | 308 | 995 | DOM `data-jobpilotto-*`, `jobpilotto-fill` ids/classes, `appId`, hosts |
| `Job Pilotto` / `Job-Pilotto` | 85 / 17 | 195 / 60 | prose, `productName`, release asset names |
| File names | 1 | | `docs/job-pilotto-guide.md` |

Reproduce: `node tools/rename-inventory.mjs` (hits per rule) and `--tokens` (every distinct token).

## What changes and what stays

| Kind | Action |
|---|---|
| Prose, comments, docs, test titles, local names, tmp-dir prefixes | renamed |
| Page globals, DOM attributes, ids, classes, events (`__jobPilotto*`, `data-jobpilotto-*`) used only inside the extension package | renamed (the extension ships as one unit) |
| **App ↔ extension contract** (Gitar, #2926: the Web Store extension updates apart from the app): the `#jobpilotto-fill` mark, `data-jobpilotto-hook`, `dataset.jobpilottoFill`, the `jobpilotto:fill` event, the page calls `__jobPilotto{ClickOption,Step,Steps,GuardActive,AuditVisibleFields,FillKnownFields}` and the service-worker call `__jobPilottoBackgroundSessions` | **stay** (map rules `keep-fill-mark`, `keep-extension-*`); flipped in two steps (the extension answers to both names, then the app uses the new one): JOB-199 |
| `JOB_PILOTTO_*` env, `X-Job-Pilotto` header, Sentry release, PostHog `$lib`, `package.json` names | renamed (owner: "Rename to jobadabra" for Sentry and PostHog; charts and error trends break on the switch day) |
| Keychain items and account | renamed, with the fallback above |
| Updater legacy asset names, `appId`, `productName`, Safe Storage | see "What the owner chose" |
| `www.jobpilotto.top` and `*.workers.dev` hosts | **stay**: live addresses the app calls |
| `vars.JOB_PILOTTO_*` / `secrets.JOB_PILOTTO_*` references in workflows | **stay** until mac-07 renames the GitHub variable or secret (the owner's call, one by one); the env key on the left is renamed now |
| Sentry org / project slugs `job-pilotto`, `job-pilotto-app` | **stay**: they name the account on sentry.io |
| Notion pages the e2e suites search for (`Job Pilotto E2E`, `… 2`, `… Brain`, `… Live Test`, `… QA`) | **stay** until the owner renames the page |
| Existing legacy readers (`LEGACY_NAME`, `Job Pilotto app` event source, `Stopped by Job Pilotto`, data-folder migration) | untouched: existing, not extended, not removed here |
| Dated specs and plans under `docs/superpowers/specs|plans` | **stay**: a record of what was true then |
| `GarryOne/…` and `jobadabra/…` repo and owner literals | **go's sweep** (1e, PR 6/7); not touched here |
| rs's files (`hosted/`, `worker/`, 5 workflows) | skipped until rs deletes or moves them |

## The one PR: commits in order (title `[rn] Finish the rename to Jobadabra`)

| # | Commit | Test |
|---|---|---|
| 1 | Spec | – |
| 2 | Map + inventory / apply scripts | inventory exits 0 (every hit has a rule) |
| 3 | Prose and local names | touched named tests + lint |
| 4 | In-page names (extension, app-core, desktop, tests) | app-core and extension named tests |
| 5 | Env vars, header, Sentry and PostHog labels, package names | env and server-route tests |
| 6 | Keychain: new names, read new then old | keychain / credentials / `secret_store` tests with a fake store holding only old items |
| 7 | Guard test: no old name outside the map's `keep` rows | the guard itself |

The PR description opens with this table; review commit by commit.

## Follow-ups (parked in Linear, JOB)

1. Rename `appId` and `productName`: trigger = the owner accepts one more microphone prompt.
2. Remove the Keychain old-name fallback and the updater's `Job-Pilotto-*` names: trigger = 2 stable releases after this PR's release.
3. mac-07 renames the GitHub variables / secrets; then the `vars.` / `secrets.` keeps go.
4. The owner renames the Notion pages the e2e suites search for.

## After the merge (not code)

- **Owner's Mac:** `tools/keychain-copy-to-jobadabra.sh` (dry run), then `--go`, copies the `job-pilotto.*` Keychain items to `jobadabra.*` for the tools and e2e scripts that call `security` themselves; the app and engine read the old name on their own. Item names were checked by exit code only; the real Anthropic admin item is `job-pilotto.anthropic.admin_key` (the docs said `admin-key`: corrected).
- **Sibling repos** `jobadabra-web` (12 files) and `jobadabra-lab` (4 files) still set `JOB_PILOTTO_*` for code that now reads `JOBADABRA_*`: a PR in each, set both names first, then drop the old.
- **mac-07:** GitHub variables / secrets `JOB_PILOTTO_*` (list in the PR); `~/.claude/skills/trello/SKILL.md:85` and six memory notes name `job-pilotto.*` items.

## Progress

- [x] Inventory measured on origin/main (proof: none: `git grep` counts, 1 Nov 2026)
- [x] 1 Spec (proof: none: this document)
- [x] 2 Map + scripts (`tools/rename-map.json`, `rename-inventory.mjs`, `rename-apply.mjs`) (proof: desktop/test/rename-guard.test.js)
- [x] 3 Prose and local names (proof: desktop/test/rename-guard.test.js)
- [x] 4 In-page names (proof: desktop/test/rename-guard.test.js)
- [x] 5 Env, header, labels, package names (proof: desktop/test/rename-guard.test.js)
- [x] 6 Keychain with read-old fallback (`src/secret_store.py`, `desktop/lib/keychain.js`, `credentials.js`) and the one-time copy script (proof: tests/test_secret_store.py, desktop/test/keychain.test.js, tests/test_keychain_copy_to_jobadabra.py)
- [x] 7 Guard (`desktop/test/rename-guard.test.js` runs `rename-inventory.mjs --check`) (proof: desktop/test/rename-guard.test.js)
