# Why the rules exist: the incidents behind them

Each rule in CLAUDE.md and `docs/rules/` is short; the incident that caused it lives here. **Before "simplifying" a rule, read its entry**: these are
what stop a rule from being relaxed back into the old bug. Add an entry when a new rule is born from an incident (date, what happened, the cost).

## Safety
- **Tests never touch the owner's live app, accounts or data** (8 Oct 2026): a headless browser with the real extension, launched without the
  harness's port rewrite, paired with the live app on 127.0.0.1:47111 and used the real profile, the Keychain password, the real CV and the AI budget on
  an employer's site. Nothing was submitted, but it was a privacy and cost incident. Hence: list what product code reaches, cut it off, assert it,
  always through the harness (`desktop/e2e/lib/extension.mjs`, `real-extension.mjs`), check `logs/app.log` afterwards.
- **The twin** (8 Oct 2026, owner: "test on my current state, on my live websites… while avoiding mutating my actual Notion state"): the one sanctioned
  way to use real state, through a one-way Notion mirror whose token gets 404 on every real database.
- **Login walls and bot checks** (owner, 7 Oct 2026): LinkedIn, Glassdoor, Indeed, levels.fyi and Reddit are read only through the user's own visit;
  401/403/429 or a check is a no.
  **One 403 exception** (owner, 22 Oct 2026, #1694: "403 only, not 401"): our own fast burst can trigger a 403, so the engine asks that domain once more after a 1 s pause; a 401 is never retried and a second 403 is final (`src/sources/host_pace.py`, `tests/test_host_pace.py`).
  **The one opt-in exception** (owner, 19 Oct 2026, verbatim: "we don't want to crawl job boards, many requests a day, but rather employer sites, once. And that's it. And we want to give the UX to the user that everything is happening magically. He is not asked to intervene. We can state clearly in the app (have a settings), in the privacy... that we're doing this." / "So we don't want to do this against his will" / "but if he's accepting this. then let's do"). A coordinator advised against it (the read is routed through the user so the site cannot tell); he chose it knowingly,
  with job boards included, on the terms in CLAUDE.md: first opt-in, then ON by default on 20 Oct 2026 (owner: "this should be opt-out, meaning on by default"; the person can turn it off), no cookies, never the login-wall sites.
  **20 Oct 2026, "stop on any check" changed** (owner: "can we borrow the bot overpassing strategies? I want to get this feature. I want to change our strategy."; on the ladder sketch he chose "real tab" and "user solves captcha" and NOT faked fingerprints, solving services, proxies or a hidden browser posing as a person; "Everything should happen from within the app."): a passive check may clear by itself in a real tab of the user's Chrome (incognito, so no cookies); a captcha is solved by the user, never by us. Why incognito: a normal tab sends the user's cookies and logins, and stripping the Cookie header would stop a check from clearing. Numbers behind it (19 Oct 2026, six searches): about 5% of employer sites refuse the engine, 13 of 18 tested answered in a real Chrome.
- **Evals never share the production AI account: the random draws' exception** (owner, 26 Oct 2026, verbatim: "use claude in chrome. Same account if
  possible, jsut different workspace/token/worker"). The search robot's Free AI draws (jobadabra-web `jobs/persona-search/free-ai-local.mjs`, #137) run
  on the production Cloudflare account with their own Workers AI-only token ("jobadabra-random-draws", secrets `RANDOM_DRAWS_CF_*`), made with the owner
  signed in. They never call production's `/api/ai`, Worker, KV counters, Telegram alerts or `WEB_SEARCH_ANTHROPIC_KEY`: the site's handler runs on the
  runner with in-memory KV and D1, production's caps ($0.50 a draw + 2 web searches), and the draws' own Anthropic workspace for web search. What they do
  share is the account's Workers AI bill; the account is on Workers Paid since 16 Oct 2026 (`workers/www/wrangler.toml`, `FREE_AI_NEURONS = "off"`), so
  draw neurons are billed, never refused to users (the 16 Oct incident was a used-up shared free allocation). Do not "fix" this back without the owner.
  **Extended to CI's tests** (owner, 26 Oct 2026, verbatim: "where would you recommend to Free AI (CloudFlare) and where to keep Claude?"; on the sketch
  https://claude.ai/artifact/M7j1LeEnrs5HZaen4xtwSa he chose "Yes, own token", "Check out the site handler", "Free AI + 1 smoke each" and, for screenshot
  review, "Move it now"). CI's AI steps that test the product (the app under test in the e2e, desktop and Windows suites, the draws, the digest, the
  changelog) and the e2e screenshot review run on Workers AI with CI's own Workers AI-only token (secrets `CI_FREE_AI_CF_*`), on the same terms as the draws:
  the site's handler on the runner (a CI-only checkout of jobadabra-web, as central-scout reads the lab), never production's `/api/ai`, Worker, KV or alerts.
  Claude keeps the code-writing agents, the other judges and web search. Later the same day CI's Anthropic credit ran out and the owner said (relayed by
  the coordinator, verbatim): "Let's sjust switch to Free AI (CloudFlare workers AI). I don't want to top up anymore" / "I'm tired of spending": so the
  Claude smoke suite per lane is parked until he funds Claude again.

