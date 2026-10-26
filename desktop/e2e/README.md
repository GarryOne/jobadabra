# End-to-end tests

The **real** Jobadabra app, driven by Playwright on a throwaway profile, in suites that each start from their own state and can run at the same time.

| Suite | Starts from | Covers | Time |
|---|---|---|---|
| `wizard` | an emptied Notion page | the first-run path: key, Notion workspace, CV, strategy, finish | ~2.5 min |
| `jobs` | a set-up install, its own jobs and runs reset | Actions, Recent activity, jobs check on fixture feeds, scoring, a **slow AI** (live log, no silence), Find employers, Focus/Jobs/Actions layout | ~4 min |
| `interviews` | a set-up install, its own interview and job rows reset | the library on dummy Notion rows (order, outcomes, search, filter, open, link/unlink, delete), the recorder's consent rule, a transcript **imported through the page and reviewed for real**, a **failing AI** (clear message, no half-written row), review again (guard and replace), insights | ~4 min |
| `calendar` | a set-up install, its own job and interview rows reset | meetings from the Job Tracker and from recordings on the month grid, a busy day, the agenda, month arrows, opening a job, **two time zones** (Tokyo, Honolulu) | ~3 min |
| `settings` | a set-up install | every Settings section, the AI engine panel with each engine chosen | ~30 s |
| `personas` (**manual**) | a set-up install | one of two fictional users per run (a data analyst in Austin, a marketing manager in São Paulo; `E2E_PERSONA` picks, else they alternate by day): nothing Swiss or EU in the UI, digest or Notion; the visa flag follows citizenship and places; their search regions, Google Jobs places and currencies | ~7 min |
| `employers` | a set-up install, its own employer rows and runs reset | Find new employers on a candidate list of every kind (good board, empty, wrong roles, dead feed, duplicate, excluded, manual watch): statuses, quality order, Employers & Sources rows, the run row's counts, a second run, the crawl's source list, a Sonnet judge | ~1 min |
| `focus` | a set-up install + dummy applications in every stage written to Notion | Up next order and buttons, every number checked against the Notion rows (`lib/focus-data.mjs`), Edit target, Done/Skip, Insight, a fresh account | ~3 min |
| `apply` | a set-up install + 4 kit jobs it writes | the real **Chrome extension** on fixture forms: Apply click → fill from the kit, CV, legal boxes left, AI answers highlighted, late field, multi-step, unknown widget, Submit never touched | ~3 min |
| `mailreading` (**watched**) | the AI key only: no app, no Notion, no browser | whether the model still reads the Gmail check's emails right: 16 invented emails with a known answer go through `src/ai/mail.py`'s own prompt (`tools/mail_eval.py`); a rejection, offer, invitation, security code, receipt or vendor alert read wrong fails at once, and 85% of the rest must be right | ~15 s, about a cent |
| `activity` | a set-up install, its own run rows reset, schedule off | every task on Actions (one row, an end, plain words, a log without keys/emails/paths, no Notion row left Running) and Actions → Runs: the filters, "View all runs" (Actions → Runs), a finished run's result card, a run read only from Notion | ~4 min |
| `activityfailures` | the same, on its own Notion page, in parallel | what goes **wrong**: the AI answering **429, 500, 401, no credit** and **never answering** (`lib/ai-proxy.mjs` modes), a spend-limit pause, a double click, a Gmail check queued behind a search, **quitting mid-run**. Shared steps: `lib/activity-steps.mjs` | ~5 min |
| `failuresnotion` | split from `activityfailures` (6 Oct 2026), own Notion page, in parallel | Notion busy (429), an HTML error page, the connection gone, a refused Save: a clear end in words |
| `notion-real` | the one suite on REAL Notion (P7, 9 Oct 2026), nightly gate only; borrows failuresnotion's token and page (`notionPage` guard), empties it at start and end | an app on this Mac's store connects the test workspace and moves its data there: every record once, the kit, record, interview and file read back from Notion's pages, the same screens |
| `failureschannels` | split from `activityfailures` (6 Oct 2026), own Notion page, in parallel | the Telegram digest and a bot that refuses it, the Gmail check, a revoked Google sign-in |
| `cardstates` | its own demo window on fictional runs (`fixtures/activity-states.json`): no Notion, no AI | every Recent activity state: plain words (no raw exception), the log folded, partial Tailor counts and status, the three Gmail answers, Gmail connected / disconnected now, and a mocked live run (Queued → Running with Live and Jump to latest → Completed / Failed). The same states as the viewer `node e2e/activity-states.mjs` (`SHOTS=<dir>` for pictures) | ~1 min |
| `quality` (**nightly**) | a set-up install, a known compensation target written into its Profile | whether the Jobs check's output is *right*: 11 golden postings with a known truth (`fixtures/golden/`): facts exact, a duplicate collapsed, ranking, scores stable (±8, one job in nine may stray), no `undefined`/raw JSON in any text, no job text in the logs, and a Sonnet judge (`lib/factjudge.mjs`) for invented facts in the score reasons (one text in nine may slip: model noise has an allowance, facts, duplicates, ranking and leaks have none) | ~3 min, ~$0.3 (the app runs on Sonnet; `E2E_APP_MODEL=claude-haiku-5-5` for a cheap run) |
| `pool` | nothing: the real engine against a stand-in website (`tools/pool_e2e.py`), a fictional photographer in Geneva | the shared pool: Find new employers sends each find and dead end at once, Search for jobs every feed and board it read, only what changed, nothing when switched off, never the search's own words; the crawl leaves out software firms and feeds where no photographer found a job; employers and job sources ranked for people like them; the central list checked hourly by its publish time | ~10 s |
| `visitread` | nothing: the extension's own page functions in a real Chromium on fixture pages, then the engine | "Read the jobs on this page": cards read as seen (title, employer, place), the next page of the same list, a stop at the last page and at a bot check, the pages of one visit kept as one feed, an employer page's job data read without fetching. Not covered: the popup click and Chrome's access prompt | ~10 s |
| `recorded` | nothing: the real extension in headless Chromium, recorded AI answers, offline (`recorded/*`, `lib/page-replay.mjs`) | layer 2 of the applying tests: each recorded page case of a fixed site still works; one step per case. Runs with every e2e (gates, a gate by hand) and on a push touching `extension/` or `recorded/` |
| `visitsauto` | the REAL extension (a copy talking to a stand-in app on a free port) in Chromium, fixture job lists over HTTPS | "Find jobs using your browser" from the Actions card: an unmarked page left alone; a marked tab without the one-time permission waits and reads nothing; a marked tab on an allowed site read by itself over its pages, reported as done and closed (the all-sites grant is simulated: Chrome cannot grant it from a script) | ~15 s |
| `foryou` | its own demo window: no Notion, no AI | what the pool tells a person: "Where people like you get interviews" and its way into Jobs, a job source's "people like you" rate, the "Few new jobs" chips, and every recommendation recorded as shown / taken / dismissed in fixed words (`app.log` area `advice`) | ~20 s |
| `strategy` | a set-up install, its own jobs reset, two small fixture boards | a change to the roles, places or companies to skip reaches ⚙️ Search settings (Notion), `config/search.json` and the next Jobs check, whether it was made in the app or on the Notion page; a region word ("Ticino") and a level ("junior") written on the page decide which postings the next check keeps; accepting a strategy change keeps what was edited on the page meanwhile; a reconnected app keeps the real settings and the same page | ~5 min |

