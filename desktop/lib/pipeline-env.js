// Owns: where the engine lives (REPO, python()), the model names (MODELS), the first-run config copy, and the environment a pipeline
// process gets (pipelineEnv, a whitelist), plus readable() (Telegram HTML -> text) and the demo-mode switch.
// Guarded by: test/pipeline-run.test.js, test/model-override.test.js, test/e2e-isolation.test.js, test/demo.test.js, test/pool-share.test.js.
// Split out of pipeline.js (a pure move); pipeline.js re-exports everything.
import * as claudeCode from './claude-code.js';
import * as poolShare from './pool-share.js';
import * as aiFree from './ai-free.js';
import * as notionGate from './notion-gate.js';
import {TEXT_FILES} from './store/text-files.js';
import * as requestLog from './request-log.js';
import * as pageRender from './page-render.js';
import fs from 'node:fs';
import path from 'node:path';

// The engine's variable for each text kept on this Mac (src/stores sqlite adapter).
const LOCAL_TEXTS = {JOB_PILOTTO_PROFILE_FILE: TEXT_FILES.profile, JOB_PILOTTO_ANSWERS_FILE: TEXT_FILES.answers, JOB_PILOTTO_KNOWLEDGE_FILE: TEXT_FILES.knowledge};

import {ROOT} from './root.js';
import {isolatedFile} from './keychain.js';
import {notifyEnv} from './notify-channel.js';
import {CONFIG_FILES, cleanConfigFiles, copyWithoutNotes} from './config-text.js';

export const REPO = ROOT;
const OVERRIDE = process.env.JOB_PILOTTO_MODEL_OVERRIDE;   // set only by the end-to-end journey (desktop/e2e): every step on one cheap model
// small: the engine's small AI steps (src/ai/models.py), sent as data so a newer model needs no engine release.
export const MODELS = OVERRIDE ? {enrich: OVERRIDE, score: OVERRIDE, kit: OVERRIDE, insight: OVERRIDE, small: OVERRIDE}
  : {enrich: 'claude-haiku-5-5', score: 'claude-sonnet-5-5', kit: 'claude-sonnet-5-5', insight: 'claude-sonnet-5-5', small: 'claude-haiku-5-5'};

// The packaged app's own Python (with the anthropic package), else the repo's virtualenv, else python3.
// Windows keeps them elsewhere: python\python.exe (python-build-standalone) and .venv\Scripts\python.exe.
export function python(platform = process.platform, exists = fs.existsSync) {
  const candidates = platform === 'win32'
    ? [path.join(REPO, 'python', 'python.exe'), path.join(REPO, '.venv', 'Scripts', 'python.exe')]
    : [path.join(REPO, 'python', 'bin', 'python3'), path.join(REPO, '.venv', 'bin', 'python')];
  return candidates.find(candidate => exists(candidate)) || (platform === 'win32' ? 'python' : 'python3');
}

// First run: the user's config starts as the repo defaults (the wizard then rewrites search/preferences), without the defaults' notes ("_comment":
// "Example search settings ..."): a note is never a setting, and one reached the fill prompt (lib/config-text.js). Every start (main.js) also cleans a copy
// made before, so an existing user's files are repaired by the app itself.
export function ensureConfig(storage) {
  for (const name of CONFIG_FILES) {
    const target = storage.path(path.join('config', name));
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), {recursive: true});
      copyWithoutNotes(path.join(REPO, 'config', name), target);
    }
  }
  return cleanConfigFiles(storage);
}

// Only what a program needs to run, from the parent environment: never the developer's tokens or
// Jobadabra settings exported in the shell the app was started from.
// On Windows, Python can't open a socket without SystemRoot, and finds the user's folders through the rest.
const SYSTEM = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SSL_CERT_FILE',
  'SystemRoot', 'SYSTEMROOT', 'windir', 'USERPROFILE', 'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT',
  'JOB_PILOTTO_FIXTURE_DIR', 'JOB_PILOTTO_LOCATIONS_FILE',   // these two: the end-to-end journey's fixture feeds and fictional candidate (desktop/e2e), never set for a user
  'JOB_PILOTTO_SEARCH_TAPE', 'JOB_PILOTTO_SEARCH_TAPE_MODE', 'JOB_PILOTTO_TAPE_WAIT_SCALE', 'JOB_PILOTTO_TAPE_LIVE',   // the persona search check's tape (src/search_tape.py, tools/persona-search), never set for a user
  // Claude Code's own headless sign-in (`claude setup-token`): where there is no Keychain sign-in (Linux, a CI runner) it is the only way
  // the user's Claude Code answers. It goes to the engine only to reach the user's own `claude -p` (27 Oct 2026: on a runner every AI step
  // of a search failed as "signed out" because this was left out).
  'CLAUDE_CODE_OAUTH_TOKEN'];

