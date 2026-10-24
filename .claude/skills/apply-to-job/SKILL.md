---
name: apply-to-job
description: Fill a job application form for the owner from their Jobadabra application kit, live in Chrome, stopping before Submit. Use when the owner says "apply to <job/URL>", "fill this application", "help me apply", or pastes a job/application link. Also use to record what was learned about an application form or platform.
---

# Apply to a job (Jobadabra)

Goal: the owner's application form, fully and correctly filled from the application kit, in their
own Chrome, **stopped before Submit**. The owner reviews and clicks Submit. Then the job is marked
applied. Speed matters: a Greenhouse form should take under 3 minutes.

**Golden rule (see `AGENTS.md`): map once → build the whole plan → one fill call → verify once →
upload résumé → re-verify once.** Use the helpers in `tools/browser-form-fastpath.js`
(`__jobPilottoAuditVisibleFields`, `__jobPilottoFillKnownFields`, `__jobPilottoOptionPositions`),
injected after `tools/browser-submit-guard.js`; with claude-in-chrome, Read each file and pass its
text to `javascript_tool`. Anything you end up doing by hand that could be deterministic belongs
in that file next time — keep evolving it.

**Speed defaults learned 26 Sep 2026 (a 3-minute Grafana run; aim for under 2):**
-1. **The owner's own run uses the app's data on purpose:** every `python3 -m src...` command below runs with `JOB_PILOTTO_FOLLOW_APP=1` in its environment
   (the engine refuses the app's folder otherwise, 18 Oct 2026). Never in a test or an exploration: those set their own temp `JOB_PILOTTO_DATA_DIR` + `JOB_PILOTTO_CONFIG_DIR`.
0. **One context call first:** `python3 -m src.ai.apply_run --context <job URL>` prints the kit
   (JSON), Profile, Application Answers and recent learnings for that job board in one go (~8 s);
   don't fetch those pages separately. Apply the learnings.
   While filling, stamp phases with `window.__jobPilottoStep('<name>')` inside JS calls you already
   make (the fast-path helpers stamp their own); the timings land in the run's Notion page.
1. **Posting gone → close it, don't ask.** If the page says "Job not found"/404 or the board no
   longer lists it, run `python3 -m src.ai.apply_batch --mark-closed <job URL>` (Stage → Closed,
   notification) and finish. The launchers' `--max` and `tools/prepare-top.sh` already skip and
   close postings their board confirms are gone (`ats.is_live`), so this should be rare.
1b. **Eligibility before filling.** Read the posting's location/residency and pay lines in step 1.
   If the job requires residence the owner doesn't have (e.g. "must be based in UK/SE/ES/DE/IE"),
   say so and stop before opening the form — don't fill a whole form and flag it at the end.
2. **Greenhouse dropdowns: open, then `__jobPilottoClickOption('<exact text>')`.** Open the
   react-select (JS `.focus()` + a trusted click on its control, or click by ref), then call
   the helper: it clicks the option whose text *exactly* equals the answer and returns
   `{ok:false, options}` when there's no exact match. **Don't use type + Return** for fixed
   lists: it picks the first partial match — on a 26 Sep 2026 Canonical run "Male" became
   "Female" and "4" became "0". If a site ignores the JS click, click the returned `x, y`.
   Type + Return stays only for city/location search (first match is the intended one).
   School/Degree/Discipline: type the query, wait, then `__jobPilottoClickOption`.
3. **Record the run at hand-over (Claude / manual runs):** note `date -u +%FT%TZ` when filling
   starts; at hand-over save `JSON.stringify({page_url: location.href, guard_active:
   !!window.__jobPilottoGuardActive, fields: window.__jobPilottoAuditVisibleFields(), steps: window.__jobPilottoSteps || []})` to a
   file and run `python3 -m src.ai.apply_run --record <job URL> --audit <file> --started <time>
   --learning "<one new finding, or empty>"` (needs
   `NOTION_TOKEN`). It writes the same run record as a Codex run (so `--status`, `--report` and the
   benchmark cover it), sets the Notion Next step and Form fill time, and sends the "Form filled" /
   "Needs your input" notification. Its verdict comes from the page (guard on, required fields
   filled, no legal box ticked, résumé attached), not from the agent's summary.
   **Notify at start** with `tools/notify.sh <job URL> "Filling started"` right before
   the first field is written; if you stop on a blocker before filling, `tools/notify.sh <job URL>
   "Needs your input — see Terminal"`. The Codex runner records and notifies by itself.
4. **Admin after hand-over, not before.** Hand the form over first; add a Log line only if there's
   a genuinely new finding (no log/commit for a routine run). Fill time is recorded by `--record`.

## Hard rules
- **Never click Submit / Apply / Send.** Stop, show the summary, let the owner click. (Decision Log:
  never auto-apply. Changes only if the owner supersedes that decision there.)
- Only facts from the kit, the Notion Profile, Application Answers and the CV. Never invent.
- Anything marked ❓ in the kit, or a field with no source: leave it empty, list it for the owner.
- **Profile's confirmed demographic answers beat the kit's own demographic guesses.** The kit is
  drafted per-job from a prompt and often defaults standalone EEOC/demographic fields (a bare
  `gender`, `race`, `hispanic_ethnicity`, `veteran_status`, `disability_status` — as opposed to a
  job-specific `question_<n>` demographic question) to a generic "decline to answer" even when the
  Profile page has a specific value the owner already confirmed (e.g. "Gender identity: …", "Race:
  White / European", "Hispanic or Latino? No", disability/veteran "None of the above"). Before
  filling any bare (non-`question_`) EEOC field, check the Profile page's "Application form answers
  — voluntary demographic surveys" section for a confirmed value and use that over whatever the kit
  says. (Adopted 26 Sep 2026 after the owner caught three wrong fields — gender, Hispanic/Latino,
  veteran status — all filled from a stale kit default instead of the confirmed Profile answer on a
  Canonical application; see Log.)
- **Legal-acknowledgment checkboxes** ("I have read and agree to...", privacy notices, terms) are
  always left for the owner to check themselves, even when the kit supplies an answer for them —
  it's the owner's agreement to make, not something to assert on their behalf. (Adopted 25 Sep 2026
  after observing this as a hard rule in a Codex desktop-app comparison run — see Log.)
- **Employer accounts: sign up or sign in yourself, but never see the password.** (Owner decision
  28 Sep 2026, replacing "never create accounts": Apply with Claude has to get from a job board
  through the employer's sign-up to the form.) Generate it into this computer's secret store
  (Keychain on the Mac, Credential Manager on Windows). **The extension fills password boxes itself**
  (owner, 8 Oct 2026) on a sign-in or sign-up page in the tab the app opened: never paste, type, echo,
  screenshot with Show on, or write a password anywhere. Steps: "Reaching the form" below.
- Clicking **Apply now / Create account / Sign in / Next / Save and continue** to reach or move
  through the form is fine; the final **Submit / Send application** never is.
- CAPTCHA or "verify you are human": the owner solves it. Never try to bypass it.
- Contact details (email, phone, address) come from the CV PDF at apply time. Do not store them
  in Notion, the repo or memory.
- **Leak guard.** This file, Platform notes and the Log are committed to a public-ish git history.
  Never write a real name, email, phone, address, salary figure or answer text into them — use
  `<placeholder>` the way this file already does. Findings about a *site* (field ids, widget
  behaviour, error text) are fine; findings about *this application* (what was typed) are not.
- **Always use `browser_batch` for multi-step browser work**, never a string of separate
  `javascript_tool`/`computer`/screenshot calls one at a time. Load it up front (it's a deferred
  tool: `ToolSearch("select:mcp__claude-in-chrome__browser_batch")` alongside the rest of the core
  set) and group whatever steps don't depend on seeing an intermediate result — e.g. one batch for
  "map fields" + "fill text fields", another for "fix a field" + "re-verify" + "screenshot". Adopted
  25 Sep 2026 after direct owner feedback that watching one-call-at-a-time execution (assess, run
  JS, assess again, upload, assess again...) was unacceptably slow; see Log.
  - **Go further: batch as much of the whole form as possible in ONE call, not just pairs of
    steps.** After the initial field-mapping pass tells you every field's id/type, you already know
    enough to write out clicks/types/uploads for the *entire* form (text fields, file upload,
    every dropdown) as a single `browser_batch` — don't split into "name/email/phone", then a
    separate call for "resume", then another for "dropdowns" unless a step's outcome actually
    changes what the next step needs to do (e.g. an async-search combobox whose options only exist
    after you've typed a query). File upload, clicks and JS calls can all be items in the same
    `browser_batch` array alongside `computer`/`navigate`. Owner feedback 25 Sep 2026: still too
    chunky even after adopting `browser_batch` — "why don't you do everything, all the fields in
    one shot... same for uploading CV, everything async, in parallel, as much as possible."
  - **Default to one JS call for every plain text field and static-option dropdown; never use
    pixel-coordinate `computer` clicks on a react-select field.** Once the field-mapping pass has
    every id, write one `javascript_tool` call that loops over ALL of them — native-setter text
    fills plus `selectViaOnSelect()` fiber writes (see Fast path — **not** `selectReactOption()`,
    which only satisfies react-select's own display and leaves Greenhouse's real validation
    thinking the field is empty) for every dropdown with a fixed option list — and execute it as a
    single call. Mixing in `computer` clicks for some dropdowns is what causes the
    real slowdown: selecting one option can reflow the page, making the next pixel coordinate stale
    and forcing a re-screenshot-and-retry loop (observed 25 Sep 2026 on a Canonical form's Education
    section). JS calls read the DOM fresh every time, so they never go stale from a reflow — that's
    the reason to prefer them over clicking, not just speed.
  - **The only genuine two-step case is an async-search combobox** (its own `loadOptions` fetches
    matches from a remote API only after a query is typed — Greenhouse's School/Degree/Discipline
    fields, Ashby/Greenhouse city-search fields). You cannot know the exact option label before
    triggering that search, so it truly needs one round trip: type the query via `computer`, **read
    the resulting options via a `getBoundingClientRect()` JS call (same as the fixed-option
    dropdowns), then click at the returned coordinates** — not a screenshot you eyeball. A run on
    26 Sep 2026 correctly did the JS-geometry read for every fixed-option dropdown but reverted to
    "screenshot, look for the option, click" for these async fields specifically, which is the same
    slow/stale-coordinate pattern this section exists to avoid — the fix is the same technique, just
    applied here too, not a different one. Everything else — every field with a fixed, already-known
    option list, and every plain input — has no async dependency at all and belongs in the single
    upfront JS batch.
  - **If `selectViaOnSelect()` itself is blocked** (observed 26 Sep 2026 on a Claude Code session: a
    "Browser Input Exfil" sandbox classifier rejected the fiber-write JS call outright, with no
    retry or rephrasing able to get it through — don't try to route around a tool-permission denial
    like that, it's a hard stop, not a bug to work past) — **do not fall back to raw pixel-coordinate
    `computer` clicks from a screenshot.** That's the exact slow path this section already warns
    against, and it reproduced the same wrong-field/stale-coordinate failures again on 26 Sep 2026
    (typed "Computer Science" into Degree instead of Discipline; School reset itself after a résumé
    re-upload) despite being documented as a known trap the day before. The working middle ground,
    entirely read-only DOM geometry (not state writes, so it doesn't trip the same classifier):
    1. Click the field by **element `ref`** (from `find()`/`read_page()`), never by raw `(x, y)` —
       a ref resolves against the live DOM at click time, so it can't go stale from a reflow the way
       a coordinate from an earlier screenshot can.
    2. Once a dropdown's menu is open (fixed-option *or*, after typing, async-search), run one
       read-only `javascript_tool` call: `Array.from(document.querySelectorAll('[class*="option"]'))
       .filter(el => el.offsetParent !== null && el.children.length === 0).map(el => { const r =
       el.getBoundingClientRect(); return {text: el.textContent.trim(), x: Math.round(r.x+r.width/2),
       y: Math.round(r.y+r.height/2)}; })` — gives exact click coordinates for every visible option
       in one shot, read fresh from the current layout.
    3. `computer` `left_click` at the matched option's `{x, y}` immediately — no intermediate
       screenshot needed, since the coordinates just came from the live DOM, not a stale image.
    4. Screenshot only at checkpoints (start, after résumé upload, end-of-form), not after every
       micro-action — re-screenshotting after each click to "make sure" is itself what balloons a
       ~5-field section into 15+ tool calls.
    - **Re-verify the whole form once, right after the résumé upload specifically** — that upload is
      the one known point (see Platform notes) where Greenhouse can silently reset unrelated fields
      that were already filled, so a single full-scroll check there catches it in one pass instead
      of discovering it piecemeal later.

## Before you start (session/tooling gotchas, 25 Sep 2026)
- **This skill is project-scoped to job-pilotto.** If the session started in a different working
  directory, the `Skill` tool's registry does not pick it up even after `cd`-ing into
  `/Users/mac/jobadabra` mid-session (observed: two failed `Skill("apply-to-job")` calls in a row).
  Don't retry the `Skill` tool after a `cd` — go straight to `Read` on
  `/Users/mac/jobadabra/.claude/skills/apply-to-job/SKILL.md` and follow it as plain instructions.
- **Kit lookup: skip the schema fetch.** The Applications data source URL
  (`collection://346d7756-bafc-4dff-881f-2710819d90da`) and the `Job URL` column name are already
  known (see Inputs below) — go straight to a `notion-query-data-sources` SQL query
  (`WHERE "Job URL" LIKE '%<id>%'`) instead of fetching the database schema first. The `rows`/filter
  mode has a stricter input shape that's easy to get wrong on the first try; SQL mode with a `LIKE`
  is more forgiving and gets the row url in one call.
- **The auto-mark-applied polling step (Steps §9) can get blocked.** A `ScheduleWakeup` whose
  eventual action is `gh workflow run ... -f action=applied` was rejected by the permission
  classifier as an "External System Writes" risk in at least one session, even though the skill
  frames it as owner-pre-authorized. Don't spend a retry rediscovering this each time: if the
  schedule call is denied, skip straight to telling the owner the manual `gh workflow run` command
  to run themselves after they click Submit — same as the existing Fallback bullet.

## Inputs
| What | Where |
|---|---|
| Kit (cover letter, answers per form field, checks) | Notion Applications row for the job → toggle "📝 Application kit" → JSON code block. Find the row by querying the Applications database (`f56b68942d3b43cbb85a7b1ebfe2df1b`, data source `collection://346d7756-bafc-4dff-881f-2710819d90da`) for the job URL — SQL mode, not schema-fetch-then-rows mode (see gotchas above). |
| No kit yet | `gh workflow run daily.yml -R GarryOne/jobadabra -f mode=prepare -f job=<job URL or 8-hex code>`; wait ~1 min (`gh run watch`). Or the 📝 Prepare button in Telegram. |
| Standard answers | Notion page Application Answers `3e562be8fd868108ae38d1f47d52a811` |
| Profile | Notion page `3e562be8fd8681579078d09829921b8c` |
| CV (upload + contact details) | `$JOB_PILOTTO_CV_PATH` (see `.env`) |

## Steps
1. **Kit + both Notion pages.** Get the kit JSON, and read **both** the Profile page and the
   Application Answers page before filling. They hold different things: Profile has CV facts,
   demographics, education and contact details; **Application Answers has availability and pay —
   notice period / earliest start, salary per country, eligibility and sponsorship per country,
   links, company count, "how did you hear".** A 26 Sep 2026 run left "earliest start date" empty
   and reported "no notice period on the Profile" although Application Answers had it — it only
   read the Profile. A kit ❓ is resolved if either page answers it.
   Sponsorship is not a blocker: the owner applies anyway (answer from Application Answers, e.g.
   "will require sponsorship"). Only a required language the owner doesn't speak, or a hard
   location restriction the owner can't meet, is worth showing before opening the form.
2. **Open the one form tab yourself, with the mark**: `tabs_context_mcp` with `createIfEmpty: true`, then navigate
   that tab to `<job url>#jobpilotto-fill`. The app opens no tab (claude-in-chrome sees only its own tab group); never open another.
   Greenhouse: the form is on the job page (`job-boards.greenhouse.io/<board>/jobs/<id>`), below the
   description. A job board's page (jobs.ch, TechTree) or a careers page with only an Apply button: see
   "Reaching the form". **One tab per application** (owner, 8 Oct 2026; docs/flows/applying.md): before you click a link
   or button that would open a new tab (`target="_blank"`), prefer navigating this tab to its address. When a click opens a new tab
   anyway, continue in the new one (the extension follows it as the same session) and close the tab you came from in your group
   (`tabs_close_mcp`), unless the new one is a sign-in pop-up window, which closes by itself.
3. **Extension first (Apply with Claude)**: your tab carries `#jobpilotto-fill`, and the
   extension follows later pages in that tab and a tab that tab opens. When the page has
   `<html data-jobpilotto-hook>`, read `data-jobpilotto-fill` and act on its `state`: `running` wait;
   `done` audit and fill only its `todo`, then press Next if the form has another page; `error` fill
   this page yourself; `no-form` press Apply or Next in this tab; `account` sign in or create the
   account (the extension does not type the password). After each navigation, wait for the new state.
   No hook after 10 s (site not allowed for the extension, app not running): do that step yourself.
   Don't fire `jobpilotto:fill` yourself.
3b. **Map fields in one JS pass**: list `form input, textarea` with `id`, `type`, `role`,
   `aria-required` and label text. Match kit answers by `field` (= element id; strip `[]`).
   **Keep the returned JSON compact** (short keys, truncate label text to ~60-80 chars, no
   whitespace/indentation) — a full unfiltered dump of a long Greenhouse form's fields can exceed
   the tool result size limit and come back truncated, forcing a second call to get the rest
   (observed 26 Sep 2026). If it still truncates, split by scrolling to the truncation point and
   querying only the remaining elements, rather than re-requesting the whole form again.
4. **Fill text fields in one JS pass** (native setter so React sees it):
   `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true}))`
   (use `HTMLTextAreaElement.prototype` for textareas). First/last name, email, phone from the CV.
5. **Dropdowns** (see platform notes and Fast path below): try a framework-internals write first;
   if the framework doesn't expose one, open with a *real* click, then pick the option by JS.
   Verify `aria-expanded === 'true'` before picking — a click can land on the wrong control or can
   close a still-open previous dropdown instead of opening the new one; if so, click again.
   - **Education (School/Degree/Discipline) is a real field, not an optional one to skip.** It's
     not required by the browser, and the kit doesn't carry it (its answers are per-job form
     questions, not this static section), so it's easy to walk past — but the Notion Profile page
     has a confirmed `# Education` table (school, degree, discipline) and it should always be
     filled from there when present. All three are **async-search comboboxes** (empty `options`
     until you type): click the field, type the value, wait ~1s, read
     `[id^="react-select-<field>-option"]` for the match, and `.click()` it — same pattern as
     Greenhouse's `candidate-location`/city-search fields elsewhere in this doc. `selectReactOption`
     alone won't work here since the option list is empty before a query is typed. (Missed entirely
     on a Canonical application 25→26 Sep 2026 — three fields left as "Select..." — caught by the
     owner from a screenshot; see Log.)
     - **These three must stay sequential, but each needs only two round trips and no screenshot.**
       Typing into all three back to back does NOT work: focusing the next react-select blurs the
       previous one, and react-select closes its menu and clears the typed query on blur, so the
       earlier searches are lost. (A 26 Sep 2026 revision of this file briefly advised that; it was
       wrong and has been removed.) Per field: one `browser_batch` of click-by-ref + type + ~1s
       wait, then the `getBoundingClientRect()` read (Fast path) and an immediate click at the
       returned coordinates. No screenshot to "see if the option appeared" — the JS read answers that.
6. **Files**: CV with the `file_upload` tool on `input#resume`. Cover letter: a text box
   (`Enter manually` → `#cover_letter_text`) gets the kit's `cover_letter`; a file-only field gets
   the letter as a PDF or .txt made in the scratchpad.
   - **Upload the resume LAST, after every other field/dropdown on the form is already filled —
     never before.** A successful attach can be silently wiped by a later re-render: on a Canonical
     form (26 Sep 2026) the CV was attached correctly mid-flow, then a subsequent
     `selectReactOption` call on an unrelated field (or Greenhouse's own DOM swap after attach — see
     Platform notes) reset `input#resume` back to empty with no error, no console warning, nothing —
     caught only because the owner looked at a screenshot and said "I don't see the CV uploaded."
     Re-uploading it *after* all text/dropdown JS calls are done, as the final fill step, avoids the
     interaction entirely. If any later step in Verify (§7) still needs to touch a field after the
     resume is attached, re-check the resume last, right before handover — don't trust an earlier
     "Uploaded 1 file(s)" tool result as still true by the time you hand off.
7. **Verify**: one JS pass listing every required field that is still empty or invalid, plus a
   screenshot of the form end. Fix what can be fixed. Reusable snippet (works for both plain inputs
   and react-select comboboxes; checks the displayed value, not `.value`, which react-select
   clears):
   ```js
   function unfilledRequiredFields(form) {
     const empty = [];
     form.querySelectorAll('[required], [aria-required="true"]').forEach(el => {
       const isCombo = el.getAttribute('role') === 'combobox';
       const filled = isCombo
         ? !!el.closest('[class*=select__container]')?.querySelector('[class*=single-value]')
         : el.type === 'file' ? el.files.length > 0 : (el.value || '').trim() !== '';
       if (!filled) empty.push(el.id || el.name || el.outerHTML.slice(0, 60));
     });
     return empty;
   }
   ```
   An empty result doesn't guarantee *correct* answers — it only rules out the most common failure
   mode (a field silently never got filled). Still read the screenshot before handing over.
8. **Hand over**: tell the owner in chat: filled fields (count), ❓ items left empty, kit checks,
   "Review and click Submit". Leave the tab open. The app's session page splits your message into
   **What Claude needs from you** and **What happened**, so write it in this shape:
   ```
   <one sentence: the form is filled in the open tab; nothing was submitted>
   - **Filled:** what you filled (one line; the CV file name).
   - **Problems:** what went wrong on the way and how you got round it (omit when none).
   - **Needs you:**
     - ❓ **<question, as the form asks it>**: why it's unknown. **Suggested:** <your best answer>
     - ⚖️ **<agreement / legal box>**: tick it yourself.
     - 👀 **<judgement call>**: e.g. an answer that discloses a gap, the role's travel. **Recommended:** <one action>
   - **Run record:** …
   Status: ready-for-review
   ```
   Write the message in the language the owner uses with you; the last line `Status: ready-for-review` stays
   exactly so, in English, in every language: the app reads it to show "Ready for review" and hides it.
   - **Every ❓ gets a `Suggested:` answer** — the most plausible one from the CV, Profile, Application
     Answers and the form's own options (e.g. a degree result on the country's scale, "Top 20%"), marked
     "(guess)" when it's inferred. It is only a suggestion: the field stays empty in the form. The owner
     edits it if needed and ticks one box, which saves `<question>: <answer>` to the standard answers
     page (`questions.remember`), so the next kit knows it. Write the question generically (no company
     name) so it's reusable; one ❓ per question.
   - **Every 👀 gets a `Recommended:` action**: the one most likely right, in a few words the owner can
     click ("keep it", "apply anyway", "change to Geneva, Switzerland"). The app shows it as a button; a
     "keep" closes the item, any other action comes back to you as a message ("Pay: change to …. Change
     it in the form, then tell me."), so do it and confirm. ❓ rows get a "Fill it in" button that sends
     `Fill "<question>" in the form with: <answer>`.
   - Only what the owner must act on goes under **Needs you**; "these fields were filled" lines go in
     **Filled**.
   - **Grow coverage**: every kit is drafted fresh from the Profile and Application Answers pages
     each time (`kit.py` reads both live, no caching) — so a ❓ or a `check_before_sending` item
     that's a **stable, non-job-specific fact** (education, permit, standard demographic answers,
     years/companies worked, salary target, notice period) is worth asking the owner to confirm
     once and saving straight to Profile or Application Answers. Once saved, every future kit
     already has it and it stops showing up as ❓. Leave genuinely **job-specific** items
     (this company's travel requirement, this role's on-call expectation) per-job — those aren't a
     coverage gap, they're correct per-job judgment calls.
9. **Auto-detect submission and mark applied — no owner action needed, if the tab is still open in
   this session.** Adopted 25 Sep 2026 after the owner asked to automate this step.
   **Current method (26 Sep 2026): the launchers do it, not the agent.** Every launcher
   (`apply-batch-chatgpt.sh` via `apply_batch.py`, `apply-batch-codex-terminal.sh`,
   `apply-batch-claude.sh`) starts `tools/wait-and-mark-applied.sh <job URL>` detached for each
   job it queues. It polls Chrome's tab URLs every 20 s for that job's `<id>/confirmation`
   (Greenhouse) or `<id>/thanks` (Lever), runs `apply_batch --mark-applied`, shows a macOS
   notification, and gives up after 3 hours. No agent session has to stay awake, and nothing
   blocked `ScheduleWakeup` this way. Filling a form by hand without a launcher: run
   `tools/wait-and-mark-applied.sh <job URL> &` yourself, or `apply_batch --mark-applied` after
   submitting. Details below still apply to what counts as submitted:
   - (Older method, kept for reference) On each wake, call `tabs_context_mcp` for that tab and
     compare its URL/title to the noted one.
   - Greenhouse navigates to a `.../confirmation` URL (or the page title/body changes to a
     "Thank you for applying" / "Your application has been submitted" state) once Submit succeeds —
     treat either signal as submitted. A `computer` screenshot is a fine confirmation before acting
     if the URL alone is ambiguous.
   - The moment submission is detected: mark it applied immediately, without asking — the owner
     already authorized this by asking for the automation, and the underlying hard rule ("never
     click Submit") isn't touched; this only reacts *after* a human click. Then stop rescheduling
     for this job and tell the owner it's marked. **Use `python3 -m src.ai.apply_batch --mark-applied
     <job URL>` (needs `NOTION_TOKEN`, e.g. from Keychain — see other scripts in `tools/` for the
     `security find-generic-password ... job-pilotto.notion.token` pattern), not
     `gh workflow run daily.yml -f mode=apply -f job=<URL> -f action=applied`.** The `daily.yml`/
     `src.daily --mode apply` path looks the job up in the local `jobs.sqlite` crawl cache first —
     that cache is ephemeral in GitHub Actions (can be evicted between runs) and may never have been
     populated at all for a job you only ever saw in Notion, so it silently replies "No job with
     code ... it may have closed" even for a job that's very much still open and tracked. Confirmed
     broken this way twice in a row on 26 Sep 2026 (real Canonical and Scale AI applications). Prefer
     the local `python3 -m src.daily --mode apply --job <URL> --action applied` over the `gh workflow
     run` form when you do want the digest-suppression side effects of the full `daily.py` path (it
     also works only when the job is in the local SQLite) — but `apply_batch.py --mark-applied` is
     the one that works regardless, since it reads/writes Notion directly by URL, the same way
     `--mark-applying` already did for the Applying stage.
   - If nothing changes after a reasonable bound (e.g. ~2 hours / a handful of wakeups), stop
     polling silently — the owner may still be reviewing, may submit later, or may have closed the
     tab — and fall back to the manual path below. Never poll indefinitely.
   - **Fallback (tab closed, session ended, or detection never fired)**: the owner runs
     `python3 -m src.ai.apply_batch --mark-applied <job URL>` themselves, or taps ✅ in Telegram.
   - This only works while this session and tab are alive — it is not a persistent background
     watcher across sessions. A fully unattended version would need the Cloudflare Worker or a
     GitHub Action polling Greenhouse instead; not built, since the owner is normally present to
     review and click Submit anyway.
   Then add anything new to **Platform notes** / **Log** below and commit.

## Reaching the form (job boards, employer sites, accounts) — 28 Sep 2026
The kit's URL is often not the form. Get there in as few steps as possible, one `browser_batch`
per page where you can:
1. **Job board page** (jobs.ch, TechTree, …): click its Apply button. It may open the employer's
   careers page in a **new tab**: re-read the tabs (`tabs_context_mcp`) and carry on there.
   Example: jobs.ch → `careers.<employer>/job/<title>/<id>/?utm_source=jobsch` (SuccessFactors
   career site) → its own **Apply now »** → "Career Opportunities: Sign In".
2. **Sign-in page.** Check for a stored password first (`<host>` = the sign-in page's hostname):
   `python3 -m src.ai.passwords have <host>` (prints `have` / `none`)
   - **Have one:** type the email from the CV; the extension fills the password box within ~6 s.
   - **None:** follow "Create an account" / "Register" / "Not a registered user yet?".
3. **Create the account.** Fill name, email, phone, country from the CV/Profile as for any form.
   Password: nothing to do. A new password, generated for this site alone (shown in Settings →
   Credentials), is stored for it and filled into every empty password box (password and
   confirm) by the extension within ~6 s. Optionally record the job beside it first:
   `python3 -m src.ai.passwords new <host> --no-copy --email <the email you typed> --job <job url>`.
   Check with the audit (`filled: true`), never by reading the value. If the site rejects the
   password, fit it to the rule it shows (`new <host> --no-copy --no-symbols` drops the hyphens;
   `--length 12` makes a random one for a site that wants it shorter), clear both password boxes
   (select all, Delete) and the extension fills the new one; say in the hand-over when a site got a
   password of its own. Security questions and optional profile fields: answer from
   the Profile/Application Answers like any field; leave them for the owner only when no source has them.
4. **Confirmation email:** don't ask the owner. Read it from Gmail (read-only, connected in the
   app's Settings → Gmail and Calendar):
   `python3 -m src.sources.google verify --from <employer domain> --wait 180`
   prints one JSON line with `code` and `links` (nothing else from the mailbox). Type the code, or
   `navigate` to the link, then carry on. Exit 1 = nothing came: retry once without `--from` (some
   ATSs send from their own domain, e.g. successfactors.com); exit 2 = Gmail not connected: then ask the owner.
5. **The owner's turn:** CAPTCHA ("I'm not a robot"), terms checkboxes.
   Fill everything else first, run `tools/notify.sh <job url> "Needs your input — see Terminal"`,
   say in one line exactly what to do in Chrome ("tick I'm not a robot and the terms box, then
   reply ok") and wait. Never try to solve or bypass a CAPTCHA. After the reply, click Create
   account / Sign in and continue. Account exists but no stored password: sign in once with the
   the site's stored password (the extension fills it); if refused, use the site's "Forgot password" to the
   owner's email, read the reset link with the Gmail command of step 4, set the stored password, carry on.
6. **After sign-in** the site usually lands on the application or a profile step; on a dashboard,
   open the job again from the careers page and press Apply. Fill page by page (Next / Save and
   continue is fine), audit each page before leaving it, and stop at the review or Submit page.
7. In the hand-over, name the account item (`job-pilotto.<host>.password`) so the owner can find it.

## Full automatic flow (25 Sep 2026)

**Observable Terminal Codex option (25 Sep 2026):** `tools/apply-batch-codex-terminal.sh`
starts `src/ai/apply_run.py`, which captures the Codex JSONL trace and a structured final
field/attachment report in a private local directory outside the repo. It records Next step in
Notion and, only for a review-ready report, active Form fill time (min). Check
`python3 -m src.ai.apply_run --status` for needs_user, failed, or stale runs before retrying. The
runner checks kit flags for essential eligibility, authorization, sponsorship, visa, relocation,
and required language answers before launching Codex; it records `needs_user` in the local state
and Notion Next step when one is unresolved. An unanswered personal question found by the agent
also yields `needs_user`. Resolve those facts from the owner before retrying. Use
`python3 -m src.ai.apply_run --reconcile <job URL>` to re-audit a completed local result after a
runner fix, without another model call. The report is
agent-observed evidence, not an independent browser audit or a code-level Submit lock. Never put
the private trace, applicant values, or screenshots into this skill or git.
The Terminal Codex path now injects `tools/browser-submit-guard.js` (blocks ordinary Submit and
legal-consent actions until the owner unlocks the page) and `tools/browser-form-fastpath.js`
(plain text/static-select filling and value-free field inventory). The guard catches accidents;
arbitrary browser code or unusual site behavior can bypass it. Require the guard to be active
before filling, use the deterministic helper for supported fields, and spend agent judgment on
the skipped fields. The independent cross-ATS benchmark procedure is
`docs/application-benchmark.md`; do not claim measured accuracy until it has real human-reviewed
cases.

1. **Crawl/score** — already automatic, every 4h.
2. **Auto-draft kits** — `src/ai/kit.py:auto_run`, wired into `daily.py` for `scheduled`/`run`/`today`
   modes when the repository variable `JOB_PILOTTO_AUTO_KIT_MAX` is set (score ≥
   `JOB_PILOTTO_AUTO_KIT_MIN_SCORE`, default 50; capped per run). No manual 📝 Prepare tap needed for
   jobs that qualify; a short Telegram message lists what was drafted. Idempotent — table
   `auto_kits` in the canonical DB remembers which jobs already got one, so it never re-drafts.
   Manual 📝 Prepare still works for anything below the threshold or that needs a fresh draft.
3. **Queue kits into an AI browser agent** — `tools/apply-batch-chatgpt.sh` (wraps
   `python -m src.ai.apply_batch`): reads every job **Saved** with a kit in Notion Applications,
   builds a plain-text prompt from it, and pastes+sends it into a new ChatGPT/Codex desktop chat
   via `tools/send-to-chatgpt.sh`, one chat per job. Codex fills the form and stops before Submit
   on its own approval gate. Right after queueing a job, it moves that row's Stage from **Saved**
   to **Applying** in Notion — so a second run (or the next auto-kit cycle) never queues the same
   job into a second chat. If a paste-only chat is abandoned without sending, reset that job's
   Stage back to Saved in Notion to make it eligible again. It also prints each job's
   `check_before_sending` list as it queues (and again in a consolidated summary at the end), so
   the owner doesn't have to open Notion to remember what to double-check per job.
4. **Owner reviews and clicks Submit** — the one step that stays manual, on purpose, in every chat
   it queued.
5. **Mark applied** — `python3 -m src.ai.apply_batch --mark-applied <job URL>` (or ✅ in Telegram)
   once submitted. See Steps §9 for why this, not `gh workflow run daily.yml -f mode=apply`.

So the owner's only required actions are: watch each queued chat, click Submit, mark applied.
Everything before that (discovery, scoring, drafting, opening the chat, typing into it) runs
without a manual trigger. `tools/apply-batch-chatgpt.sh` still needs a person present per chat, same as
claude-in-chrome — see "Other tools tried" below for why that step can't be made fully unattended.

## Fast path: write the framework's state directly, skip clicking

Before falling back to click-then-pick on any dropdown, date picker or multi-step widget, check
whether it's cheaper to write straight into the UI framework's own state, bypassing the DOM event
dance entirely. Idea taken from the open-source agent skill
[Li7777777/job-application-autofill](https://github.com/Li7777777/job-application-autofill), which
does this for several Chinese ATS platforms (mokahr, 北森, ...) by reading the field component's
`memoizedProps` off its React fiber (`_get_()`/`_set_()`/`options` living right on the props) and
calling the setter directly — one call writes the value through the same code path a real click
would, no menu, no portal, no animation to wait for.

- **How to find the fiber key**: `Object.keys(el).find(k => k.startsWith('__reactFiber') ||
  k.startsWith('__reactProps') || k.startsWith('__reactInternalInstance'))` — the exact prefix
  depends on the React version the site ships.
- **Confirmed working for Greenhouse's react-select (25 Sep 2026, live on a real Canonical form,
  two different dropdown fields — no click, no menu, works cold from page load):** reading
  `__reactProps` directly off the `input[role=combobox]` or its `.select__control` wrapper gives
  the *wrong* handler — an `onMouseDown`/`onFocus`/native `onChange(e)` that expects a real DOM
  event (`e.target.value`) and throws if called with an option object. The **real** react-select
  `onChange(option, actionMeta)` lives ~16 levels up the **fiber `.return` chain** (React's own
  parent-in-tree pointer — not `el.parentElement`, which walks the DOM and misses it). Find it by
  arity, not depth (depth varies by site): walk `.return` collecting every `memoizedProps` that has
  both `onChange` (a function with `.length >= 2` — the giveaway that it takes `(option,
  actionMeta)`, not a lone DOM event) and an `options` array.
- **⚠️ That react-select `onChange` is NOT the end of the chain on Greenhouse — it only updates
  react-select's own internal display state, not Greenhouse's actual field/validation state.**
  Confirmed broken 26 Sep 2026: `selectReactOption()` below made 8 dropdowns visually show the
  right value (`[class*=single-value]` read back correctly, looked completely filled in every
  screenshot) — but the owner's own real Submit click showed every one of them as "This field is
  required," meaning Greenhouse's serialized form data never actually held the value. Walking
  further up the *same* fiber `.return` chain (~4–5 more levels past react-select's own `onChange`)
  finds a **second, distinct handler: `onSelect(option)`** (arity 1, not 2 — no `actionMeta`) on a
  Greenhouse-authored wrapper component that also carries the field's live `error` string. That
  `onSelect` is the one that actually writes into Greenhouse's form state. **Always call `onSelect`,
  never stop at react-select's own `onChange`.** Reusable snippet (finds and calls the real one):
  ```js
  function selectViaOnSelect(id, matchLabel) {
    const el = document.getElementById(id);
    if (!el) return {ok:false, why:'no element'};
    const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber'));
    let node = el[fiberKey];
    for (let i = 0; i < 30 && node; i++, node = node.return) {
      const p = node.memoizedProps;
      if (p && typeof p.onSelect === 'function' && Array.isArray(p.options)) {
        const option = p.options.find(o => o.label === matchLabel);
        if (!option) return {ok:false, why:'no such option', options:p.options.map(o=>o.label)};
        p.onSelect(option);  // arity 1 — just the option, no actionMeta
        return {ok:true};
      }
    }
    return {ok:false, why:'no onSelect found (react-select onChange is not enough)'};
  }
  ```
  For a **multi-select** field (id ending `[]`, e.g. nationality), `onSelect` still has arity 1 but
  expects an **array** of the full new selection: `p.onSelect([option1, option2, ...])`, not a bare
  option.
  For **async-search comboboxes** (School/Degree/Discipline, city search — see Fast path's own note
  below and Steps §5), the wrapper's `options` prop is empty/undefined even after typing (the
  option list lives inside react-select's own internal async state, not passed up to the wrapper as
  a prop), so this `onSelect` walk finds nothing populated — the type→wait→click-the-rendered-option
  flow is the only working method for those, not the fast path at all.
- **The DOM-visible "required"/red-error state on Greenhouse is NOT a reliable live signal — do not
  trust it either way.** It does not clear reactively when a field's value changes (confirmed: it
  stayed red even after a fully genuine, trusted mouse click on the correct option, not just after
  the JS fast path) — it only re-evaluates on the app's own validate pass, apparently triggered by
  the next real Submit click. So: (a) a field that still shows red after you filled it is *not*
  proof you failed — don't loop retrying it; but (b) a field that looks unfilled or filled cannot be
  trusted from screenshots alone either — **always confirm real state by calling the same
  `onSelect`-owning fiber node's props again and reading the current `error` string live, or by
  reading `[class*=single-value]` right after the `onSelect` call**, not by trusting an old
  screenshot or an old required-list scan taken before the fix.
- Whether or not the direct write works, always verify by reading the value back from the DOM
  (`[class*=single-value]`, not `.value` — react-select clears its search input after a pick) —
  but remember this only confirms react-select's *display*, not Greenhouse's saved value; the
  `onSelect` call above is what actually needs to have fired.
- This is worth 30 seconds of trying per new platform; fall back to real-click-then-JS-pick the
  moment it doesn't pan out. Record which one worked in Platform notes below.
- **Verify with a real Submit click is the only ground truth for this bug class.** Since the owner
  is the one who clicks Submit anyway (hard rule), their first real click doubles as the definitive
  validation check. If they report fields showing as required/empty despite looking filled, that is
  this exact bug — re-fill with `onSelect`, not `selectReactOption`/`onChange`.

## Platform notes (kept private, delivered with the context)
The per-board notes (Greenhouse, Ashby, Lever, and the application systems not seen often) are the product's learned knowledge, so they
no longer live in this public file. `python3 -m src.ai.apply_run --context <url>` prints them for this job's board under
"Platform notes" (fetched from the Jobadabra service); if it prints none, work from the generic rules in this file. Do not write
board-specific findings into this file: report them in the run's `--record` learning, and the owner folds them into the private playbook.

## Efficiency
- Batch: one JS call to map, one to fill text, try the fast path for each dropdown, then
  click/pick pairs for whatever it couldn't handle, one JS call to verify.
- **Screenshot scale danger (caused a real misclick 25 Sep 2026):** a screenshot taken at
  `scale < 1` returns an image whose pixels are NOT the coordinate frame the `computer` tool
  clicks in — the tool result states the full-resolution frame size, but it's easy to eyeball a
  position on the smaller image and pass those smaller numbers straight through, landing ~1/scale
  off target. Either take screenshots at `scale: 1` when you're about to click from them, or
  multiply the coordinate by `1/scale` before clicking. Prefer clicking by element `ref` (from
  `find`/`read_page`) over pixel coordinates when the page hasn't scrolled since the ref was taken;
  refs go stale after a scroll or re-render, so re-`find` after either.
- Don't re-read the kit or Notion pages already read in this session.
- For a form with no reusable ATS pattern (a one-off Google Form, a random careers page), plain
  click-and-type is fine — don't spend time hunting for a fast path that will never be reused.

## Other tools tried (25 Sep 2026) — none replace this skill, keep for context

Compared claude-in-chrome against three alternatives on real forms, no submission:
- **ChatGPT Atlas** — discontinued by OpenAI; its own shutdown screen points to a Chrome
  extension or the ChatGPT desktop app instead.
- **Perplexity Comet, signed out** — could not act on the page at all ("I'm unable to interact
  with the browser page"); its agentic "Computer" feature is paywalled behind Perplexity Pro.
  Not tested with Pro.
- **ChatGPT/Codex desktop app** (`tools/send-to-chatgpt.sh` pastes a prompt into it, since there's
  no API/MCP access to read its results back — only the owner can watch and report) — genuinely
  filled real fields on the harder Canonical form (contact details, résumé, LinkedIn, long
  free-text SRE/infra answers), took ~10 minutes, and deliberately left personal/subjective/legal
  fields (academic history, travel commitment, employer count, the privacy-acknowledgment
  checkbox) for the owner even when the prompt supplied answers — the stricter rule now adopted
  above. Not wired into the Jobadabra pipeline (no Notion/Telegram/GitHub Actions trigger); the
  owner drives it by hand.

None of the three beat this skill on "actually fills the form, stays inside the pipeline, review
gate enforced in code rather than by the model's own judgment call." Re-test before switching.

## Log (newest first; one line per application or finding)
- 2026-10-01 · process · The extension fills a later page in the opened tab, and a tab that tab opens. It leaves a password page and a page with no form, and says so (`account`, `no-form`) for Claude to click through.
- 2026-09-28 · process · Apply with Claude hands known forms to the extension first (ticket from the
  app, `jobpilotto:fill` event, result in `data-jobpilotto-fill`), then fills only what it left.
- 2026-09-28 · process · Owner: the extension can't get past job board Apply → employer site →
  Apply now → sign-up (jobs.ch → a SuccessFactors career site). Apply with Claude (Desktop App row
  button, recommended) does it now: "Reaching the form" added; "never create accounts" replaced by
  sign-up with a Keychain-generated password pasted from the clipboard.
- 2026-09-26 · Greenhouse · Grafana Labs Staff SWE Databases SRE (re-fill) · fiber keys were visible this
  time and `selectViaOnSelect()` returned ok for all 5 dropdowns, but 4 of them (every `question_<n>`
  Yes/No + bot-check) rendered empty afterwards — only the phone `country` kept its value. What worked:
  JS `.focus()` on each `input#question_<n>` + `computer` type of the option text + `Return` (trusted
  keys, reaches the real handler, no coordinates) — all four set in one `browser_batch`. Same for
  `candidate-location`: a coordinate click on the option from `getBoundingClientRect()` did not stick;
  type city + `Return` (first match) did. Also fixed `__jobPilottoAuditVisibleFields`: its combobox
  check matched a nearer `[class*=container]` and reported filled dropdowns as empty; it now prefers
  `select__container`. No education/EEOC/cover-letter file field on this form; cover letter went into
  "Anything else". Resume uploaded last, held.
- 2026-09-26 · Greenhouse · Anthropic Staff SWE Infrastructure · no React expandos (`__reactFiber*`)
  were visible on any element from the extension's `javascript_tool` context on this board, so
  `selectViaOnSelect()` found nothing (not blocked, just invisible — likely an isolated JS world).
  Worked in one `browser_batch`: `computer` left_click by `ref` on each combobox, then a JS `.click()`
  on `[id^="react-select-<id>-option"]` matched by text (phone `country`: type the country first).
  Native-setter text fills still worked. Form has no Education/EEOC section; its "AI Policy for
  Application" dropdown is an acknowledgment ("confirm your understanding by selecting Yes") → left
  for the owner as a legal-acknowledgment field. "Additional Information" invites a cover letter →
  took the kit's `cover_letter`. Resume uploaded last; held through the final check.
- 2026-09-26 · Greenhouse · Canonical Site Reliability / Gitops Engineer · **critical fast-path bug
  found and fixed**: the owner clicked Submit for real and got "This field is required" on 8
  dropdowns that were visually filled correctly (`[class*=single-value]` showed the right text in
  every screenshot). Root cause: `selectReactOption()`'s fiber walk stops at react-select's own
  `onChange(option, actionMeta)`, which only updates react-select's internal display — Greenhouse's
  real form/validation state is written by a separate `onSelect(option)` handler a few more fiber
  levels up, on a Greenhouse-authored wrapper, which the old snippet never reached. Also discovered:
  Greenhouse's red "required" error banners are NOT reactive to value changes — they stayed red even
  after a fully genuine trusted mouse click, and only re-evaluate on the app's own validate pass
  (apparently tied to the next real Submit), so the banner is not usable as a live correctness
  signal in either direction. Fixed live on the form via a new `selectViaOnSelect()` helper (see
  Fast path); all 8 fields plus the standalone EEOC fields and Education re-verified correct
  afterward. Every place the skill referenced `selectReactOption()` for Greenhouse has been updated
  to point at `selectViaOnSelect()` instead — this was the default technique for every Greenhouse
  application since 25 Sep 2026, so past applications filled this way may have silently submitted
  with fewer answers than they appeared to have; worth a spot-check if any are still pending.
- 2026-09-26 · Greenhouse · Canonical Senior Site Reliability Engineer · owner caught the resume
  silently missing after hand-over ("I don't see the CV uploaded") — it had attached successfully
  mid-flow, then a later field interaction reset `input#resume` to empty with no error. Re-uploaded
  and confirmed held this time. Added a standing rule: upload the resume LAST, after all other
  fields/dropdowns are filled, and re-verify it immediately before handover rather than trusting an
  earlier successful upload result — see Steps §6 and Platform notes above.
- 2026-09-26 · Greenhouse · Canonical Site Reliability / Gitops Engineer · owner caught two classes
  of bug after hand-over: (1) Education section (School/Degree/Discipline) left as "Select..." —
  the kit doesn't carry it and it's not browser-required, so it was skipped entirely; fixed live
  from the Profile page's `# Education` table by typing into each async-search combobox and picking
  the match. (2) Three standalone EEOC fields (`gender`, `hispanic_ethnicity`, `veteran_status`)
  were filled with the kit's generic "decline to answer" default instead of the Profile page's
  specific confirmed answers (Male, No, not a veteran) — fixed live. Added both as standing rules
  above (Profile-over-kit for demographics; Education is not optional) so future runs don't repeat
  either.
- 2026-09-25 · Ashby + Lever, first look · tested live on real forms (DeepL "Head of Product
  Growth", Palantir "Backend Software Engineer") — no login, no submission, nothing sent. Neither
  needs Greenhouse's fiber trick: Ashby renders native checkboxes/radios with real `<label for>`
  text despite being React; Lever isn't React at all, plain `.value` assignment works everywhere.
  Both simpler to fill than Greenhouse once on the live page; neither platform's public listing API
  exposes application questions (only Greenhouse does), so kits for these still rely on likely-
  question guesses, not real ones. See Platform notes above.
- 2026-09-25 · Greenhouse fast path confirmed · validated live on a real Canonical application form
  (two react-select fields, gender and a Yes/No question): the fiber `.return`-chain walk finds
  react-select's real `onChange(option, actionMeta)` by arity (`.length >= 2`) and calling it
  directly sets the value with zero clicks, works cold, no menu ever opens. Promoted from
  "untested" to the default first attempt for Greenhouse dropdowns — see Fast path above.
- 2026-09-25 · Tools · compared against Atlas (discontinued), Comet (needs Pro, couldn't act
  signed out) and the Codex desktop app (worked, slower, stricter on legal fields) — see "Other
  tools tried" above. Added `tools/send-to-chatgpt.sh` to paste prompts into the desktop app.
- 2026-09-25 · Skill · pulled in a fast-path idea (write framework state directly, skip clicking)
  and a leak-guard rule from the open-source skill Li7777777/job-application-autofill; fixed a
  screenshot-scale bug that caused a real misclick during today's fill (see Efficiency).
- 2026-09-25 · Greenhouse · Grafana Labs Staff Databases SRE · form fully filled (all fields,
  CV uploaded, all 4 dropdowns), verified field-by-field, left open for the owner; nothing
  submitted. One misclick along the way (screenshot-scale bug, see above), caught and corrected.
- 2026-09-25 · Greenhouse · Canonical Senior SRE · form filled from a session that started outside
  job-pilotto (had to `cd` in and read SKILL.md as a plain file — the `Skill` tool never picked up the
  project-scoped skill after `cd`, see "Before you start" above). Owner self-assessed dead time
  afterward and asked for fixes: added the skip-schema-fetch SQL shortcut for kit lookup, the
  phone-country-code-vs-work-country field disambiguation, and the resume-upload verification note
  (all folded into Platform notes / Before-you-start above). Also hit a permission-classifier denial
  on the Steps §9 auto-mark-applied `ScheduleWakeup` ("External System Writes") — noted as a known
  gotcha instead of a thing to rediscover each time.