## Meaning and pages
- **Meaning comes from AI, never keyword lists** (owner, 8 Oct 2026: "AI should interpret mails"): an English-only subject-word Gmail search never
  fetched a German or Portuguese rejection; AI-translated keywords were proposed and refused.
- **The AI decides, code only fetches, validates and keeps safe** (owner, 26 Oct 2026): a keyword list answered before the AI and its "office" read
  "First Officer" as finance_admin, so a pilot search read 1,107 office employers and found nothing (#1978 made kinds `ai_first`). The search itself was a
  scripted chain of gates (rests, caps, "web search only if too few") that hid the failure through 20+ PRs. Owner: "We should not limit ourselves on a very
  scriptic/progrmatic algoritm".
- **Judgments about a page are the AI's, even without words** (8 Oct 2026): "is the form ready?" was HTML `required`, "did it work?" was "the form is
  gone", and bot checks were a list of vendors: all three failed on the first real site.
- **Reading websites is universal** (owner, 8 Oct 2026: "we'll have thousands of them").
- **A form bug is fixed in the mechanism** (8 Oct 2026): per-site fixes did not carry to the next site; upload slots became the example
  (`extension/page/upload.js`, `desktop/e2e/test/upload-slot.test.mjs`).

## Working rules
- **Every fix works for any user, through the Desktop App**: Always on's Google sign-in was once set with `gh secret set` by hand; the app now copies
  it itself (`desktop/lib/google-keys.js`).
- **Keep the Intelligence page in step** (owner, 3 Oct 2026): new AI steps had shipped without the site saying so.
- **Wrong data: root cause first, then repair by hand**: one-off repair code piled up for edge cases that never recurred.

## Data
- **One copy** (28 Sep 2026): an audit found data split across the Mac and Notion, some only local, some duplicated without sync. Hourly/daily sync
  was rejected (two copies = drift). **"Notion later"** (3 Oct 2026) replaced "Notion required at setup"; **store adapters** (9 Oct 2026) made
  Notion optional behind one interface, still one copy.

## Applying
- **Extension first** (owner, 8 Oct 2026): the extension path is easier, faster, simpler; Claude needs Claude Code and suits technical users.
- **Claude finishes a stuck page** (owner, 10 Oct 2026) replaced "never started by itself" (8 Oct) and "hidden, off by default" (9 Oct): users got
  stuck on pages Claude could finish; the countdown keeps the start visible and cancellable.
- **The flow core: one session at a time** (10 Oct 2026): in 8 days `extension/background.js` took 48 commits and `fill-flow.js` 29, from several
  sessions at once; a fix for one site or flow kept breaking another.
- **Recorded pages answer only what was asked** (10 Oct 2026, Ashby Yes/No): a stub answering an unasked question hid the bug.
- **"Do it for me" is the default** (owner, 10 Oct 2026: "users get most of the automation by default"), replacing the 9 Oct assist default.
- **Close a fix only on Confirmed** (11 Oct 2026): fixes closed on "it clears by itself" came back.

- **A choice a base fact answers is filled** (17 Oct 2026): the rule said "never a choice on the application form", so visa, relocation and residence
  menus were left for the owner although his Profile states them ("Why 'A choice (visa, relocation, demographic, any knockout)' is left for me? We should
  have this information in the Profile, as a standard/base."). A plan-path proof (5 runs, $0) filled Herr, M. and Ja from English answers, but a French
  "Suisse" was only proposed: the identity floor compared words. The floor now compares the country, for a listed option only.

## Desktop UI
- **A new feature looks like the old ones** (5 Oct 2026): "Prepare top matches" shipped as raw Telegram text while every other task had a card;
  four cards had drifted from the engine's message format, hence the message contract test.
- **Confirm a mockup before code** (28 Sep 2026): Profile moved and back, Settings saving changed twice, Actions redesigned 3× in one day.
- **Screenshot the whole view** (7 Oct 2026): a box checked alone was indented past its card's heading, spaced far apart, with oversized buttons.
- **The design system: the kind picks the control** (17 Oct 2026): rules existed (this file, the skill, tokens) but nothing made a session pick the
  right control: Voluntary surveys as prose bullets and cut one-line boxes, Languages as one text line, Availability as ten boxes of prose, "Tax" in
  quotes on Strategy, full-window PR shots without a caption. Owner: "Let's use the proper field types ... proper spacing ... contrasts ... cards ... chips."
  Measured then: 14 chip classes, 5 of 30 token pairs under AA (field edges 1.8:1). Hence the checks, not more prose.
- **But not at Tier 0** (28 Sep 2026): a spinner change lost minutes to three failed offscreen screenshots and CI polling.

## Files
- **500 lines** (8 Oct 2026): a moved block missed `sessionGet` 800 lines below; an import changed upstream and a page went blank.
- **Splitting safely** (8 Oct 2026): `main.js` 2,781 → 1,197 lines took a failed start (`prepareKitFor` needed before it existed) and three near-misses;
  a session had split the contact handlers meanwhile (two files registering one channel).

## Change loop
- **Superpowers plugin dropped** (30 Sep 2026): its process cost more tokens than it saved. **No subagents** (30 Sep 2026): they ate most of the
  token usage and were slow.
- **Change tiers** (6 Oct 2026): a transcription banner took 1–2 hours of harnesses, real downloads, e2e runs and CI waits.
- **Commit subjects ≤ 72 characters** (2 Oct 2026): subjects of 150+ characters made the history unreadable.
- **The e2e step moves with the feature** (6 Oct 2026): about 25 commits in eight hours renamed a task, changed digest headings and the job-board rule
  without touching their suites; the `personas` suite sat red unnoticed.
- **A new e2e step proves its setup** (6 Oct 2026): an Apply step that had never passed failed the beta gate on its premise.
- **No CI e2e by hand** (owner, 9 Oct 2026): a Mac's runs use the plan; CI spends the test keys.
- **One full run per landing** (owner, 10 Oct 2026): the ladder took 40 checklist boxes and the full suites ran about 40 times; "do it in 1 to 3
  commits and run the e2e suites 10x less".
- **Debugging an e2e step** (6 Oct 2026): one step cost ~1 h and 10 full-suite runs of 2-4 minutes; a repro was called done when its stub had
  silently not applied.
- **Never force-push main** (1 Oct 2026): a `--force-with-lease` dropped another session's commit `8dce9ba`.
- **Red main** (5 Oct 2026): four sessions waited for a red build's author until the owner stepped in.
- **Keep worktrees** (owner, 9 + 11 Oct 2026): five landed worktrees were removed against the owner's wish and restored; then 167 worktrees took
  10 GB, hence keep by default + a 7-day prune of fully landed, untouched ones.
- **Run Log and Session Handoff retired** (owner, 11 Oct 2026): of 56 sessions in 7 days only 2 read the Handoff (62 KB, its "Current state"
  dated 3 Oct) and 1 the Technical Reference; the Run Log repeated the commit messages. Lessons now land in stronger forms ([knowledge.md](knowledge.md)).
- **After each change, only what applies** (owner, 11 Oct 2026): Tier 0 targets ~1 minute, but every change was also asked to update three Notion
  pages, a Bug Tracker row, a two-table to-do list and the Intelligence page; agents over-verified and over-reported.
- **Fix rounds: by cause, judged by confirmed rows** (owner, 11 Oct 2026): a ~3 h round of 6+ sessions (one per row) confirmed 2 pool rows; 75 of 131
  commits were tooling; 10 of 29 "Needs a fix" rows had never run; an optional empty field counted as a failure on every site (the logged fill line dropped
  `required`); the coordinator named a wrong cause for the waiting (a shared Notion page; the runs were on SQLite) and the Mac was swapping (load 31).
  Rules and start-of-round order: [rounds.md](rounds.md).
- **Test accounts may sign in** (owner, 15 Oct 2026): Workday (per tenant) and SuccessFactors end every pool row at "account-first: held", so every step after sign-in
  (My Information, Experience, Questions, Self-identify, Review) was never tested. The owner makes the accounts by hand on a test inbox; tests sign in with those and nothing else
  (a real application account is never read), and the tripwire guards the test passwords too.
- **Claude's takeover is off** (owner, 15 Oct 2026): reaching Claude (rung 6, "Let Claude finish this page", "Resume Claude", the 5-second countdown) is already a poor
  experience; the app should be the interface between the person and Claude. Hidden behind one flag (code kept, to be enabled later); a stuck page offers a visible
  "Report this form" instead, so the stuck shape reaches the fix loop.
- **Written questions are drafted** (owner, 16 Oct 2026; it reverses 34b349d of 11 Oct, which left them as "your own words" by design): "These are the most time-consuming questions; if they are left for the user, we leave the hard part for the user. We should always try to fill these questions, suggest answers." Principle: "Help, in a way or another, the user": a draft from the facts, or an outline when they are thin; empty is the last resort. The honesty floor stays: nothing unsupported is invented, and the person reads it before it counts.
- **Recordings are a debugging tool, not a PR gate** (owner, 17 Oct 2026): since 14 Oct about 300 PR replay runs caught 0 real regressions and every red was noise (ask wording, stale rows, CI plumbing); in the last 1000 PR runs
  Journeys had 63 runs, 4 red, 0 real (3 recording downloads, 1 stale base) and Site replays 65 runs, 5 red, 0 real; 10 of 37 recordings went stale within a week; the one real catch came offline (the Teamtailor stall, found by bisecting a replay to commit 5afa5a8).
  So: record a failing site once, reproduce and bisect offline, freeze it as a page case (never stale); replays and journeys left the PRs, one small daily replay is the alarm, and the refill / re-record run only for the rows it flags.
- **A declaration of fact is not legal** (owner, 20 Oct 2026, on internal#37 and #40: "The demographic questions should be filled by extension. This is not something sensible. It's reducing the user's time waste on the form filling"):
  the AI read "Have you been a public official…?" and an accommodation question as `legal` or `demographic`, so they were always left ("legal/consent: always your choice") and never asked, even when the person had answered once.
  Now a declaration of fact is `knockout`: typed from a saved answer, otherwise left so the app asks once and keeps it (his answer: "Leave it, ask once, remember"). `legal` stays a consent, terms, a privacy notice or a certification.

- **A legal-looking choice is asked once** (owner, 20 Oct 2026, internal#40): even with a worked example the AI kept calling "Have you been a Public Official…?" (a required dropdown) legal, so it was never asked or filled. His answer to "What should happen with a question the AI calls legal?": "Ask once, remember". A legal answer on a field with options goes the Answer-once path (typed from a saved answer, else asked once); only a lone consent or attestation tick stays the person's. Structure (the field's type) decides, never the words. Relaxes the 8 Oct rule for an attestation worded as a Yes/No menu.

## Cross-repo reds (21 Oct 2026)
- 75 red PR checks in two days; most were a public/private pair waiting on each other (site#18, #21 ×3, #22, #23: a route or feed type public listed before the Worker had it, or the site had before public listed it), two were a missing "[xx]" title tag (site#18, #19). Real catches stayed red (#1628/#1629 import cycle, #1631, #1638).
- Rule: the site half lands first; contract tests are one way (`assert_site_accepts` / `assertSiteAccepts`); `tools/ship.sh` adds the tag to an open PR too and the "PR description laid out" step names the fix. Detail: docs/rules/private-site.md.

## A dead beta holds the queue (24 Oct 2026)
- Beta 13 had a red Build · Mac (GitHub's attestation upload) and lacked two fixes merged after it started; beta 14 sat `pending` behind it for the rest of its 45 minutes. Owner: "if a run is already failed, what's the point to wait in the queue for the new one?"
- Rule (superseded the same day, see below): cancel the run that cannot go green, then dispatch; a one-off flake in a run that is otherwise fine is re-run once instead. Still true for a beta that hangs or whose build failed.

## A red beta runs to the end (24 Oct 2026)
- Betas 13-20 took eight 45-minute runs to reach one green: a suite stops at its first red, the beta is the only place all 66 jobs run, and betas 18 and 19 were cancelled at their first reds, so the reds behind them never showed. Each fix then cost a PR, the owner's merge and a new beta, and main took 19 commits between betas 17 and 20. Owner: "why we need so many iterations".
- Rule: a by-hand beta with reds runs to the end; every red is read, named and fixed in one batch before the next beta; cancel only a hang or a failed build (CLAUDE.md working rules). Merges to main are not held (the owner did not choose that part).

## robots.txt is not consulted (6 + 26 Oct 2026)
- 6 Oct (2f586ca): the owner dropped robots.txt checks ("if they block us, they block"). 18-24 Oct they came back in the board readers (84a97fe board_pages, 6d2bcb3 board_forms, 2d1bd00 board_sections), unnoticed: a regression of his decision.
- 26 Oct: two pilot boards (career.aero, latestpilotjobs.com) were called unreadable because of robots.txt and terms. Owner: "let's ignore robots.txt, nobody cares about that, our users just want to search/find jobs".
- Rule: no reader refuses a public job page for robots.txt or a site's terms (Sitemap: lines stay as discovery). `tests/test_robots_not_consulted.py` fails on a new `robotparser`/`can_fetch`. The Remotive exclusion (aggregators.py) is an API-terms choice, left as it is.

## Sites read follow the current strategy (26 Oct 2026)
- Owner: "the websites being read should be relevant and in sync with my current strategy and jobs search". After a first officer's "Find jobs",
  the browser's refused-site reads read and offered maib (a Moldovan bank), Premier Energy, Moldtelecom, Airtable and others that an earlier
  software search in Moldova had queued: 49 reads that night, 13 sites 4 times each, 0 matching jobs ("Totally irrelevant. This is a bug.").
  The refused-site queue never asked whether a site fits the search; the visit list beside it did (`visits.relevant`).
- Hence: every list of sites a run reads or offers is judged by the AI for the CURRENT strategy, whichever search queued it; a site the person
  opened a job on is read anyway; when the AI fails, the automatic reads take none. Guard: `tests/test_sources_follow_strategy.py` (one loop over
  the lists; a new list joins it, a sibling in other work is named with its owner).
- The same night, after that fix (owner: "it hangs. its stuck"): the judge kept "Airbase" (spend-management software, from a tech firms' list an
  earlier search picked) for the pilot search: it saw only a name that sounds like flying and was told "When unsure, keep it". And the pass sat on
  "0 of 1 · Airbase · Next" for 15 minutes: the extension read the site at once, but the pass's task waited behind Find jobs and missed the answer.
  Hence: the judge sees where a site was found, judges what an organisation does (never its name), and an automatic read leaves an unsure site
  out; a pass exists from the moment its sites are handed out and each site answers within 45 s or ends it with that reason.
  Guards: `tests/test_refused_reads_fit.py` (NameOnlyTest), `desktop/test/refused-reads-pass-timing.test.js`.
- Employers from the shared list (audit PR 4): the pilot search read 763 index employers, none known to hire pilots: 494 with no kind mix yet and
  269 with an old mix mostly "other" were kept on a guess, and a mix counted over all jobs worldwide spoke for one country. Owner: "Not read" for an
  employer not judged yet, old mixes the same; the countries of job places judged "using any user's machine/installation (being it Pro/Free AI/
  BYOK/subscription/API Key... whatever they use) but also using the central scout", never a one-off run on one machine.
  Hence: the scout counts each employer's jobs per country and kind (`kind_counts`, `src/scout_kind_counts.py`), places from every install's shared
  answers (`src/geo.py`, topic job-location-geo) and its own capped AI; an install judges an employer by its jobs in its countries
  (`role_kinds.located`), and no mix means not read. Guard: `tests/test_kind_counts.py`.
- The scout keeps Claude (owner, 26 Oct 2026: "keep claude for the scout"): its answers decide which employers every install reads, a wrong one hides an
  employer from every user of that kind; it costs ~$0.09 a run (~$11 a month). Guard: `tests/test_kind_counts.py` ScoutKeepsClaudeTest.

## Browser reads start only from the person's button (26 Oct 2026)
- Since 20 Oct the extension read refused sites by itself: an hourly timer (3 minutes after Chrome started), every Check for new jobs and every job
  opened from such a site; the passes showed up in Recent activity as "Find jobs using your browser" runs nobody started. Owner: ""Find jobs using
  your browser" shouldn't start automatically in the backgruond. It should be suggested to the user as an action button"; "there should be a button
  on the card where the "find jobs" finished"; "I don't think we should have a switch at all".
- Hence: one gate (`desktop/lib/refused-now.js`): the app hands the extension sites only after the press; a finished Find jobs run counts the due
  sites and its card offers the button (also ⌘K); the Settings switch is gone. Guard: `desktop/test/refused-reads-button.test.js` (loops over every
  path that used to start reads; press() has one caller).

## Suites run on CI only (26 Oct 2026)
- The owner's Mac sat at load 89: session 8b ran `node --test` over a grep-built list of e2e harness tests (fill-overlay, panel-tailor… open Chrome for
  Testing), and session 33 ran the full `python3 -m unittest discover` (the heavy-lock tests spawn processes and wait on clocks). Owner: "are now sessions
  again required to run e2e tests locally? That loads my mac" / "I didn't want that" / "It should run only on CI" / "and locally, only very isolated".
- Rule: in a session, one named test file or one e2e step; CI runs every suite on the PR. Gate: `~/.claude/hooks/foreground-long-run.py` refuses a whole-suite
  command (background or not; cases in `foreground-long-run.cases.sh`); escape `E2E_LOCAL_OK=1` only on the owner's word.

## The central scout's own AI cap, and a sample per employer (26 Oct 2026)
- After the recount (#2061, "Not judged yet = not read"), a pilot search read 0 shared-list employers (299 before, on guesses): the new index had
  counts per country on 9 of 2,517 employers. decide's 60 calls a run, meant so an install's crawl never turns into a bill, were shared by title
  kinds and places in the central scout, and a count needed half of every title judged (thousands for a big employer). No log line said so.
- Owner: "Higher cap + sample" (~$0.0008 a call, about $0.40 a run while the counts fill). Hence: the central scout's cap is `decide.CENTRAL_MAX_CALLS`
  (installs keep 60); an employer is judged on a fixed sample of 60 jobs, its counts scaled to all; the run log says "Kind counts by country on N of M feeds".
  Guard: `tests/test_kind_counts.py` (CentralCapAndSampleTest). Lesson: after a run that publishes a new field, count how many entries carry it.
- The first run at 600 calls: counts on 190 of 4,513 employers, $0.205 for 652 calls (the cap still bound). Owner: "2,000 calls" (~$0.65 a run while filling).