// Crash reports from the engine: the app sets this (main.js) only for an installed build with Technical reports on; the engine reports
// unhandled errors to it (src/crash_reporting.py). The install id and version ride along as tags.
let crashReports = null;
export const setCrashReports = value => { crashReports = value; };
export function pipelineEnv(storage, parent = process.env) {
  const settings = storage.settings();
  const env = {
    ...Object.fromEntries(SYSTEM.filter(name => parent[name]).map(name => [name, parent[name]])),
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',  // files and pipes in UTF-8 on Windows too (its default is the ANSI code page)
    JOB_PILOTTO_NO_DOTENV: '1',
    ...(parent.JOB_PILOTTO_E2E ? {JOB_PILOTTO_E2E: '1'} : {}),
    ...(parent.JOB_PILOTTO_TWIN ? {JOB_PILOTTO_TWIN: '1'} : {}),
    ...(isolatedFile(parent) ? {JOB_PILOTTO_ISOLATED_SECRETS: isolatedFile(parent)} : {}),   // their secrets: the run's own file, never the Keychain (lib/keychain.js)  // a live-test twin (lib/twin.js): the engine sees no Keychain either  // the end-to-end journey: the engine ignores this Mac's Keychain (src/secret_store.py)
    ...(/^profile-[0-9a-f]{12}$/.test(settings.profileId || '') ? {JOB_PILOTTO_PROFILE_ID: settings.profileId} : {}),   // the engine names a site's account item after the profile (src/ai/passwords.py)
    JOB_PILOTTO_SOURCE: 'Jobadabra app',  // the Source of Applications rows the app creates
    JOB_PILOTTO_TZ: process.env.JOB_PILOTTO_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,  // the user's own time zone (dates, interview times)
    JOB_PILOTTO_CONFIG_DIR: storage.path('config'),
    JOB_PILOTTO_DATA_DIR: storage.path('data'),
    JOB_PILOTTO_CV_PATH: storage.path('cv.pdf'),
    JOB_PILOTTO_LETTER_STYLE_FILE: storage.path('cover-letter/style.json'),   // the cover letter style (lib/letter-style.js): a kit's letter follows it
    ...(requestLog.logPath() ? {JOB_PILOTTO_NOTION_LOG: requestLog.logPath()} : {}),  // Python's Notion requests: same file
    // Pages that only exist after their scripts run, rendered in the app's own Chromium (lib/page-render.js, src/sources/render.py).
    ...(pageRender.address() ? {JOB_PILOTTO_RENDER_URL: pageRender.address(), JOB_PILOTTO_RENDER_TOKEN: pageRender.TOKEN} : {}),
    ...(crashReports?.enabled() ? {JOB_PILOTTO_SENTRY_DSN: crashReports.dsn, JOB_PILOTTO_APP_VERSION: crashReports.version, JOB_PILOTTO_INSTALL_ID: crashReports.installId} : {}),
  };
  // The Profile and standard answers are read from Notion; before it is connected (Trying) from this Mac's files
  // (src/paths.py local_text). Never set when connected: the local file would win over Notion.
  for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SERPAPI_API_KEY', 'BRAVE_SEARCH_API_KEY', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'JOOBLE_API_KEY']) {
    const value = storage.secret(name);
    if (value) env[name] = value;
  }
  // Demo mode too: its "connected" Notion is fictional, and the Strategy page's goals come from the demo's own profile.md (desktop/demo/).
  if (!notionGate.notionInUse(storage) || demoMode) {
    for (const [variable, name] of [['JOB_PILOTTO_PROFILE_FILE', 'profile.md'], ['JOB_PILOTTO_ANSWERS_FILE', 'answers.md']]) {
      if (fs.existsSync(storage.path(name))) env[variable] = storage.path(name);
    }
  }
  // The store the person chose (lib/store/index.js): the engine opens the same one (src/stores chosen()); unset, it decides as before.
  // On this Mac the texts are the app's own files, read and written by the app and the engine alike (one copy).
  // Notion chosen but not connected: the engine runs as while trying (#410: else the search crashed on "needs NOTION_TOKEN").
  if (settings.store && notionGate.tracking(storage)) env.JOB_PILOTTO_STORE = settings.store;
  if (settings.store === 'sqlite') {
    for (const [variable, name] of Object.entries(LOCAL_TEXTS)) env[variable] = storage.path(name);
  }
  // Free AI (lib/ai-free.js): the Python SDK follows ANTHROPIC_BASE_URL like the app's.
  if (aiFree.isOn(settings)) env.ANTHROPIC_BASE_URL = aiFree.FREE_BASE; else delete env.ANTHROPIC_BASE_URL;
  // The end-to-end journey (desktop/e2e) sends the engine's AI calls through its own slow proxy to reproduce a slow AI; never set for a user.
  if (parent.JOB_PILOTTO_E2E && parent.JOB_PILOTTO_E2E_AI_BASE_URL) env.ANTHROPIC_BASE_URL = parent.JOB_PILOTTO_E2E_AI_BASE_URL;
  if (parent.JOB_PILOTTO_E2E && parent.JOB_PILOTTO_E2E_OPENAI_BASE_URL) env.OPENAI_BASE_URL = parent.JOB_PILOTTO_E2E_OPENAI_BASE_URL;   // the Python OpenAI SDK too
  // The end-to-end journey's stand-ins for Notion, Telegram and Google (desktop/e2e/lib/*-proxy|fake.mjs), and the fake Google sign-in that goes with its fake Gmail.
  // Only in a test run: the engine's env is a whitelist, so without this the engine's own calls went straight to the real services (5 Oct 2026).
  if (parent.JOB_PILOTTO_E2E) {
    for (const name of ['JOB_PILOTTO_E2E_NOTION_BASE_URL', 'JOB_PILOTTO_E2E_TELEGRAM_BASE_URL', 'JOB_PILOTTO_E2E_GOOGLE_BASE_URL']) if (parent[name]) env[name] = parent[name];
    if (parent.JOB_PILOTTO_E2E_GOOGLE_BASE_URL) for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) if (parent[name]) env[name] = parent[name];
    // A fictional candidate's Profile (the quality suite's personas, desktop/e2e/fixtures/golden-*): a file the engine scores against instead of the test page's Profile. Test runs only.
    if (parent.JOB_PILOTTO_E2E_PROFILE_FILE) env.JOB_PILOTTO_PROFILE_FILE = parent.JOB_PILOTTO_E2E_PROFILE_FILE;
    // The e2e Python step map (desktop/e2e/lib/pycov, main's coverage runs): the recorder rides in on PYTHONPATH. A user's own PYTHONPATH never gets through.
    if (parent.E2E_PY_COVERAGE_DIR && parent.PYTHONPATH) Object.assign(env, {E2E_PY_COVERAGE_DIR: parent.E2E_PY_COVERAGE_DIR, PYTHONPATH: parent.PYTHONPATH});
  }
  // The AI engine the user chose (lib/claude-code.js): their own Claude Code or Codex on this Mac, or an API key (Anthropic or OpenAI).
  Object.assign(env, claudeCode.pipelineVariables(settings, !!env.ANTHROPIC_API_KEY, !!env.OPENAI_API_KEY));
  if (claudeCode.aiReady(settings, !!env.ANTHROPIC_API_KEY, !!env.OPENAI_API_KEY)) {
    env.JOB_PILOTTO_ENRICH_MODEL = MODELS.enrich;
    env.JOB_PILOTTO_SCORE_MODEL = MODELS.score;
    env.JOB_PILOTTO_KIT_MODEL = MODELS.kit;
    env.JOB_PILOTTO_INSIGHT_MODEL = MODELS.insight;
    env.JOB_PILOTTO_MAIL_MODEL = MODELS.enrich;
    env.JOB_PILOTTO_SMALL_MODEL = MODELS.small;
  }
  // The end-to-end journey: every other AI step the engine has (interview review, prep, rejection review) on the same cheap model, so a step added to
  // the journey later can never quietly run on Opus or Sonnet.
  // The engine's main and big tiers too (src/ai/models.py: the job-boards proposal ran Sonnet under the override, 27 Oct 2026).
  if (OVERRIDE) Object.assign(env, {JOB_PILOTTO_INTERVIEW_MODEL: OVERRIDE, JOB_PILOTTO_PREP_MODEL: OVERRIDE, JOB_PILOTTO_REJECTION_MODEL: OVERRIDE,
    JOB_PILOTTO_MAIN_MODEL: OVERRIDE, JOB_PILOTTO_BIG_MODEL: OVERRIDE});
  Object.assign(env, poolShare.variables(storage) || {});  // "Help the pool grow": only when the user turned it on
  if (settings.telegramChatId) env.TELEGRAM_CHAT_ID = String(settings.telegramChatId);
  Object.assign(env, notifyEnv(storage));   // how the person wants to be told (Settings → Automation → Notifications): src/notify.py
  for (const [key, value] of Object.entries(settings.notionIds || {})) if (value) env[key] = value;
  return env;
}

// Telegram HTML (the pipeline formats its messages for Telegram) as readable text, for every place the app shows
// output: the live and saved logs, Recent activity, the Actions answer. Only Telegram's tags are removed (a log's
// own "<" stays), a link keeps its address ("text (url)"), and entities such as &#x27; become their character.
const TELEGRAM_TAG = /<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|tg-spoiler|span)(?:\s[^>]*)?>/gi;
const NAMED = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
export function readable(text) {
  return String(text ?? '')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, url, label) => (label && label !== url ? `${label} (${url})` : url))
    .replace(TELEGRAM_TAG, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => code[0] === '#'
      ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10))
      : NAMED[code.toLowerCase()] ?? match);
}

// Demo mode (lib/demo.js): only jobs that read the demo folder run; the rest end at once, nothing sent.
let demoMode = false;
export const setDemo = on => { demoMode = !!on; };
export const isDemo = () => demoMode;
