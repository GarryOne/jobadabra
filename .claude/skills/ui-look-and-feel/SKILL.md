---
name: ui-look-and-feel
description: How Jobadabra's desktop app looks and feels, with reference screenshots of every screen. Read it before building or changing any page, section, card, list, dialog or loading state in desktop/renderer, and check your result against it (render it in demo mode) before saying it's done.
---

# Jobadabra: look and feel

The owner designs by mockup and judges by screenshot. A screen is done when it looks like the rest of the app
*and* like the mockup, not when the code works. Before you say a UI change is finished, render it (below) and
look at it.

## Before the first render: open every mockup you were given (owner, 24 Oct 2026)
Read each mockup and screenshot your brief lists (the image itself, not its description) before you write the first line of UI, and write down per mockup its
layout parts (hero, card grid, table columns, picker, phone layout). Your render keeps each part, in our logo, tokens and type; a part you drop is named with why.
Why: site audit A (24 Oct 2026) built Platforms and Compare from the brief's words without opening Design 01/02; the owner rejected both ("I'm not satisfied with the proposed UIs").
Then look at the phone render at 1:1, one card at a time (a 2x element shot of the longest-answer card), never only the full-page thumbnail: a wrapped
line moves an icon or label that looked fine scaled down. Why: the owner found Compare's logo centred on a two-line row (24 Oct 2026, "a small bug of positioning").

## First, before writing any UI: the design system (owner, 18 Oct 2026)
`cd desktop && npm run design-system`, find the component for each value you will show, and build only from those (its "Don't / Do" pairs show what the
owner rejected). No new look outside it; a missing part goes into the shared components first. The owner checks the result on the before/after shots.

Before a PR, make ONE side-by-side image: reference (the owner's mockup, or today's screen as before) | your render, demo data, same scale, labelled
(`cd desktop && npm run side-by-side -- <reference.png> <render.png> --out <file.png>`). Light and dark are two images. The file name starts with the session's short name (`npm run side-by-side` adds it: `a2-<name>.png`), so the owner sees whose preview is open. `open` it for the owner and ask
(AskUserQuestion) ship / change what, with your recommendation; ship only after his yes. The PR's before/after stays the record (owner, 18 Oct 2026:
"Every session that works on UI, should open a preview image with side by side").
Run `open` alone and ask only after it returned without error, never in the same batch: on 24 Oct 2026 a hook blocked the command that held `open`, and the owner
answered "Ship it" to a preview that never appeared.

## 0. The design system: pick the control from the value (owner, 17 Oct 2026)
Design system page, built from the repo: `cd desktop && npm run design-system` · living copy `npm run gallery` · rules: `docs/rules/desktop-ui.md` "Design system". Before drawing any value, name its kind and use this row:

| Kind of value | Read view | Edit view |
|---|---|---|
| Short text (name, title, city) | the words | text field sized to the value (≤ 40ch) |
| Long text (motivation) | 3 lines + More | box that grows |
| Yes / No | "Yes" / "No" | two buttons (segmented) |
| One of ≤ 3 short options | `chip()` | segmented |
| One of many (country, age bracket) | the words | a menu (select) |
| Filters: show jobs that are any of several (Saved + Active) | the ticked names on the button ("Saved + 1") | the multi-select (`multi-select.js`): checkbox list, a count each, Clear |
| Several from a list (skills, regions) | `chip()` each | chips with × + "Add, then Enter" |
| Date · Amount · Salary · Duration · Link · Range | formatted ("CHF 140,000 / year, gross", "1 month, ends at month-end") | `answerControl(formatFor({marked: {kind}}))` |
| Per country (right to work) | `chip(country, {detail: 'Allowed · B permit'})`, `tone: 'bad'` for needs visa | Allowed / Needs visa + permit |
| Language + level | `chip('English', {detail: 'C1'})` | level buttons A1…native |
| Note for the AI | muted line with the bot icon, under its value | folded "Note for the AI" |
| Missing | `pill('Not set', 'warn')` + its action | the kind's control, empty |