## When each suite runs (cadence)
A suite exports `cadence` (`lib/plan.mjs` decides, `plan-run.mjs` plans the CI run):
- `always` (the default): every automatic run, including the three-a-day schedule.
- `nightly`: the nightly release gate, and manual runs. `quality` is this: it costs about $0.3 a run.
- `watched`: never in a schedule or the nightly gate: only on a push that touches the suite's files or its `watches`, and when a person names it. For a suite that costs real AI money and judges one piece of code: `mailreading` runs only when `src/ai/mail.py`, its cases or its script change.
- `manual`: never by itself; a person names it (`gh workflow run e2e.yml -f suite=personas`, `npm run all -- --only personas`). `personas` is this: kept, not deleted.

The paid AI-judge steps (`employers`) also run only in the nightly gate and in manual runs (`E2E_FULL=1`); on a Mac they always run.

## Running them all on this Mac
`npm run all` runs every suite that is not manual, one after the other, and prints one table. `-- --only jobs,quality` runs exactly those (even a manual one), `-- --skip wizard` leaves some out,
`-- --manual` adds the manual ones, `-- --parallel 3` runs three at a time (each suite then needs its own Notion token; without the flag, `run-all` runs up to 4 at once when every chosen suite has one, longest first). Secrets come from the environment, else from the Keychain
(`job-pilotto.e2e.anthropic_key`, `.notion_token`, `.notion_token_<suite>`).

```
cd desktop/e2e && npm install
node suite.mjs settings            # one suite, about half a minute (npm run settings)
node suite.mjs wizard              # or jobs, interviews, focus
E2E_NOTION_TOKEN=ntn_… node suite.mjs settings     # runs on Claude Code: no Anthropic key on a Mac
```

