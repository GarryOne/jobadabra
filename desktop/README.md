# Jobadabra — desktop app (macOS)

The cockpit for Jobadabra: a setup wizard, Find new jobs, **Apply to N jobs**, settings. **Notion is
the user interface** (required): users duplicate the public Jobadabra template, and everything they
view and edit (applications, matches, Profile, insights, interviews) lives there. The app keeps the
engine's working data (crawl history, score cache, CV) in `~/Library/Application Support/Jobadabra`;
keys are encrypted with a key held in your Mac's Keychain (Electron `safeStorage`) and never leave the
Mac except to the service they belong to. No server, no GitHub Actions, no Cloudflare needed.

## Run it (development)

```bash
cd desktop
npm install
npm start
```

It runs the Python pipeline from this repo (`../src`, with `../.venv` when present, else `python3`
with `pip install -r requirements.txt`).

Chrome loads this repo's `extension/` itself; its version stays the base (`"0.9"`, the release build stamps the rest), so after a
`git pull` the extension does not reload itself: press ↻ on Jobadabra in `chrome://extensions`. The app's log says
`extension changed: reload it` when it is due.

## What's in it

| Screen | What it does |
|---|---|
| **Setup wizard** | Anthropic key (checked, then stored encrypted) → **Notion**: duplicate the template, create an integration, paste its secret; the app finds every database and page by title (one copy, never mixed) and checks their columns → CV (PDF) → a short questionnaire → Claude drafts your Profile, standard answers and search settings (about USD 0.05–0.10), you review, and they're written into your Notion Profile pages → optional extras |
| **Jobs** | Every open job, best fit first; **Find new jobs** runs job boards, employer feeds and (with keys) Google Jobs, AI facts and fit scores; Save / Applied / Dismiss per job |
| **Apply to N jobs** | Picks your best open matches (saved first). **In Chrome with the extension**: opens them as tabs; the extension fills each form, you review and submit. **AI agent sessions**: one Claude session per job in Terminal (`tools/apply-batch-claude.sh`), needs Notion |
| **Strategy** | Links to your Profile and standard answers in Notion (edit them there); rebuild them from your CV |
| **Settings** | Keys (Anthropic, Notion, SerpApi), the Chrome extension connection, your data folder |

The Chrome extension connects to the app on this Mac (`http://127.0.0.1:47111` plus a token shown
in Settings) instead of a Cloudflare Worker; it reuses the same endpoint code
(`worker/src/extension.js`) with your local Profile.

## Layout

- `main.js` window, actions and the local extension server; `preload.cjs` the window's only bridge.
- `lib/notion.js` connects the user's copy of the template (`config/notion_template.json`; the template is
  built by `tools/notion_template.py`) and writes pages from Markdown. `lib/storage.js` settings and encrypted secrets; `lib/pipeline.js` runs `src/` with your folder and
  keys; `lib/strategy.js` CV → strategy draft; `lib/apply.js` Apply to N; `lib/server.js` extension
  endpoints on 127.0.0.1.
- `renderer/` the window (plain HTML, CSS and JavaScript).
- Tests: `npm test` (no Electron needed). Windows: CI installs the built .exe and runs `scripts/windows-smoke.mjs` (screenshots kept as the run's `windows-screens-*` artifact). Smoke test: `JOB_PILOTTO_USER_DATA=/tmp/pilot JOB_PILOTTO_SMOKE=/tmp/shot.png npx electron .`
  renders hidden, saves a screenshot and quits.

## Automatic searches and Telegram

- **Every 4 hours while the app is open** (and after the Mac wakes), it runs a search; the Settings
  switch turns this off. "Open Jobadabra when I log in" keeps it running.
- **Telegram** uses the user's own bot (@BotFather → /newbot → paste the token → press Start). The app
  sends the digest after each search and **long-polls** for taps and commands while it runs: no
  webhook, no Cloudflare. The handling is the Worker's own code (`handleUpdate`), with a local
  `dispatch` that runs the same pipeline command the GitHub workflow would (`lib/pipeline.js dailyArgs`).
  A bot that already has a webhook (the cloud setup's bot) can't be used by the app.

## Not yet

Interview recording and transcription in the app, local application kits (today kits live in
Notion), a signed and notarised build.