- **Before drawing a read view, a list, a button row or a choice:** read `docs/rules/desktop-ui.md` "Read views, lists, buttons and choices" (the owner's feedback of 18 Oct 2026: values not notes, lists fold, one-line buttons, one primary, colour for Now vs Proposed, one row per field); the design page's "Don't / Do" pairs show each (the automatic checks are parked, owner 18 Oct 2026).
- Prose that holds several values (a salary per country, "No French or Italian") is split: values into their controls, the rest into a note.
- Many values of one kind (salaries per country) read as a small `.data-table`, not a box each.
- Chips show what a person would write: the screen turns syntax into meaning first ("Tax" in quotes → the group "Whole word only"; "Zurich,Zurich,Switzerland · de" → "Zurich, Switzerland · German").
- After rendering, `npm run shot` prints any saved value cut by its box: fix each one. Look at the result in light and dark (`JOB_PILOTTO_THEME=light npm run shot -- …`, then `=dark`).

### 0b. Cards: read → Edit → editor, one save bar (owner, 18 Oct 2026)
Profile and Strategy cards: a read summary (`readRows`, `chipLine` from `card-shell.js`), a quiet **✎ Edit** at the header's right (`cardEdit`), the editor in place
(`setEditing`, `editRows`: aligned label column, full-width controls, Edit hidden, card kept open, drafts kept; `doneButton` leaves an unchanged editor), and **no Save on a card**: register a source with the page's
`pageSaveBar` (`save-bar.js`: "N unsaved changes in <tabs> · Discard all · Save all changes", tab dots, leave/close guard). Filled orange only for the one current primary
action. Rules and the tests that fail: `docs/rules/desktop-ui.md` "Cards: read → Edit → editor"; living copy `npm run gallery` → "Card shell".

### 0c. Page blocks (owner, 18 Oct 2026)
Before drawing a review list, an empty state, figures with icons, a "From Your details" line, a count shown in two places or a page header: use
`page-parts.js` (`reviewList`, `emptyState`, `summaryTiles`, `referenceRow`), `shared-counts.js` (`defineCount`/`paintCount`) and the `view-head` pattern
(title + lead, sync, ⋯, at most one primary, tabs right under). Rules: `docs/rules/desktop-ui.md` "Page blocks"; living copy `npm run gallery` → "Page blocks".

## 1. Look first
- Reference screenshots of today's screens: `desktop/docs/ui/*.jpg` (fictional demo data). Open the one closest
  to what you build and match it: spacing, density, card style, where actions sit.
- **Check your own change with one screen, not all of them:** `cd desktop && npm run shot -- <page>` (~5 s, demo
  data; prints the picture's path). `--select '#ss-decision'` for one element, `--session Acme --log` for a session
  and its log, `--reload` to test after ⌘R, `--output <file>` to show a recorded terminal output as the log.
  **Prefer reading state to reading pixels:** `--eval "__jp.terminal()" --no-picture` prints JSON (`__jp.shared`,
  `__jp.sessions`, `__jp.openSession`, `__jp.terminal()`: rows, screen, mouse mode, visible lines).
- Refresh the reference images only after big UI changes, about once a day, or when the owner asks:
  `npm run ui-shots` (all, 4 at a time, ~15 s) or `npm run ui-shots -- session jobs` (only those). Commit only the
  images of screens that changed.
- Tokens and components: `desktop/renderer/tokens.css`, `components.js`/`components.css` (`chip()` for values, `pill()` for status, `tag()` for labels; chip styles in `chips.css`), `npm run gallery`.
  Only `var(--…)` values: `desktop/test/design.test.js` fails on a raw colour, radius, font size or font family.

| Screen | File | Shows |
|---|---|---|
| Focus | `focus.jpg` | Up next rows, Insight, funnel; side column (progress, reminders, your focus); sessions dock |
| Focus, loading | `focus-loading.jpg` | Skeleton cards in the page's shape, "Syncing…" by Refresh |
| Jobs | `jobs.jpg` | Stat tiles, toolbar, job rows (fit ring, tags, status pill, main action, ⋯) |
| Session | `session.jpg` | List + detail: job header, "Your next step" card (steps, one primary, state on the right), Before you submit + Form audit cards, folded session log |
| Actions | `actions.jpg` | Running banner, task cards by category with a Run button, Recent runs table |
| Interviews | `interviews.jpg` | Recorder, drafts, saved library table |
| Settings | `settings.jpg` | Setting rows: title, one-line explanation, control |
| Strategy | `strategy.jpg` | Long-form editing |

## 2. Page anatomy
- **Header**: `h1` + one short subtitle (what the page is for, ≤ 10 words). Right side: status text (muted,
  "Updated just now", "Telegram connected" with a dot) and at most one or two buttons (Refresh, a link to settings).
- **A live banner** when something runs for this page (a search, a sync): spinner, bold "X is running", muted
  "Started 19:48 · what it's doing", one secondary button (View activity). Blue-tinted card, full width.
- **Two columns** when the page has a main list plus context: main (`minmax(0, 1fr)`) and a side column (~320 px)
  of small cards (progress, settings, a one-sentence summary). One column below 1180 px.
- **Sections** get an `h2` ("Up next", "Run a task", "Recent runs") with an optional pill count ("3 actions") or
  a link on the right ("View all activity"). No explanatory paragraphs; one muted line at most.

## 3. Cards and rows

- **A run result shows one number: the jobs added to the list** (owner, 24 Oct 2026); no other count, no Details, never scoring words or the scoring queue (docs/rules/desktop-ui.md).
- **Buttons are solid** (owner, 27 Oct 2026): `primary`, `secondary` or `danger-outline`, never a text-only `ghost`/`link` button; a card's buttons share one row. Guard: `desktop/test/solid-buttons.test.js` (docs/rules/desktop-ui.md "Buttons are solid").
- **White card** (`.card`): `--surface`, 1 px `--line` border, `--r-md` radius, soft shadow at most. Cards sit on
  the grey page background with `--sp-4` gaps.
- **Action/item row** (Focus Up next, dock, task cards): round or rounded-square **icon tile** on the left (tinted
  `--surface-2`/`--info-soft`, line icon from `icons.js`), then **headline** (bold, one line, `…` if long) with its
  **badge** beside it (`pill(text, tone, {dot})`), then a **meta line** (muted, small, parts joined with ` · `), then
  **one primary button** on the right, a secondary (Done, Review) if needed, and **⋯** (`moreButton`) for the rest.
- **Tone = meaning**, the same everywhere: `bad` (red) needs you now / failed, `warn` (amber) soon / waiting for
  you, `info` (blue) next step / running, `good` (green) done / completed, `neutral` later / ended. Rows needing
  attention get a 4 px left border in that tone, never a tinted fill of the whole row or card (owner, 27 Oct 2026: "too much yellow"; `test/calm-session.test.js`). A to-do row: the answer in words, same-size buttons, Review in form last, agree in one click, no Remember tick (`test/need-choice.test.js`).
- **Category label** above a card title when cards are grouped: small caps, muted, letter-spaced (DISCOVERY,
  COMMUNICATION, INSIGHTS).
- **Compact by default**: rows ~56–64 px high, padding `--sp-2 --sp-3`, gaps `--sp-2`. The owner asked for
  "more compact" once: don't drift back to airy rows.
- **Tables for history** (Recent runs, libraries): icon tile, bold name, status pill, time, a muted result, `›`.
- **Numbers big, labels small**: progress "0 / 30", funnel counts; a bar under it with the %.
- **Emoji**: fine inside text the owner reads (Telegram style), but UI chrome uses line icons.

- **A detail or report screen is built from the same parts as Focus and Jobs** (owner, 25 Oct 2026, Searches tab: "the most ugly and basic design I ever seen. Make it look cool, modern, with cards, with colors, with widgets"): `summaryTiles` for the figures, a `.card` per topic, `.bar` rows, pills and chips, tone on a row's left edge; never one `.data-table` per topic. Compare with `docs/ui/jobs.jpg` before the preview. Rule: docs/rules/desktop-ui.md.

## 4. States
- **Loading**: skeleton cards in the page's final shape (`.skeleton` bars, shimmer), plus a small spinner and
  "Syncing …" next to Refresh. Never an empty page, and never an empty-state message while data is still loading.
- **Refreshing**: keep what's shown; the status text says "Refreshing…".
- **Empty**: say why and what to do, specific to the filter ("No saved jobs yet. On any job, ⋯ → Save keeps it
  here."), never a generic "No data".
- **Errors**: say what failed and what to do, where the content would be; never a blank page.
- **Background tasks** (search, Gmail, insight…): Recent activity opens and shows the run, then its result under
  its row. Instant look-ups answer on the page. Nothing is shown *behind* an open panel.

## 5. Words
- **Result panels stay basic; details live only in Reports** (owner, 24 Oct 2026: "is all of these information necessary to be displayed? Does he care?"): no API-key setup rows (Adzuna/Jooble, Brave, SerpApi are hidden behind `KEY_SOURCES_OFFERED`, `src/coverage.py` + `desktop/renderer/key-sources.js`), no internal counts (employers checked, ideas left, schedules, who started it, which machine), no scoring words; one number, one message, one action. "Browse sites manually" lists only sites the automatic read stopped at (`visits.left_to_hand`). Guard: `desktop/test/result-panels-basic.test.js`, `tests/test_visits.py`.
- Short and concrete: "Reply to AG Talent recruiter", "Apply to your next role", "Needs your input".
- Buttons are verbs: Run, Respond, Review, Open email, Browse jobs, Done.
- Times: "Today 19:10", "Mon 19:10", "Updated just now"; money "€70k–90k".

## 6. Check before you say it's done
Render the screen with the demo data (fictional, no real profile), then open the image:
```
cd desktop && D=$(mktemp -d) && for f in demo/*; do [ "$(basename $f)" != jobs.json ] && cp "$f" "$D/"; done
JOB_PILOTTO_DEMO=1 JOB_PILOTTO_USER_DATA=$D JOB_PILOTTO_SMOKE=/tmp/shot.png \
  JOB_PILOTTO_SMOKE_JS="document.querySelector('.nav[data-view=actions]').click(); new Promise(r => setTimeout(r, 1000))" \
  ./node_modules/.bin/electron .
```
- Demo data a new screen needs goes in `desktop/demo/` (fictional names), served in `JOB_PILOTTO_DEMO` mode.
- Compare with the mockup side by side: layout, density, what's primary. Fix what differs, then say done.
- Add the screen to `SCREENS` in `desktop/scripts/ui-shots.mjs`, run `npm run ui-shots`, commit the image.

### Rendering with real data, or a screen demo mode can't reach

`npm run shot` copies `desktop/demo/*` (all but `jobs.json`) into a temp user-data folder. To render anything else, do
that yourself, drop a fixture in it, and run Electron directly (note the `env -u`, see `AGENTS.md`):

```sh
D=$(mktemp -d); for f in demo/*; do [ "$(basename "$f")" != jobs.json ] && cp "$f" "$D/"; done
cp /tmp/fixture-runs.json "$D/runs.json"
env -u ELECTRON_RUN_AS_NODE JOB_PILOTTO_DEMO=1 JOB_PILOTTO_USER_DATA="$D" \
  JOB_PILOTTO_SMOKE=/tmp/shot.png ./node_modules/.bin/electron .
```

- **Never put real data in `desktop/demo/`** — it is committed and fictional. Fixtures live in `/tmp`.
- **Real Notion rows without the Notion MCP**: `desktop/lib/run-history.js` `list(storage, {size})` and
  `detail(storage, pageId)` take any storage `{secret: () => token, settings}` — token from
  `security find-generic-password -s job-pilotto.notion.token -w`, settings from
  `~/Library/Application Support/Job Pilotto/settings.json`. **One run of every kind** (the `KIND` map in
  `desktop/renderer/pages/activity.js`) is the fastest way to exercise every detail pane.
- **Prefer state to pixels, but measure the right thing.** `getBoundingClientRect()` reports a box, not content that
  overflows it: compare `scrollWidth` with `clientWidth` to catch a collision (a strip passed such a check while its
  text sat on top of "Manage schedule").
- **The activity panel's geometry**, so a layout change starts from the truth: fixed height, dragged from its top edge
  and kept in `localStorage` (`jobpilotto.activity-height`; min 320 px, max 90vh); `.ap-grid` is `minmax(320px, 38%)`;
  the list and the detail column each scroll; the schedule strip drops its own label under 900 px (container query) so
  the checks stay on one line.

## 7. Code pitfalls seen here
- `let`/`const` used by start-up code (a view opened at launch, the job list) must be declared at the top of
  `app.js`: a later declaration throws "Cannot access before initialization" and blanks the whole window
  (tests in `desktop/test/app.test.js` guard the known ones).
- New grid children of `.app` need their row/column (`grid-column: 2`), or they push the activity bar aside.
- A new IPC call needs the handler in `main.js` *and* the preload entry; a window newer than the running app
  shows "Jobadabra was updated: restart".