## A skipped suite is not a pass
A suite without its secrets prints `⚠ SKIPPED, nothing ran` (`lib/skip.mjs`). Under `npm run all` it exits 3 and the table shows `–` and "skipped (not run)", never `✓`.
Set `E2E_REQUIRE_SECRETS=1` (CI on this repo, release gates) and a skipped suite fails the run. Without it a bare `node suite.mjs <name>` still exits 0 (a fork's pull request has no secrets).

## How a suite gets its state
- **Each suite has its own Notion test page and connection**, so suites never touch each other's data: `E2E_NOTION_TOKEN` (wizard), `E2E_NOTION_TOKEN_JOBS`, `E2E_NOTION_TOKEN_INTERVIEWS`, `E2E_NOTION_TOKEN_CALENDAR`, `E2E_NOTION_TOKEN_SETTINGS`, `E2E_NOTION_TOKEN_FOCUS`, `E2E_NOTION_TOKEN_EMPLOYERS`, `E2E_NOTION_TOKEN_PERSONAS`, `E2E_NOTION_TOKEN_APPLY`, `E2E_NOTION_TOKEN_ACTIVITY`, `E2E_NOTION_TOKEN_STRATEGY`. A suite without its token is skipped in CI; on a Mac it falls back to the wizard's token (one suite at a time).
- **The workspace is built once and kept.** The wizard suite empties its page and builds it from scratch every run. The others find their page already built and **seed the app in about 5 seconds** with the app's own calls (`saveSecret`, `notionConnect`, `saveSettings`), not the wizard. A suite whose page is empty builds it once with the real wizard path (`lib/wizard.mjs`).
- **A suite resets only its own data** (the jobs suite empties its job rows and run rows), never the workspace.
- Dummy data without an AI call: `lib/notion.mjs` (`createRow`, `rows`, `pageBlocks`) and `lib/interview-data.mjs` (row builders and the pure checks, tested in `test/`). `lib/steps.mjs`: independent steps (one failure never hides the others), captured external links, answered `confirm()`. A suite can export `env` (e.g. `TZ`) for its app, and the AI proxy has `setMode(...)` for a failing AI (`no-credit`, `server-error`, …).
- Files: `suite.mjs` the runner · `suites/*.mjs` the steps · `lib/context.mjs` secrets, Notion guard, feeds, proxy, launch · `lib/seed.mjs` the fast seed · `lib/wizard.mjs` the real first-run path · `lib/layout.mjs` screenshots + checks · `lib/activity.mjs` + `lib/ai-proxy.mjs` the slow-AI scenario.

## Adding a suite (a file, nothing else to edit)
1. Create `suites/<name>.mjs`: `export const name = '<name>'; export const minutes = 15; export async function run(ctx) { … }`. The CI matrix is built from the files in `suites/` (`node suite.mjs --list`).
2. Start with `await ensureSetUp(ctx)` (from `lib/seed.mjs`) for a set-up install in seconds, then `ctx.run('what a person can now do', async () => {…}, {needs: ctx.needs})` per step; `snap`/`visit`/`finish` from `lib/layout.mjs` for screenshots and layout checks.
3. A suite that writes to Notion needs **its own Notion test page and connection** (suites share nothing): add `E2E_NOTION_TOKEN_<NAME>: ${{ secrets.E2E_NOTION_TOKEN_<NAME> }}` to the `env:` block of `.github/workflows/e2e.yml` and the secret to GitHub. Without the token the suite is skipped in CI and falls back to the wizard's page on a Mac.
4. Reset only your own data, keep the isolation rules below, put dummy data in through the Notion API (`lib/notion.mjs`) rather than the AI where you can.

## The quality suite for another profession
`E2E_QUALITY_PERSONA=photographer npm run all -- --only quality` runs the quality checks (facts, ranking, duplicates, stability, invented facts, CV match) for a fictional commercial photographer in Zurich:
`fixtures/golden-photographer/` holds her CV, her Profile (`profile.md`, which the engine reads instead of the test page's Profile: `JOB_PILOTTO_E2E_PROFILE_FILE`), 12 postings with a known truth and her CV-match data.
It costs about $0.3 a run, like the default (the SRE). It is how scoring is proven for a profession that is not IT.

## What a strategy returns, without the app
`tests/test_matching_matrix.py` is the fast proof (seconds, no Notion, no AI): strategy inputs (Swiss cities, regions and region words, levels, remote, skipped titles, accents) against fixture postings, with the kept and dropped lists written out; a known gap (`Asia`) is an expected failure so it stays visible. The `strategy` suite proves the same words through the real app and the Notion page.

## The employers suite
- **Personas.** `E2E_EMPLOYERS_PERSONA=nurse npm run all -- --only employers` runs the same suite for a band 6 nurse in Manchester: `fixtures/feeds/employers-nurse/` replaces the SRE boards of the same names (same counts, same expectations), so the scout, its Notion rows and the judge are proven for another profession. The default is the SRE in Zurich. `tests/test_e2e_employers_fixtures.py` proves both without the app, in seconds.
- Fixtures: `fixtures/feeds/employers/` (the boards, `scout_seeds.json`, `person.json` = the fictional SRE in Zurich the scout judges for, via `JOB_PILOTTO_LOCATIONS_FILE`, so the test workspace's own search settings cannot change the outcome). A suite may export `env` for the app.
- The expected outcomes are also proven without the app or Notion in `tests/test_e2e_employers_fixtures.py` (seconds).
- `lib/judge.mjs`: a Sonnet judge (no `temperature`) that says per added employer whether it suits the person; a missing or unreadable verdict is a failure, never a pass. `lib/employers.mjs` holds the pure row/run-line checks, tested in `test/employers.test.mjs`.
- It empties only the Employers & Sources and run rows of its own page. Never run it on the wizard page while another suite uses that page (the fallback is for one suite at a time).

## What is real, what is faked
| Part | How |
|---|---|
| Wizard, settings, CV upload | the real UI; the native file dialog is replaced (`pickFile`) |
| Notion | real, in a **dedicated test workspace**: an empty page "Job Pilotto E2E" and a connection that sees only it |
| AI | real, Haiku for every step (cheap: about $0.25–0.40 a run) |
| Jobs and employers | local fixture feeds (live feeds change daily and would make the test flaky) |
| Gmail | skipped (a mock of the Google endpoints may come later) |
| Apply | the real extension on a local fixture form; Submit must never be clicked |

## Using your own CV locally
`E2E_CV=/path/to/cv.pdf node suite.mjs wizard` uses a real CV for a local run. It is only read from that path and sent to the test Anthropic key and the test Notion page; it is never copied into the repo (public). CI always uses `fixtures/cv.pdf`.

## Secrets
- `E2E_ANTHROPIC_KEY`: a dedicated Anthropic key with a small monthly spend limit. **CI only**: a Mac never uses it.
  What it pays is counted per suite (`lib/ai-meter.mjs`: the app under test through the AI proxy, the judges through `lib/model.mjs`) and reported to /ai-cost as
  `e2e-app` and `e2e-judges`. Only scheduled runs ask the model live; every other CI run replays an answer it has seen (`E2E_AI_REPLAY=1`, cache `.ai-cache/`,
  kept between runs by actions/cache) and pays only for new requests. CI judges run on Haiku (`E2E_JUDGE_MODEL`), except in the quality suite.
- `E2E_NOTION_TOKEN`: the test connection's token. Never use your own Notion.
Both live in GitHub (Settings → Secrets → Actions) and, for local runs, in the macOS Keychain
(`job-pilotto.e2e.anthropic_key`, `job-pilotto.e2e.notion_token`). Never in code.

## Files
`lib/app.mjs` launch, close, file picker · `fixtures/cv.pdf` a fictional CV (`make-cv.py` rewrites it)

## Seeing what a run did (6 Oct 2026)
- **The Playwright HTML report** (owner's choice, 6 Oct 2026): every suite runs inside Playwright's test runner (`lib/report.mjs` → `report/suite.spec.mjs`, the suite's logic
  in `lib/suite-main.mjs`); each step is a report step with a screenshot when it ends, the failure's screenshot, the trace (opens inline) and `app.log`/`engine.log`.
  Local: `artifacts/<suite>/report/` (`npx playwright show-report artifacts/<suite>/report`). CI: a blob per suite, merged by the workflow's `report` job into the
  `e2e-report` artifact; the `report` job's log prints its link, `/admin/e2e/run/<run>/report` (the site serves it, `admin/e2e-report.js`).
  Exit codes are the suite's own (skip 3, fail 1). `E2E_REPORT=0` runs a suite directly, without Playwright's runner.
- The runs page `/admin/e2e` was dropped on 15 Oct 2026 (it redirects to `/admin/self-healing`); only the report links above stay. Each suite still uploads an `e2e-view-<suite>` artifact (`steps.json` + traces) for download.
- **No step summaries** (owner, 26 Oct 2026: "let's remove all the summaries"): a run's page shows only jobs, annotations and artifacts; each suite's log ends with its steps and their shared cause (`lib/runner.mjs`). Guard: `tests/test_no_step_summaries.py`.
- **A failed suite keeps a Playwright trace**, `trace-<suite>.zip` in its `e2e-artifacts-<suite>` artifact (`-2` after a relaunch): every action with a screenshot strip,
  the page before and after (inspect it like DevTools), console and network, grouped by step. Unzip the artifact, drag the trace onto https://trace.playwright.dev (runs in
  your browser, uploads nothing) or `npx playwright show-trace trace-<suite>.zip`. Recorded always, written only on failure; `E2E_TRACE=0` turns it off. The extension's
  Chrome (the apply suite) is not traced, only the app.

## What the test app reports (the rule: it never alters live data)
| Channel | In the journey |
|---|---|
| Your telemetry store (`/telemetry`: machines, crashes, runs) | **off**, always |
| PostHog (the usage funnel) | **off**, always |
| Sentry | **off locally; on in CI**, tagged `environment: e2e`, one fixed anonymous id `e2e` |
| Employer pool sharing, the app's recipe/alias reports | **off** (the test profile is seeded with `telemetry: false, shareEmployers: false`) |

`launch()` sets `JOB_PILOTTO_E2E=1`, and refuses to run unless the app says in its own log `reporting is off: the end-to-end journey`. The last
journey step checks that nothing was queued to send. (2 Oct 2026: before this, test profiles passed `JOB_PILOTTO_TELEMETRY=0`, which the app read as
"on", and nine test runs counted as machines on `/telemetry`.)

## The apply suite (the real extension, fixture forms)
- **Browser:** Playwright's Chromium loads a *copy* of `extension/` whose built-in app address (`127.0.0.1:47111`) is rewritten to a free port (`lib/extension.mjs`
  `copyExtension`); the app under test listens there (`JOB_PILOTTO_PORT`). So it runs next to your own Jobadabra and can never pair with it. CI: `npx playwright-core install chromium`.
- **Forms:** `lib/forms.mjs` serves them over HTTPS; Chromium maps `boards.greenhouse.io`, `jobs.lever.co`, `e2e.recruitee.com` to that server and every other host name
  is unresolvable (the suite asserts no other host was asked for). Each form logs a click or submit event on Submit; any is a failure.
- **Apply click:** the app runs `open -a "Google Chrome" <url>`; a stand-in `open` first on the app's PATH hands the URL to that Chromium. macOS only.
- **AI:** the app's own AI calls go to the test proxy (`JOB_PILOTTO_E2E_AI_BASE_URL`, honoured by `lib/ai-free.js` in a test run), which answers the one open question with a fixed text: no cost.
- **Judgements** are pure functions (`lib/applycheck.mjs`), each tested against a wrong input (`test/applycheck.test.mjs`). `E2E_LATE_MS=40000` renders the Lever field too late: that step must fail.
- **Found by this suite (2 Oct 2026), fixed in `extension/review.js`:** the panel counted native fields only, so a required custom widget it could not read left "Ready to submit" on screen. It now lists it as left for you until its own state changes (`worker/test/panel-widgets.test.js`); the last step guards it.

## Activity suite: what it relies on
- **Failure modes:** `proxy.setMode('rate-limit' | 'server-error' | 'invalid-key' | 'no-credit' | 'hang' | 'pass')` answers the engine's AI calls the way the real API does (bodies in `FAILURES`, unit-tested in `test/ai-proxy.test.mjs`). `JOB_PILOTTO_E2E_IDLE_MS` (honoured only with `JOB_PILOTTO_E2E`) shortens the app's 15-minute silence limit so a hung AI is tested in under a minute.
- **`ctx.relaunch(env, between)`** kills the app the hard way (a crash or power cut) and starts it again on the same profile; `between(profile)` runs while it is down.
- **Words and leaks:** `badSummary()` and `leaks()` in `lib/activity.mjs` (unit-tested) judge a run's summary line and log: empty / `undefined` / raw JSON / stack trace, and any key, token, email or home path.
- **Fresh posting ids every run** (`setFeed`): a posting an earlier run saw has a Job Matches row in Notion and is not new. The postings' titles mention both "Site Reliability Engineer" and "Data Analyst", so they match whatever the page's Search settings are.
- **A Mac shares one page between suites** that have no token of their own; another session rebuilding it mid-run breaks the run ("database not found"). Use `E2E_NOTION_TOKEN_ACTIVITY` (Keychain `job-pilotto.e2e.notion_token_activity`).
- **Isolation:** with `JOB_PILOTTO_E2E` the engine ignores this Mac's Keychain (`src/secret_store.py`); before that, a test "Gmail check" read the owner's real mail (2 Oct 2026).

## What CI runs, and when (the test key's AI credit is shared, so this is deliberate)
- **After the nightly build (04:00 Zurich):** every suite on the build's commit; all green → the `promote` job makes the build stable (RELEASE.md). **Three scheduled runs a day on main (09:47, 13:47, 17:47 UTC):** every suite, run on a new commit; on an unchanged one it takes a second and a third look (each a different seeded path, and only the suites that declare `varies`, with the AI review on) and then stops until the next commit (at most 3 runs per commit); otherwise the AI screenshot review runs only when `desktop/renderer`/`desktop/e2e` changed or a finding waits. All of it is decided in `plan-run.mjs`. **A manual run:** every suite. A manual run may name some: `gh workflow run e2e.yml -f suite=jobs,activity`.
- **A push to `main`:** runs no e2e. Suites run only in the release run's gates (`desktop.yml`: Test · Mac + Linux, Test · Windows), on the three scheduled runs, or by hand. (`lib/plan.mjs` still knows how to pick suites from changed files, for a manual run.)
- The UI-heal loop only follows scheduled and manual runs.

## Why `activity` is two suites
One suite took about 10 minutes, the slowest by far (the others 1 to 4). It is split into two that run at the same time, each on its own Notion page, and the waits were cut:
the app's history poll (`JOB_PILOTTO_E2E_HISTORY_MS`), its resume wait (`JOB_PILOTTO_E2E_RESUME_MS`) and the watchdog's silence limit (`JOB_PILOTTO_E2E_IDLE_MS`) are shortened in the journey only
(`desktop/lib/e2e-timing.js`), and the AI proxy's refusals ask for an immediate retry.

## What the UI loop's issues carry
`desktop/e2e/triage.mjs` (the step of `ui-findings.yml`, the producer, after every e2e run) reads every suite's artifacts and files one issue per problem. An issue has:
- **Severity, kind, view, suite and source as labels** (`severity:high`, `kind:layout`, `view:focus`, `suite:activity`, `source:ai-review`), so the issue list can be filtered. **`version:<x.y.z>`** is the app version of the tested code: the newest release that is an ancestor of the tested commit (the body's build line then reads `after 0.5.0 · main @ <sha>` when the commit is between releases, `0.5.1 · main @ <sha>` when it is that release). An issue seen on another version gets that version's label too, so the list shows which versions a finding affects.
- **What severity means (the owner's definition, 3 Oct 2026; high widened 4 Oct).** **High** = it blocks the user's journey (a task cannot be finished, a wrong result or false status, a raw error, lost data), **or** the experience is so bad they must work around it at a real cost: they lose real time, or must ignore wrong or noisy information to get through. **Medium** = it confuses them for a moment, or is bad UX that is cheap to get past (vague or repeated wording, clipped text, misalignment). **Low** = barely noticeable. **The AI review plays a job seeker** (find, apply, track, interview), not a design critic: it reports only what would stop them, mislead them, show raw technical text or waste their time, and never style opinions (emoji vs icons, spacing, colours), scrollbars, narrow-window differences or polish; at most 3 findings a page, usually none. The verdict pass applies the same "job seeker test". **Wording is not reported at all** (grammar, an awkward sentence, terminology: low value, owner 4 Oct 2026) unless the words mislead. **Low findings are not filed at all** (`normalize` drops them, whatever the detector): the issues that are opened are medium and high, each worth a person's fix. The AI review must also state an `impact` (what the person loses, gets wrong or has to do); a finding without one is dropped, and it is shown in the issue as "Why it matters". Enforced in code, not only in the AI prompt: an AI finding is high only for a wrong app (`functionality`, `error-shown`) or when it fills the `workaround` field with what the person must do and why it costs them (`cappedSeverity`; the field is shown in the issue); low findings are not filed; a failed test step is medium (the release gate is red anyway while a suite fails; a person's `confirmed` says it blocks someone); the probe grades a dead or broken control medium and a missing spinner low until the wait is 3 s or more; tiny text and a tall table cell are low; accessibility: only axe's critical impact is filed (medium), the rest is low and not filed. Before this, 18 of the 21 "high" issues were test steps and 3 were wording or clipped text; none blocked anyone, and low findings were thrown away, so every issue read medium.
- **The screenshot** (uploaded to a tag `ui-evidence-<run>` under `ui-loop/<fingerprint>/`, an image link that outlives the Actions artifact; a tag, not a branch, so GitHub shows no "recent pushes" banner), **the app's state** at that moment as a table, **where to look**
  in the code, **how to reproduce** (`node suite.mjs <suite>`), and, for a failed step, the step's message, its failure screenshot and the last lines of the app's and the engine's logs.
- **Repeats are recognised even when the AI words them differently** (same view and kind, alike words): the issue gets a "Seen again in run …" comment with that run's screenshot.
- **"Not seen in run …"** when the page was photographed and reviewed again and the finding did not come back, with the new screenshot (also on the open fix pull request: its "after"), and the label `not-seen-latest`.
- **Closing:** an issue already marked `not-seen-latest` is **closed** (reason completed, with a comment naming the build) by the next run that clears it too: two clean runs in a row. A failed-step issue is cleared only by a run of its suite with NO failure at all (a different earlier failure hides the later steps); a sidebar / brand / badge issue by a run whose layout check found nothing in the chrome (`app-chrome`). A finding that comes back files a new issue.
- **Which build was tested:** every issue and every Seen again / Not seen comment carries `Build tested: <app version> · <branch or tag> @ <sha7> (<event> run)`, read from the `tested.txt` each run records. The app version (e.g. `v0.5.3`) is the `desktop-v*` release tag on that commit, looked up when the issue is filed; a commit with no build yet shows only the commit. A reader can tell at once whether a finding is about code that has since changed.
- **`confirmed`** (a label a person adds): a finding that is real is ready for a fix without a second sighting. `wontfix-auto` closes a false positive for good; `needs-human` parks one.
A fix pull request shows the finding's screenshot as "Before" and promises the "After" when a later run no longer sees it.

## The loop is two workflows on two clocks
- **`ui-findings.yml` (the producer), after every e2e run: four a day** (the release run's two gates, filed once per platform, and 09:47, 13:47, 17:47 UTC). It only files and updates issues, with the evidence above. No AI fix.
- **`confirmed` issues are never auto-closed by "not seen"** (#94: a raw API error showed only while the API was failing, and closed itself once the limit was raised). Only a fix closes them. The fixer also regenerates `CODEMAP.md` itself before its tests, so a fix that adds a file is not lost to the up-to-date test (#99).
- **DOM detectors (3 Oct 2026), no AI:** technical text shown to a person (severe `error-shown`), what was moving and what is clipped on purpose (facts for the AI review), window errors over the whole suite (`<suite>-journey`: uncaught exceptions, unhandled rejections, console errors, failed loads of the app's own files), and accessibility by axe-core (serious and critical only, one issue per rule listing the pages, view `a11y`).
- **The verdict pass (off by default).** With the repo variable `JOB_PILOTTO_FIXER_VERDICTS` = `on` and nothing ready to fix, the fixer reads one open finding seen on one build (probe, layout check or AI screenshot review; not a failed test step) (`ui-verdict-prompt.md`: no edits) and answers `false-positive` (closed `wontfix-auto`), `real` (labelled `confirmed`, so the next run fixes it) or `needs-human`. It spends AI credit, so it is the owner's switch.
- **`ui-fix.yml` (the fixer), once a day at 05:30 UTC (07:30 Zurich in summer).** `pick.mjs` chooses the most critical finding that is ready: **score = severity (high 3, medium 2, low 1) times its
  sightings in the last 7 days, doubled by `confirmed`**; two sightings this week, or `confirmed`, are needed; only kinds a UI change can fix. Claude Code (Sonnet 5, at most 50 turns, about
  $0.5 to $1.5 an attempt) fixes it in `desktop/renderer` with a test first; a guard and the desktop suite must pass; ONE pull request opens, with the finding's screenshot as "Before". At most 3 are open at once.
  By hand: `gh workflow run ui-fix.yml`.
Between the two a person can add `confirmed` or `wontfix-auto` to an issue: the fixer works on a curated list.

## The interactions suite (does a press DO something?)
Screenshots cannot show a button that does nothing. `suites/interactions.mjs` presses the safe controls of every page and records what happened (`lib/interact.mjs`):
- **Recorded:** page change (text, structure, expanded state, location), the calls the window made to the app (`lib/e2e-ipc.js` wraps `ipcMain.handle` only when `JOB_PILOTTO_E2E` is set: channel, start, ms), signs of work while it ran (disabled, `aria-busy`, spinner, changed label), errors thrown.
- **Findings** (`source: interaction-probe`, warning → medium issue, one per control, with a screenshot `ui-probe-<view>-<n>`):
  `dead-control` (no change, no call) · `silent-control` (it changed only hidden parts: the person gets no answer, #409) · `expand-broken` (an `aria-expanded`/`summary` that did not toggle) · `no-loading-state` (a call ≥ 500 ms with no sign of work) · `console-error`. The fixer may address the first three (`FIX_KINDS`).
- **Never pressed:** anything that deletes, sends, signs in, leaves the app, runs a task or can spend AI credit (`isSafe`: word list, `danger` class, `data-command`, external links). The option already chosen is skipped.
- **Artifacts:** `interactions.json` (every press: effects, calls, loading, errors) next to `ui-findings.json`.
- **Secret:** `E2E_NOTION_TOKEN_INTERACTIONS` (a test page of its own); without it a local run falls back to the wizard token. No AI is called.
- **Tests:** `test/interact.test.mjs` (a fixture page with one broken control of each kind, in real Chrome), `desktop/test/e2e-ipc.test.js`.

## Varying the path: seeded, replayable (`lib/variation.mjs`)
The suites follow scripted paths on fixed fixtures, so running them again re-walks the same path. To find different bugs each run, **scheduled, top-up and manual runs take a seeded random path** (`E2E_SEED=<run id>`): the interactions suite visits the pages in another order, presses the controls in another order (from a wider pool than its 40-control cap), and sizes the window from six real sizes (1024x700 up to 1680x1000).
- **The seed is printed, saved as `seed.json` and written into every issue it produced** ("Variation: seed N, window WxH. Replay: `E2E_SEED=N node suite.mjs interactions`").
- **No seed (or 0) is the FIXED path.** The release gate (on both platforms, since 7 Oct 2026) and the stable canary run fixed, so a build is judged on a path that does not move under it.
- Plus one deterministic pass: `visitNarrow` (`lib/layout.mjs`) visits focus, jobs, actions and settings at **1024 px**, where the sidebar becomes an icon rail (under 1180 px). Its findings are warnings (they file issues, they never fail a journey or hold a release).
- **The apply suite varies its data and timing too** (`lib/forms.mjs` `varyForms`): free-text answers from hazard lists (apostrophes, quotes, `&`, `<tags>`, accents, emoji, a newline, a 900-character answer; short answers stay short and the long one stays long), the greenhouse questions in another order, the late-rendered Lever field after 0 to 1200 ms. The kit is changed before anything reads it, so the suite's expectations stay right; the seed and the picks are in the issue.
- **Notion as people edit it by hand** (`HAND_EDITS` in `lib/focus-data.mjs`, a step of `focus`): an unknown stage, an empty title, a 2,000-character note, other scripts and emoji; Focus must still load with no error text or window error, and its numbers must still be Notion's.
- **Where the person lives** (`placeOf` in `lib/variation.mjs`): a seeded `interactions` run starts the app in another time zone (window and engine) and language (`--lang`), so the truth and layout checks see dates and numbers as a person there would. The fixed path stays in Zurich.
- Not varied yet: the strategy's starting state. (Windows runs its own e2e: `e2e-windows.yml`.)
- **The jobs feeds vary their shape too** (`lib/feeds.mjs`, 5 Oct 2026): titles with accents, a gender tag and an emoji, or one long enough to wrap; and a `crowd` of 150 wrong-role postings that the rules must drop before any AI call.
- **Which runs vary:** scheduled and manual runs. The release gate, the soak top-ups (their three green runs must be comparable), the by-hand gate (`gate_tag`) and the stable canary walk the fixed path.
- **A by-hand gate** (`gh workflow run e2e.yml -f gate_tag=desktop-v0.5.3`): a build started by hand is never gated by the nightly path; this runs the same suites on that tag's commit, then the promote job approves it for beta (soak on) or promotes it (soak off).

## Release candidates, the soak and the stable canary
The e2e run is also the gate of the release path (decisions: Notion Decision Log; summary in `docs/HOW-IT-RUNS.md`):
- **`target_ref`:** a manual run can test another commit (a release tag) with THIS workflow file: an old tag's own `e2e.yml` does not know newer inputs. `plan-run.mjs` resolves the tag to its commit; `tested.txt` records it.
- **Runs are named by what they tested:** the release gate lives in the release run (`desktop.yml`, "Nightly beta" / "Beta by hand", jobs `Test · Mac + Linux / <suite>`; `Gate <sha>` and `Beta E2E tests <sha>` before 7 Oct 2026), `Beta E2E tests <tag>` (a gate by hand, `gh workflow run e2e.yml -f gate_tag=<tag>`), `RC soak <tag>` (a top-up on a release candidate, `canary-promote.yml`, no paid AI judge, findings filed) and `Stable canary <tag>` (`stable-canary.yml`, fixed path, no judge, **never filed as issues**: red opens one `stable-canary` issue). `tools/canary_promote.py` counts the release run's Mac + Linux gate and the `RC soak` runs for gate 4 (three green runs over 24 hours or more, no red among the last three, no open blocking finding).
- **What blocks a build:** a suite step that fails, a layout-check `severe` finding, or an AI finding of kind `functionality` / `error-shown` that is already a real open issue (seen twice, or `confirmed`) (`block-check.mjs`, `blockers()`). A clipped or overlapping label is `medium`, never `high` (the review prompt defines the three levels; it used to rate the same defect both ways).
- **A suite on a persistent shared Notion page** starts from a store that forgot the last run (`lib/forget.mjs`): the page keeps the previous run's end state, and the connect-time Jobs check stores postings for it (the `strategy` flip-flop, 3 Oct 2026).

## Ranking: the most important findings are always on top (`rankIssues`, after every run)
Every open UI-loop issue carries one label `priority:P0` to `P3`, recomputed after each run (only changed ones are edited), and ONE pinned issue, **🔥 Top issues (ranked automatically)**, lists the top 12 with score and when each was last seen (⚠️ after 7 days).
- **P0** a high, wrong-app finding (kinds that keep a build from beta) seen twice this week, or confirmed by a person. **P1** score 6+, **P2** score 3+, **P3** the rest. Score = severity (high 3, medium 2, low 1) x sightings in the last 7 days, x2 when `confirmed`.
- Parked issues (`needs-human`, `wontfix-auto`) are not ranked. Stale ones close by themselves: two clean runs of their page (see "Closing" above).


## What the owner's hand closures taught the Finder (4 Oct 2026)
- **A person's "closed as not planned" is a lesson.** `classify` (the stats) counts it as a false positive with or without `wontfix-auto`, and the weekly Finder self-review reads its comment as the reason (the "not seen in two runs" rule is not a judgement).
- **Test artifacts are not findings.** The review prompt names the demo data (made-up names, slug titles, "not connected" services); the journey detector ignores the test profile's undecryptable secrets (`safeStorage`).
- **One finding, one issue across platforms.** A Windows finding that matches an open Mac issue (or one a person rejected) becomes an "Also seen on Windows" comment (`macTwin`); a Mac issue closed as fixed does not count, so a regression still files.
- **A failed step that only ran out of time goes to the verdict pass** (`TIMEOUT_FAILURE`), which may answer `harness` (the test, not the product).

## Noise guards: money and issues (4 Oct 2026)
- **An empty answer is the right answer.** The review prompt says `{"findings":[]}` is correct and welcome and forbids inventing or padding a problem.
- **At most 3 new AI-review issues per run** (`capNewAi`), highest severity first; repeats and other detectors are not capped.
- **The noise breaker** (`noiseTripped` in `lib/plan.mjs`, used by `plan-run.mjs`): when 50 % or more of the (at least 6) AI-review issues filed since `NOISE_SINCE` were judged noise (rejected, duplicate, harness) rather than real (fixed or confirmed), the AI review is skipped, so no tokens are spent, and the run says why. To resume after changing the rules, move `NOISE_SINCE` forward in that file.

## The menu at the smallest window height (4 Oct 2026)
- **Why:** the owner shrank the window to its minimum height (640 px) and could not reach the bottom menu items; the column scrolled, but with its scrollbar hidden and inside a drag area, so nothing showed it. The Finder never looked at that height, and the AI review was told to ignore sidebar nitpicks.
- **Finder:** the narrow visit now uses the app's real smallest height (640 px, `main.js` minHeight), and the deterministic layout check (`lib/uicheck.mjs`) flags a menu control that is cut off with nothing to scroll (`unreachable-control`) or whose scroll area shows no scrollbar (`hidden-scroll`). Both are medium.
- **Product:** the menu list (`.nav-scroll`) scrolls on its own with a thin visible scrollbar and takes the wheel; the brand and the bottom buttons (Settings, plan, feedback, theme, search) stay in view.

## UI findings: noise versus real (owner, 4 Oct 2026)
- **Not every UI problem is noise.** Real: the person cannot navigate or reach a control, menu item or page; needed content is cut off, covered or unreadable; controls overlap; the screen looks broken, at any supported window size (smallest 1024 x 640). Noise: style and consistency opinions, wording, small spacing, polish, anything that costs nothing (time, clarity, confidence).
- The AI review and the verdict pass apply the same test; scrollbars and narrow windows are no longer banned outright (the hidden menu scrollbar was a real bug).

## The verdict pass's comment (4 Oct 2026)
`lib/verdict-comment.mjs` lays the comment out: a GitHub alert banner per verdict (✅ real, 🚫 not a bug, 🧪 test problem, 🙋 needs a person), **Why**, **What a person should check** (needs-human only), an **Evidence** table of the file:line references, and **What happens next**. The model writes the verdict word, `Why:` and (for needs-human) `Check:` lines with full paths. The first line is a hidden marker, `<!-- ui-loop-verdict:<word> -->`, which the loop's own code reads (the verdict count, the fixer ignoring loop comments); the weekly self-review reads the Why section.

## Is the Finder too restrictive? Three answers (4 Oct 2026)
1. **Raised but not filed.** Every run's log (ui-findings) lists what the filters cut, with why: low severity, no stated impact (the AI review's own shape rules, `parseFindingsDetailed`, record it in `ai-findings.json` → `dropped`), over the 3-new-AI-issues cap, or matching a closed false positive. No extra AI cost: the AI already returned them. A real bug that is missing should show up in that table.
2. **Plant what the owner finds.** The recall benchmark (`lib/recall.mjs`) now has 18 plants (3 of them serious: a calendar month that lost a day, a Failed run with every step ticked, a Completed run with a failed step); `menu-hidden-scroll` and `menu-unreachable` reproduce the owner's cut-off menu at a short window. Each bug the Finder misses and the owner finds becomes a plant, so it is tested for good.
3. **Sweep sizes and themes.** `sweep` (`lib/layout.mjs`, in the `interactions` suite) runs the deterministic checks on 8 pages at 1024x640, 1440x900 and 1920x1080 and in both themes (5 combinations), with no screenshot and no AI; findings are warnings, told once with the size and theme they were seen at.

## Environment failures and repeats in one run (5 Oct 2026)
- **A step that fails on the environment** (an HTML error page instead of JSON, a dropped connection, Notion busy: `lib/environment.mjs`) is **tried once more** by the runner. Failing twice, it is marked `environment` and listed in the run's log, **never filed** (#266). AI refusals are not environment: `activityfailures` injects them on purpose.
- **One problem told twice in one run** (same page and kind from the AI review, other words: #270 and #271) is **one issue**: the most severe stays, the others are listed in its detail (`mergeSameRun`).

## Wrong results, checked exactly (5 Oct 2026)
- **Truth checks** (`lib/uicheck.mjs`, kind `wrong-result`, filed **high**): a page that contradicts itself. A month grid must hold every day of its month once, in order (#120, #122); a run's status pill and its steps must agree (#104). They run wherever the layout check runs (every visited page, the size and theme sweep). A new truth check blocks a release only once it is a real open issue (seen twice or confirmed).
- **Screen against source** (`lib/truth-data.mjs`, a step of `jobs`): every scored job in the Jobs list is its Job Matches row with the same score, and no row scored 50+ is missing from the list.
- **Recall now plants serious bugs** too, so it measures whether the Finder catches a wrong result, not only a broken look.

## Notion failing on purpose (5 Oct 2026)
- **`lib/notion-proxy.mjs`**: a pass-through stand-in for the Notion API, like the AI proxy. `ctx.notion.fail(mode, {times, writes})` with `rate-limit` (429), `server-error`, `unavailable`, `html` (an HTML error page instead of JSON), `hang`, `offline` (connection refused); `ctx.notion.pass()` ends it. A suite opts in with `export const notionProxy = true`; the app (`desktop/lib/notion.js`, `files.js`) and the engine (`src/notion/client.py` `api_base`) use it only with `JOB_PILOTTO_E2E` and `JOB_PILOTTO_E2E_NOTION_BASE_URL`.
- **`activityfailures`** runs a Jobs check while Notion is busy, answers HTML, and while the connection is gone: a clear end in words, no raw HTML or JSON, nothing left Running.
- A step that breaks things on purpose passes `{faults: true}` to `ctx.run`: it is never retried or filed as an environment failure, since handling the broken answer is the product's job.

## Judge before filing, and measure the judge (5 Oct 2026)
- **Before any issue opens**, a run's new findings (at most 3, most severe first: `lib/prejudge.mjs`) are judged in one Claude session (`ui-findings.yml`, `prejudge.mjs`), with the verdict pass's own rules. `false-positive` and `harness` are **not filed**: the run's log lists them and the pinned **🧹 Judged noise before filing** issue (`noise-register`) remembers them, so the same finding is dropped next time without a judgement (delete its entry to file it after all). `real` is filed `confirmed`, `needs-human` is filed parked, each with the verdict as its first comment. Over the cap, without AI credit or with the switch off, findings are filed as before and `ui-verdict.yml` judges them later. Switch: `JOB_PILOTTO_FIXER_VERDICTS` = `on`.
- **The verdict audit** (`verdict-audit.mjs`, Saturdays in `finder-review.yml`, no AI): five random verdicts of the week in one `verdict-audit` issue, each with a 👍 right / 👎 wrong box. The next audit closes it and reports the score, so the judge's accuracy is measured, not assumed.

## Telegram and Gmail in the journey (5 Oct 2026)
- **`lib/telegram-fake.mjs`**: a fake Bot API (`export const telegram = true`). The engine (`src/telegram.py`), the app (`desktop/lib/telegram.js`) and the bot code (`worker/src/index.js`) send there in a test run (`JOB_PILOTTO_E2E_TELEGRAM_BASE_URL`). `activityfailures` reads the digest a person would receive (`digestProblems`: header, no technical text, every promised job listed, under 4096 characters) and makes Telegram refuse it (bot blocked).
- **`lib/google-fake.mjs`**: a fake Google (`export const google = true`) with three of the mailreading eval's invented emails and a fake sign-in; `src/sources/google.py` `e2e_url` routes to it in a test run. `activityfailures` runs a real Gmail check on them, then one with the sign-in revoked.
- **The engine gets the stand-ins too.** Its environment is a whitelist (`desktop/lib/pipeline.js` `pipelineEnv`): the Notion, Telegram and Google base URLs (and the fake Google sign-in) are passed on only with `JOB_PILOTTO_E2E`. Before this, the Notion stand-in only saw the app's own calls.
- **The code review reads every product commit**: each run starts where the last review that ran ended (its `code-review` artifact) and carries the commits the 20-commit cap left out; every 4 hours.

## A Workday-shaped form (5 Oct 2026)
`apply` fills a form written the way Workday writes them (`FORMS.workday`, host `e2e.wd3.myworkdayjobs.com`): opaque ids, labels tied only by `aria-labelledby`, `aria-required`, a list button instead of a `<select>`. The kit's answers and the person's details must be filled, the list-button question left for the person by name, Submit untouched.

## One failed step never hides the rest (5 Oct 2026)
A suite that exports `keepGoing = true` (activityfailures, activity, focus, settings, interactions; calendar and interviews use `independent()`) records a failed step and runs the next one (`lib/runner.mjs`); the suite still fails at the end. Setup steps the others need pass `{critical: true}` and still stop it. Why: one outdated step hid fifteen later ones, twice in one day. The Finder still files the first failed step and lists the later ones under it.

## Regressions, flaky steps and the owner's corrections (5 Oct 2026)
- **Regression:** a new finding that matches an issue a FIX closed (a commit said it fixes it, or the fixer merged) is labelled `regression`, gets a comment naming the old issue, and is P1 at least (`fixedBefore`).
- **Flaky:** a failed-step issue whose suite passes on the same commit it failed on is labelled `flaky`, gets a comment, and is ranked P3: the product did not change, so the test is the problem (`flakyOn`).
- **Corrections:** `reversals.mjs` reads the repository's issue events: a person reopening an issue the loop closed as noise, removing `confirmed`, or closing a confirmed issue as not planned. Each becomes a lesson, with the person's words, appended to the verdict pass's prompt, the judgement before filing and the weekly Finder self-review (`lib/reversals.mjs`). The loop's own events never count.

## How well the loop does: five more numbers on /self-heal (5 Oct 2026)
`lib/loop-quality.mjs`, published with the snapshot every 3 hours: **escape rate** (Bug Tracker rows "Caught by e2e: No - gap" of all judged, 30 days; needs the Bug Tracker shared with the "Job Pilotto Brain" Notion connection, variable `BUG_TRACKER_DB`), **mutation catch rate** (the latest `mutation-result`), **verdict accuracy** (the owner's ticks in the last 4 audits), **regression rate** (`regression` per defect closed by a fix) and **flake rate** (`flaky` of all failed-step issues). Each says "not measured yet" with the reason until it has data.

## Real forms from the fill log (5 Oct 2026)
`tools/fixture-from-fills.py` reads the extension's fill log (the Agent Runs that `tools/fill-failures.py` reads) and writes `desktop/e2e/fixtures/real-forms/<board>-<hash>.json` for each run that left a required field: the labels and a kind per field (text, textarea, select, checkbox, widget), never a value, link or contact detail. `apply` serves each as a form (`realPage`) on its board's host and requires the extension to fill the person's details, list every one of those fields as left for them by name, and leave Submit untouched. Each field it failed on must now be filled or listed for the person by name: never skipped in silence. Review the files before committing them. First 5 (5 Oct 2026): sponsorship and visa dropdowns, in-person and background questions, school results, time zone, nationality, a GDPR box and a references question, from real Greenhouse and other forms.

## How a finding was found (replay.json)
Every suite writes `replay.json` next to its findings (`lib/replay.mjs`, `writeReplay` in `lib/artifacts.mjs`, called by `suite.mjs` before the app closes): the run type (scheduled, release gate, by hand, local),
the path (`fixed`, or the seed), the window, theme, time zone and language, the commit, the steps it took (name, passed or failed, seconds) and, for the interaction probe, the pages in order and the
controls pressed. Every issue the loop files then shows it as **How it was found**: a table, the exact command (`cd desktop/e2e && E2E_SEED=<n> node suite.mjs <suite>`, or no seed for the fixed path), the
folded steps and probe path, and the same facts as one hidden `<!-- replay: {…} -->` line a script can read (`parseReplay`). The producer's run summary adds up the paths a run walked
(`finder-run-summary` artifact), so "which paths find bugs" has data. An older artifact with only `seed.json` still says its seed and window (`replayFromSeed`).

## The loop teaches itself (5 Oct 2026)
- **Detectors under watch** (`lib/breaker.mjs`): a detector wrong in 4 of its last 10 judged outcomes (the `resolution:` labels; 6 judged at least) has all its findings judged by the verdict pass before an issue opens, and a finding that is not judged (the verdict pass is off, or over its cap of three) is held, not filed. The window slides, so a detector that improves earns direct filing back. The AI-review noise breaker in `lib/plan.mjs` is the older, global one.
- **Learned test mistakes** (`lib/signatures.mjs`): three issues closed as `resolution:fp:harness` with the same normalised error text become a signature the producer drops without a model. The list is one pinned issue (label `harness-signatures`), not code; a real fix closing with the same text removes the signature. Delete an entry in that issue to unlearn it.
- **The judge's exam** (`lib/judge-exam.mjs`, `judge-exam.yml`): the eleven planted findings in `fixtures/judge-exam/` (five real, six false, each with its code excerpt as of its build and a known answer) go through the verdict pass every Sunday and are scored; the rate and the real bugs dismissed or false alarms believed are on `/self-heal`. It costs about ten judgements, so it is off until `gh variable set JOB_PILOTTO_JUDGE_EXAM --body on`. To add an item, copy a folder, write `finding.json` (with `expect`: real, false-positive or harness) and an excerpt of the code at the tested build.
- **Bug Tracker rows from CI** (`lib/tracker-write.mjs`, `tracker-sync.yml`): a planted bug no detector caught (a `detector-miss` issue, written by the producer) and a bug a person reported on GitHub that the Finder had not (written when it closes) become Bug Tracker rows with the replay command. Needs the secret `NOTION_BRAIN_WRITE_TOKEN` (an integration with insert rights on the tracker) and the variable `BUG_TRACKER_DB`; without them nothing is written.
## No Anthropic key on a Mac: the e2e runs on Claude Code (owner, 5 Oct 2026)
**The e2e key is for CI only.** On a developer's Mac no suite loads, reads or spends an Anthropic key; the cost is the plan's fixed price. This is independent of the AI engine the developer chose in their own app.
- **The app under test** runs on **your Claude Code** (`claude` signed in): the seed verifies it and chooses it the way Settings → Connections does, with a placeholder key saved (`lib/engine.mjs` `DUMMY_KEY`, never valid). It is slower: each AI call starts `claude`.
- **Every judge and the explorer** (`lib/judge.mjs`, `lib/fit.mjs`, `lib/factjudge.mjs`, `suites/explore.mjs`, the CV match check in `quality`) ask through `lib/model.mjs`: `claude -p` on a Mac, with flags that drop your MCP servers, skills and settings (a bare call loads about 106k tokens; this one about 400), the API in CI. The mail eval (`mailreading`) runs the engine the same way.
- **Steps that need the AI proxy in front of the app** (a refusal, a delay, silence, a canned answer: the activity suite's failure and concurrency steps, the whole `apply` suite) switch to the API engine **with the placeholder key** (`ctx.withApi(fn)`, or `export const engine = 'api'`): the proxy answers before anything reaches Anthropic, so it costs nothing.
- **The wizard suite** picks the Claude Code choice on a Mac; CI types the key, so both paths stay tested. The product's own wizard is unchanged.
- **How it is enforced:** `testKey()` is empty on a Mac whatever the environment holds; `run-all.mjs` never reads the Keychain item `job-pilotto.e2e.anthropic_key`; `E2E_AI_ENGINE=api` is refused on a Mac; `test/no-local-key.test.mjs` fails when a suite or helper fetches the API itself or reads the key, so **a new suite must ask a model through `lib/model.mjs`**. The AI screenshot review (`review-ui.mjs`) and the Finder's CI tooling keep the CI key.
- **To check the spend:** the Claude Console's API keys page shows the cost per key (`job-pilotto-e2e-testing` was $34.89 on 5 Oct 2026); it should not grow from local runs.

