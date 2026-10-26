# Desktop UI: one design system

Read before building or changing a screen in `desktop/renderer`. Also read the skill `ui-look-and-feel`. Linked from CLAUDE.md.
Why each rule exists: [why.md](why.md#desktop-ui).

## Design system (owner, 17 Oct 2026): read first
The design system page, built from this repo: `cd desktop && npm run design-system` (local, opens in the browser; tokens, the real components in their states, these rules marked approved / legacy / proposed, and a snapshot zip for Claude or ChatGPT; `tools/design-system/build.mjs`, no AI). The old hand-made Artifact is superseded.
Living copy: `npm run gallery` (sections "Chips" and "Value → control", drawn by the screens' own code). How to apply it: skill **ui-look-and-feel** §0.
- **The value's kind picks the control.** Short text → a field sized to it; long text → a box that grows; yes/no → two buttons; one of ≤ 3 short → segmented;
  one of many → a menu; several → chips with × + Add; date, amount, salary, duration, link, per country, language + level, range → `answerControl(formatFor(...))`
  (`renderer/question-control.js`). **Filters: any of several → the multi-select** (`renderer/multi-select.js`: a button, a checkbox list with counts and Clear, ticked
  together = union; the Jobs Show menu, `jobs-filters.js`; owner, 24 Oct 2026: a chip row of filters becomes one multiple dropdown). Never prose in a text box: a value is split into its parts, the rest is a note.
- **Read views are rows and chips, never prose bullets.** Label → value rows (`.summary-rows`), several values as chips, a missing one as `pill('Not set', 'warn')` with its action.
- **A note for the AI** (a date it was confirmed, "use the closest option") is a muted line under its value, never inside it; edit: a folded "Note for the AI".
- **Chips are values, pills are status, tags are labels.** `chip(text, {detail, tone, onRemove})` (components.js) shows a value as a person writes it: no quotes,
  /regex/, codes or stored comma lists (show their meaning: a group "Whole word only"); duplicates folded. No new chip class (14 existed; they move to chip()).
- **Nothing cut.** A saved value always fits its box; a row title is one line with … and the full text on hover; a question two lines. Prose ≤ 72 characters wide.
- **Spacing from the scale:** label → field 4, field → field 12, card padding 16 (a settings card 24), card → card 16, section → section 32. Two columns only for short fields.
- **Card or section:** a card is one topic you read or act on; never a card in a card (inside: rows, dividers, a table). One primary button per card.
- **Icons alone only on secondary buttons** (owner, 18 Oct 2026: "let's leave icons only for secondary buttons"): a primary button, and a row's main action, always shows its words (an icon beside them is fine);
  an icon-only button is a secondary one with a tooltip and an aria-label. Fails: `desktop/test/design-buttons.test.js` (every renderer file) and the UI check's `icon-only-primary` (every view).
- **Contrast AA in both themes:** text 4.5:1, a field's edge 3:1. A filled accent is the website's amber `--signal-solid` with `--on-signal` (dark ink, never white); links `--signal`; a selected card or active tab edge `--signal-edge`; one amber brand (owner, 24 Oct 2026), guarded by `brand-colour.test.js`.
- **What fails a change:** `desktop/test/contrast.test.js` (token pairs, both themes), `text-fields.test.js` (a new free text box: use the typed control, or
  raise the file's count in `text-fields-allowed.json` with the reason), `chip.test.js` (raw chip text, a new chip class), `design.test.js` (raw values), `brand-colour.test.js` (a hard-coded orange in the app or extension);
  `npm run shot` prints every saved value cut by its box; `tools/pr-body.sh` refuses a desktop-window PR without the 6 **Design checks** ticked.

- **Run results show one number: the jobs added to the list** (owner, 24 Oct 2026: "too many numbers", "User is not curious about scored, scoring", then on the card's Details "Do we need them? I don't think so"). The Find jobs card, the live search page, the Recent activity run cards, the finished-run notification and the Telegram digest header lead with it (`find-card-model.js` `addedSoFar`/`addedWords`, `run-cards.js` `runNewCount`); every other count (open, in your places, applied, scored, strong matches, the waiting queue) is not shown, and there is no Details. The headline sits in one rounded box. Guard: `desktop/test/run-cards.test.js`, `find-card.test.js`, `live-dots.test.js`, `run-history.test.js`, `tests/test_digest_counts.py`.
- **Result panels stay basic; details live only in Reports** (owner, 24 Oct 2026: "is all of these information necessary to be displayed? Does he care?"): no API-key setup rows (Adzuna/Jooble, Brave, SerpApi are hidden behind `KEY_SOURCES_OFFERED`, `src/coverage.py` + `desktop/renderer/key-sources.js`), no internal counts (employers checked, ideas left, schedules, who started it, which machine), no scoring words; one number, one message, one action. "Browse sites manually" lists only sites the automatic read stopped at (`visits.left_to_hand`). Guard: `desktop/test/result-panels-basic.test.js`, `tests/test_visits.py`.

## Cards: read → Edit → editor; one save bar (owner, 18 Oct 2026, UI redesign)
Every Profile and Strategy card works one way ("so nice, so clean"). Parts: `renderer/card-shell.js` + `card-shell.css`, `components.js` `cardEdit`, `renderer/save-bar.js`;
living copy: `npm run gallery` → "Card shell"; API for other sessions: `~/job-pilotto-ui-mockups-2026-10-18/SHARED-PARTS.md`.
- **Header:** icon, title, one-line description (`.panel-lead`), then at the right a quiet **✎ Edit** (`cardEdit`: neutral outline, pencil + word, always visible) and the chevron. Same place on every card.
- **Read view by default** (`.card-read`): `readRows` (label → value; empty = `pill('Not set', 'warn')`; a note for the AI is a muted line under its value) and `chipLine`
  for several values ("English · B2", "Romanian · Native"). Never the editor's controls just to read.
- **Edit** (`setEditing(card, true)`): Edit hides, the card stays open (a folded one opens), `.card-editor` shows `editRows` (one aligned label column, full-width controls).
  Drafts survive switching tabs and folding; leaving the editor never drops them. An editor with no change closes with the shared quiet **Done** (`doneButton(card, count)`,
  shown only at 0 changes); with changes, Save all / Discard all close it. Never a card's own Close or Cancel. A Profile page bar is `pages/profile-save-bar.js` `profileBar()`.
- **No Save, Cancel or Discard on a card.** Each card registers a source with the page's one `pageSaveBar`: "N unsaved changes in <tabs>" · **Discard all** (asks when drafts sit on
  more than one tab) · **Save all changes**. Tabs with drafts get a dot. A failed check saves nothing and names tab + field; a part-way failure keeps the failed drafts
  and names them, never a blanket "Saved". Leaving the page (`guardLeave(view, bar.leave)`) or closing the window (`lib/unsaved-guard.js`) asks first. The bar sticks above Application sessions.
- **Not drafts:** actions with their own button keep their behaviour (read the CV again, an AI review, Generate, Review questions).
- **Amber = the one current primary action.** Filled amber with dark ink (`button.primary`) only for Save while there are drafts, or the screen's single next step (Review questions, Generate).
  Edit, Add, "View source in Notion", "Fill from my CV" are quiet (secondary, ghost or in the ⋯ menu); one "View source in Notion" per page, in a secondary menu.
- **What fails a change:** `desktop/test/card-system.test.js` (a card's own Save/Cancel/Discard in code or in the Profile/Strategy markup; a filled Edit), `card-edit.test.js`,
  `card-shell.test.js`, `save-bar.test.js`, `unsaved-guard.test.js`. Cards not moved yet are listed in `card-system.test.js` KNOWN_LEFT / MARKUP_LEFT: the lists may only shrink.

## Roomy cards (owner, 18 Oct 2026, mockup 03 approved: "Look at the cards with chips how roomier they are") [approved]
Strategy and Profile cards read like the owner's mockups. Parts: `renderer/roomy-cards.css` (a page opts in with `.roomy-cards` on the cards' container), tokens
`--card-pad --tile-lg --fs-card-title --fs-value --chip-pad --chip-pad-x`; living copy: `npm run gallery` / `npm run design-system` → "Roomy cards".
- **Header** `cardHead({glyph, tone, title, lead, badge, action})` (card-shell.js): a tinted icon tile, the title (18px bold) over a one-line lead, the action at the right.
  In a roomy card the quiet Edit has no box: pencil + "Edit" in the link colour.
- **One layout per screen: every label on its own line** (owner, 18 Oct 2026: "Either we're fully inline, either we're fully on the new line", picked
  "all on a new line"): `readRows(rows, {lined: true})` with an `icon` per row draws icon · label (ink) over the value, a list's chips in that same value
  place; dividers full width. No section headings between rows (the label says which side), no heading-over-chips block beside label | value rows.
- **Chip text lines up with plain text**: a chip row (and a "Not set" pill) is pulled left by its own side padding (`--chip-pad-x` + border), so
  "Amsterdam" in a chip starts where "Not specified" starts.
- **Figures** `summaryTiles(tiles, {divided: true})`: no box per tile, a divider between them, 3 across (4 goals: 2 × 2); "+N more" (`more`) and a status
  (`badge`: "As written", "Estimated", its words on hover) sit inside the value, never as a line under it.
- **Side by side** `.roomy-pair` where both fit; unset rows of one kind fold into one quiet row ("Must-haves: Any home base, employment type, workload"); long lists show 10 chips and "+N more".
- **Profile cards** (mockup 05, owner approved 18 Oct 2026): `.setting.panel.roomy` with the header in its `.panel-top` (`summary-head card-head`: teal tile,
  `card-words` = title over its lead; the fold keeps working). Facts read as columns, `factColumns(cols)` (card-shell.js): icon · small label over the
  value, a divider between columns, the note for the AI on hover with an info mark (never a line under the value), "Check" as a pill after it. Contact:
  the name (salutation before it) over the location | icon lines; an empty detail says "<label> not set". Voluntary surveys: one "Saved preferences"
  line (`survey-rows.js surveyRead`), every answer folded under it.
- **What fails a change:** `desktop/test/roomy-cards.test.js` (every Strategy card in `.roomy-cards` with a `cardHead` header, every Your details card `.panel.roomy` with its header; rows stacked, no settingBlock or inline label column; the parts' shapes).

## Page blocks: review list, empty state, tiles, reference row, counts, page header (18 Oct 2026, UI redesign) [proposed]
One shared version of each, never a page's own (`renderer/page-parts.js` + `page-parts.css`, `renderer/shared-counts.js`; living copy: `npm run gallery` → "Page blocks").
- **Review list** `reviewList(items, {doneLabel, empty, statusAt, joined, doneSummary})`: each item = title, why it is here, where it came from, a status chip, its
  actions (filled amber only for the first pending `primary`; others outlined, or `link: true` for Dismiss/Undo; `aria` names the row when rows share action words).
  Pending first; done ones folded as "Reviewed · N" (+ `doneSummary`). `statusAt`: `end`, `first` (a priority, fixed width, mockup 08) or `title` (beside the
  name, mockup 06); `joined`: one box with row dividers (mockup 06); `detail`: the whole row opens it, "View details ›" at its end (mockup 08).
- **Empty state** `emptyState({icon, chip: 'Not created', title, text, actions: [primary, quiet], note})`: a neutral chip, an icon, one line, two actions.
- **Summary tiles** `summaryTiles([{key, icon, tone, label, value, note, title, score, max}])`: icon, label, big value; empty = "Not set"; as many across as fit (≥ 240px each).
  A `score` (of `max`, default 100) draws a ring in the tone (good / ok / low) in place of the icon (CV scores).
- **Reference row** `referenceRow({text, from: 'From Your details', link: 'Edit in Your details', open})`: a fact kept on another page, one quiet link there.
- **One count, every place** `defineCount(name, compute)` + `paintCount(name)`: the banner (`data-count-of` + `data-count-one`/`-many` for words), the filter
  chip and the tab badge (`data-count-of`) are painted from the same function, so they never disagree; 0 hides them unless `data-count-zero="show"`.
- **Page header** (`header.view-head`): `h1` + one muted lead line, then `.head-actions`: the sync status (`.synced`), quiet buttons, the ⋯ menu (`moreButton`,
  "View source in Notion" lives there), **at most one** `button.primary`; the page's `.tabs` come right under it. Profile uses the same parts in `.settings-page-head.has-action`.
- **What fails a change:** `desktop/test/page-parts.test.js` (each block's shape; a page header with a second primary button; Strategy's tabs not right under its header).

## Read views, lists, buttons and choices (owner's UI feedback, 18 Oct 2026) [approved]
The owner's review of Strategy and Your details, kept as rules. Don't / Do pairs drawn with fictional data: `npm run design-system` → "Don't / Do".
- **A read view shows values, never raw notes** ("What is this long text?"): no `[language]`-style tags, "(note: …)", "(confirmed …)" or AI instructions inside a value.
  A date it was confirmed is a muted line under a text value (never under chips: see "Chips and words" below); anything longer folds as the card's one **Note for the AI**.
- **Long lists fold** (Relocation's ~80 places): more than a dozen items show as the first few chips and "+N more", never a paragraph.
- **Aligned rhythm** ("nothing randomly placed around the screen"): settings sit on a label column or a row grid, with separators or tinted row backgrounds between them.
  Each single value is **label column + value**, the value starting on the label's line; a chip list may sit on its own line under its label, as in
  mockup 03's Locations ("Preferred locations" over its chips). The labels of one card share a left edge; wide lists of settings have a divider or a tint between rows.
- **Chips and words: no lone line above or below a chip row** (owner, 18 Oct 2026, #1513 rejected: "I gave you feedback about the chips vs text/labels
  positioning/placement"). A qualifier joins the label or is a badge in the row, and a "Yes" that the chips already say is dropped:
  `Preferred · ranked first | [Amsterdam] [Berlin]`, never `Preferred | [Amsterdam] [Berlin]` with "Ranked first" under them, nor `Relocation | Yes` above the places.
  The same for a lone line under a list ("Please confirm or discard each.") or under a button (a cost goes in the button: "Draft the letter · ~$0.02").
  An editor's hint under its control is not a caption.
- **A sticky bar never covers content** (#1515): scrolled to the end, nothing stays under it. A fixed bar needs the page's bottom padding ≥ its height; a sticky
  bar lifted by an offset (the save bar over the Profile fold bar) needs that much room after it in the flow (a scroll box's padding does not count for it).
- **States differ by colour, not only weight** ("inexistent contrast, no colours"): Now vs Proposed, Strategy vs Profile. The proposal gets its colour
  (a tinted row or an accent edge); both stay AA readable.
- **Buttons: normal height, words on one line, one primary per card** ("the Accept button is too fat"). Several rows each with an action use a quiet button per row
  and one primary for the whole card ("Accept all").
- **A choice shows only the difference** ("text is too much, hard to read"): what changes, as chips or a short line, not two full paragraphs.
- **Edit forms: the value's kind picks the control** ("too many fields, it's overwhelming"): chips, segmented, a menu, a slider (see "Design system" above).
  No repeated group of dropdowns per row; one **Note for the AI** fold per card.
- **One row per field:** a field is never shown twice in a card (Race / ethnicity appeared twice).
- **Modern controls over plain fields** ("I like more card picker than the selectbox/dropdown/textfield… any other more modern component"): a few choices →
  a card picker or segmented buttons; a set → chips; a number on a scale or range → a slider; a menu (`select`) only for a long list (country, currency), searchable
  (`.select-search`) or marked `data-long-list`; a text field only for real prose. This refines "the value's kind picks the control" above.
- **What checks a change: the owner's before/after shots** (owner, 18 Oct 2026: "I can check by myself, on the before/after screenshots... Every session
  should be able to read the UI Design system and make the UI accordingly, from the development phase"). The automatic design-rule checks
  (`desktop/e2e/lib/design-rules.mjs`) are **parked**: no journey, test or PR runs them (`DESIGN_RULES_ON = false`), and their `KNOWN_LEFT` list is moot.
  Before writing UI, open the design system (`cd desktop && npm run design-system`), find the component for each value and build only from those;
  the "Don't / Do" pairs show what the owner rejected and what to build instead.
- **Before a PR: one side-by-side preview, the owner's yes** (owner, 18 Oct 2026: "this workflow is probably even better than just relying on the PR
  before/after... Every session that works on UI, should open a preview image with side by side"). ONE image: reference (the owner's mockup, or today's
  screen as before) | your render, demo data, same scale, labelled (`cd desktop && npm run side-by-side -- <reference.png> <render.png> --out <file.png>`);
  light and dark are two images; the file name starts with the session's short name (`npm run side-by-side` adds it: `a2-<name>.png`), so the owner sees whose preview is open. `open` it for the owner, ask ship / change what (AskUserQuestion, with a recommendation), and ship only after his yes.
  The PR's before/after stays the record.

## Structure
- **The window is one module per page** (`desktop/renderer/pages/`); `renderer/app.js` only runs each page's `init()` in order. Helpers every page
  uses are in `pages/core.js`; state more than one page *reassigns* lives on `shared` (`pages/shared.js`), since an imported binding is read-only.
  Logic testable without a window goes in its own small module (`renderer/session-message.js`, `session-state.js`) with a test in `desktop/test/`.
- `electron .` works in any worktree: `desktop/start.js` builds `shared/` when it's missing; a test run (`JOB_PILOTTO_SMOKE…`) that can't start
  prints why and quits.

## Checking a UI change (the tier decides how much)
- **Tier 0** (copy, CSS): no screenshot; the tests.
- **Tier 1** (a feature, a screen or state): one targeted shot of the whole surrounding view at real size, compared with its siblings:
  `npm run shot -- <page> --js "<force the state>" --select '#id'` (~5 s); `--eval "…" --no-picture` reads `window.__jp` as JSON; `--reload` tests after ⌘R.
- **The full reference set** (`npm run ui-shots`): only for big changes, about daily, or when the owner asks.
- **PR screens are one table, always** (owner, 17 Oct 2026, #1290: two stacked full-window shots, no caption, "it's not clear"): every image sits in a row of
  `| What changed | Before | After |`: the caption says what changed and where to look (a few words), then the before image, then the after image. A new screen: `—` before and the reason in the caption.
  Shoot **the changed card, not the window**: `npm run shot -- <page> --select '<card>' --mark '<the changed control>'` with the SAME options on the before build and the after build
  (`--mark` draws a red frame, `--mark` can repeat); a full window only for a layout change (sidebar, spacing between cards). Enforced twice: `tools/pr-body.sh` at ship time and
  `tools/pr-body-check.py` in the required CI job (`tools/pr-screens.py`; tests `tests/test_pr_body.py`, `desktop/test/shot-mark.test.js`).
- **PR images: at most 5 before/after pairs, usually 1-2** (owner, 17 Oct 2026; `tools/pr-body.sh` refuses more than 10 images).
- **PR images are published with `node tools/pr-assets.mjs pr-assets-<branch> <png>...` (a git tag + raw URL), never a GitHub release**: a normal release becomes "Latest" and the Download link points at it (17 Oct 2026; `tests/test_release_guard.py`, hourly `release-guard.yml`).
- A screenshot tool that fails for tooling reasons: drop it once, say so; don't sink time into it.
- **Screenshots show no first-launch overlay** (owner, 17 Oct 2026: the menu tour covered the sidebar in PR shots). Every capture tool runs with `JOB_PILOTTO_SMOKE`, so the page loads `?capture=1` (`lib/e2e-hidden.js` `captureQuery`); a new one-time overlay (tour, hint, what's new) checks `captureRun` (`renderer/menu-tour.js`) like the tour does.

## A detail screen is cards, tiles and bars, never a plain table (owner, 25 Oct 2026) [approved]
A new Reports tab or detail screen starts from the app's own widgets: `summaryTiles` for the main figures (icon, tone), a `.card` per topic with a small category label and a title, `.bar` rows for shares and durations, `pill()` for status and `chip()` for values, a tone on a run row's left edge, folds for the long rest. A `.data-table` is for a list of like rows, not for a report. Why: the first Searches tab (a table per topic) was called "the most ugly and basic design I ever seen"; rebuilt from the tiles, cards and bars the Focus and Jobs screens use, the owner said ship (session ee, Reports → Searches). Before any preview, put the screen next to `docs/ui/jobs.jpg` and `focus.jpg`: if it looks plainer, rebuild it before asking.

## One run view: the drawer shows one run, Actions → Runs shows them all (owner, 25 Oct 2026) [approved]
- **One run panel, one design.** The bottom drawer and Actions → Runs show the same run panel (`.ap-detail`, drawn by `renderActivity`). There is never a second template. Switching containers keeps open folds, typed answers and the log's scroll.
- **Words:** "Runs" everywhere: Recent runs, View all runs, Open in Runs.
- **The drawer shows one run, never the list.** The generic Details opens the running task, else the next queued task, else the latest finished run. With several queued, a quiet "N tasks queued · View queue →" opens Runs filtered to queued. Once a run is open, it stays selected: queued → running → done update the same panel, and a new run starting or finishing never switches it. Open in Runs keeps the selection and closes the drawer.
- **A queued run's panel:** name, a Queued pill, "Waiting for <task> to finish" (else "Waiting to start"), its place in the queue only when known, and Cancel. No empty log, no progress bar, no start-time guess.
- **Inside one run, only that run.** No global schedule (Upcoming runs lives on Actions → Runs, above the list, and in the bottom bar). A search run lists "Added in this run", never the digest's "since your last digest". The amber box shows only for a warning or a problem. The header does not repeat what the card says.
- **Runs list:** Task, Status and Date filters you can see, Load more, and the selection kept as new runs arrive. In a narrow window it is list → detail with "Back to runs".
- **A run shows in all three places, never fewer** (owner, 25 Oct 2026): Actions (where you clicked: feedback on that page, a collapsed drawer is easy to miss), Jobs for Find jobs (its Find jobs card, already compact for that screen: don't touch it), and the drawer.
- **A finished run is ONE result card in its run panel, the same frame for every kind** (owner, 25 Oct 2026: "Instead of having 3 cards representing the status/result, there should be one single card, or an unified view… consistent across runs"; "let's try to uniform them as much as possible… not build with AI which just spit random inconsistent components"). Never a problem box + a steps box + a result box stacked for one run. The frame: the top (how it ended + the one number, why, its actions, the log), then the bottom, the only part that differs per kind. Step rows show only while a run runs; an ended run's steps and failed sources are in its full report, never in the drawer (owner, 25 Oct 2026: "this one I don't want to display it in the drawer"; "We'll have the Reports -> Searches which will be more details") (a Gmail check has ~9 views), built only from shared parts. A view that needs a new part adds it to the shared set, never a one-off. Advice (ways to find more) is not the result.
- **A backbone, not one template** (owner, 25 Oct 2026: "we want to support different runs views… I don't want to lose that work… we should just be consistent and have a backbone, have a system, a design system"; "Every action run loading should be in the same way. Every action run result, should have its status in a consistent way… And the information we display should all be coherent. It should not contradict, confuse or overwhelm"): every run loads the same way (spinner, current step, live count) and shows its status in the same place (started, ended, how long, the pill, Run again when it did not work, the log, warnings in one spot). Each kind keeps its own rich result view (Gmail's views, kits, Analyze's finding, Find jobs' list) inside that frame. Each fact has one source and is said once: never two places that disagree ("Interrupted" beside "Nothing new since the last check"), a count that matches what is named, no stray markers.
- **Find jobs has four levels of detail, each in its place** (owner, 25 Oct 2026: "the compact in-app version in Actions, another type/compact version in-app in Jobs… a medium-detailed in the drawer… the full report, most detailed in Reports -> Searches"): Actions = the compact banner; Jobs = its Find jobs card (its own compact shape); the drawer = the medium result card (how it ended, the number, the next step, the jobs it added); Reports → Searches = everything (steps, sources, funnel, scoring). A detail lives at one level and the level above links to it, never repeats it.
- **A report's widgets: two per row, one height, the log last** (owner, 25 Oct 2026: "Technical log should be last, full-row. The others, which have fixed height, and not too much content, they can 2 columns per row"; "it's very important to not have weird empty spaces. But rather have same height for all the columns"): cards sharing a row stretch to one height (content at their top); an odd card out takes its whole row; the Technical log is always last, at full width. One grid for every card grid: `.card-grid` (components.css) with `.is-wide` for a full-row card, and `pairRows(grid)` (renderer/card-grid.js) after drawing, which widens a card left without a partner; the Searches report puts its wide ones last (renderer/searches-view.js). **Every card grid on every page follows it** (owner, 25 Oct 2026: "on strategy -> Advanced settings, we have 2 columns with very different heights, let's better have 1 column, and full rows cards"): cards whose height varies with the user's data (lists of chips, long settings, logs: Advanced search settings, Locations, Job preferences, the Profile's background) are `.is-wide`, one column; small fixed cards (Tailor | Gmail, the Settings overview, Export | Import) sit two per row at one height. Guards: test/card-grid.test.js, test/searches-view.test.js, test/report-grid-layout.test.js, test/card-grid-layout.test.js (every page's grids, measured).
- **A search's full report stays in Reports → Searches** (owner, 25 Oct 2026: "I want the search reports to be in reports, as this is the most advanced/complex action"; the earlier plan to move it into Actions → Runs is dropped). The run panel shows a Find jobs run like any run, and its "Full report →" opens Reports → Searches. Never move or duplicate the Searches report into Runs.
- **One run, two versions, one look** (owner, 25 Oct 2026: "even if we show the same card in 3 different places, the UI of it should be the same"; "for all runs/tasks 2 versions: one compact which will show in app, and another one detailed which will show in Actions → Runs, or in the Drawer"): on Actions a run is always the compact banner (the running banner's shape: icon or spinner, task name + status pill, one meta line, then up to three buttons: the kind's next step or a failure's fix, **Run again** on any end that did not work (when Actions has that task's Run button), **View details**; then Stop/Cancel/Dismiss). Every kind is in `NEXT` or `NO_NEXT` (`renderer/run-compact.js`). The full report (site lists, cards, log) is only the detailed run panel: the drawer or Actions → Runs. Never a detailed result card on the Actions page. A run that saved nothing says **No result** everywhere (`runPill`, `outcome`); its Read again is in the run panel. Guard: `desktop/test/run-compact.test.js`.
- Guard: `desktop/test/run-view.test.js`.

## Reuse, never one-off
- **A new feature looks like the old ones.** Whatever a task, run or message shows, find the nearest existing one first (`pages/activity.js`
  render*Card, `components.js`) and reuse its card; never show engine or Telegram text in a `<pre>`. A new task kind needs, in the same change:
  1. a parser for its message + a render*Card on the insight-card shape, with a test; a line in `desktop/test/fixtures/engine_messages.py` (made
     by the engine's own writer) and a case in `engine-message-contract.test.js`;
  2. its kind in `CARD_KINDS` (`renderer/run-cards.js`);
  3. a look at the rendered result next to a sibling task's.
- Values live in `desktop/renderer/tokens.css` only (colours, radii `--r-*`, type scale `--fs-*`, fonts, spacing `--sp-*`, shadows).
  `desktop/test/design.test.js` fails on a raw value anywhere else. New colour or size: add a token and say why.
- Building blocks from `components.js` + `components.css`: `pill(text, tone)`, `tag()`, `tile()`, `moreButton(items)`, button classes (`primary`,
  `secondary`, `ghost`, `link`, `danger`, `with-icon`). Something new goes there (modifiers `is-…`, tones `tone-…`) and into `gallery.js`.
  `npm run gallery` shows every token and component. The website (private repo `jobadabra-web`) has its own styles.
- **UI from an owner mockup:** confirm layout + behaviour in one message before code. A card has many states; a mockup shows one: keep every state.

## Pop-ups (toasts): no button; the click is the one thing (owner, 27 Oct 2026) [approved]
- "On clicking on any notification, it should forward/redirect us and highlight a specific section/screen/card" and "The toast notifications shouldn't really have a button, but just clicking them, should produce an action".
- `toastMessage` (`renderer/pages/startup.js`) takes `target` (a job's row, a session's card, `{card: '<id>'}`, a page, Recent activity: `renderer/targets.js`) or `action` (`{label, run}`: the click runs it; the label shows as a small "<label> ›" line). Neither: `NO_PLACE.<reason>`.
- No button inside a pop-up; the one exception is the "Why dismiss?" chips (`dismiss-reason.js`), the answers it asks for. Look: `--toast-bg` / `--toast-line` (dark lifted above the cards, 1 px edge).
- Guards: `desktop/test/toast-targets.test.js` (every call names a target, an action or a reason; no button in a pop-up). macOS notifications carry the same target (`lib/app-notify.js`).

## Every new screen and action goes in the ⌘K palette
`paletteCommands()` in `desktop/renderer/pages/nav.js`. A new page is a `.nav` button (listed automatically). A new Actions card needs
`data-command` or `data-palette` on its Run button (`test/palette-covers-actions.test.js`). Any other new top-level button is added with
`button(view, id, keywords)`. A long or paid action opens its card and focuses its input instead of running. Settings needs nothing (listed from
the page; checked by the settings suite's ⌘K step). A new long task on this Mac is a tracked task (`pipeline.work` / `pipeline.task`).
- **❓ is data, never shown** (owner, 16 Oct 2026): a value starting with ❓ means not set; screens say "Not set" and use the words after it as the hint (`renderer/answers-model.js` valueOf / shown). The Profile tabs' render test fails on a ❓ or a textarea on screen (`desktop/test/profile-tabs-render.test.js`).

## AI costs: shown to nobody for now (owner, 25 Oct 2026) [approved]
- No dollar amount for AI is drawn on any engine ("I don't foresee much users using the API Key"; the figure is tokens × our price table, not a bill). To bring it back for API-key users only: set `SHOWN` in `renderer/ai-cost.js` and `COSTS_SHOWN` in `lib/ai/names.js`; Free AI and plans never see one.
- A new cost display goes through that helper (`costText`/`costVisible`); `desktop/test/ai-cost.test.js` fails on a file that draws `$` + `toFixed` without it.
