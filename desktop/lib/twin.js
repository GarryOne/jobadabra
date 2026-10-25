// Twin mode (JOB_PILOTTO_TWIN=1): a second copy of the app for live tests on the owner's real state (owner, 8 Oct 2026), started by
// desktop/e2e/twin.mjs on a clone of the app's folder whose Notion is the one-way "Job Pilotto – Live Test" mirror. It may read real websites
// and fill real forms (never Submit), but nothing it does reaches the owner's own app, Chrome windows, Telegram, schedules or real Notion:
// - its folder must not be the real one (JOB_PILOTTO_USER_DATA, checked at start: refused otherwise);
// - Notion: the mirror's token from JOB_PILOTTO_TWIN_NOTION_TOKEN, never a token found in the cloned secrets.json;
// - no Telegram polling, no schedules, no telemetry, no AppleScript on Chrome or Terminal (no Apply with Claude); form LEARNING is the one
//   exchange with the site it keeps (lib/telemetry.js learningOff): its fills are real use, and it fills with the shared recipes and meanings;
// - the engine sees no Keychain (src/secret_store.py isolated(): no Telegram bot); it may READ the owner's Google sign-in, never write it (TWIN_MAY_READ, 10 Oct 2026).
// Guarded by desktop/test/twin.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writePrivate} from './private-file.js';
import {realDataFolders} from './app-identity.js';

export const isTwin = (env = process.env) => !!env.JOB_PILOTTO_TWIN;

// The owner's real folder: the one that exists (Jobadabra, or the folder from before the rename on an install not moved yet; lib/app-identity.js), else the new name.
export const realFolder = (home = os.homedir(), platform = process.platform, env = process.env, exists = fs.existsSync) => {
  const folders = realDataFolders(home, platform, env);
  return folders.find(folder => exists(folder)) || folders[0];
};

// Why this twin may not start, or '' when it may: it needs its own folder and the mirror's token.
export function twinRefusal(env = process.env, real = realDataFolders()) {
  if (!isTwin(env)) return '';
  const folder = env.JOB_PILOTTO_USER_DATA ? path.resolve(env.JOB_PILOTTO_USER_DATA) : '';
  if (!folder) return 'no JOB_PILOTTO_USER_DATA: a twin never runs on the real folder';
  if ([].concat(real).some(dir => folder === path.resolve(dir))) return 'JOB_PILOTTO_USER_DATA is the real folder';
  if (!env.JOB_PILOTTO_TWIN_NOTION_TOKEN) return 'no JOB_PILOTTO_TWIN_NOTION_TOKEN (the Live Test mirror\'s token)';
  return '';
}

// A secret the twin takes from its environment instead of secrets.json: only the Notion token. null: read it as usual.
export const twinSecret = (name, env = process.env) => (isTwin(env) && name === 'NOTION_TOKEN' ? String(env.JOB_PILOTTO_TWIN_NOTION_TOKEN || '') : null);

// The twin's own browser for its Claude sessions (owner, 8 Oct 2026: test "Take over with Claude" in the twin): twin.mjs passes the twin Chromium's debugging
// address; a session then drives THAT browser through Playwright MCP, never the owner's Chrome (--chrome = the Claude in Chrome extension, which lives in the
// owner's Chrome only). '' when not a twin or no browser is known.
export const twinBrowser = (env = process.env) => (isTwin(env) ? String(env.JOB_PILOTTO_TWIN_BROWSER_CDP || '') : '');
// The browser flags of a Claude session: --chrome for the owner; in a twin only a Playwright MCP on the twin's browser (--strict-mcp-config: no other server
// loads, so the Chrome extension's tools are not even there). dir: where the MCP config is written.
// The session's browser: the person's Chrome (--chrome), or in a twin the twin's own Chromium through a Playwright MCP that
//   - loads tools/browser-submit-guard.js into every page (--init-script), as the agent launchers always did;
//   - masks the job-site passwords in everything the session reads (--secrets: a snapshot shows input values), from a 0600 file in the session's folder.
// secrets: the twin's job-site passwords (lib/keychain.js lets a twin read only those).
const GUARD = fileURLToPath(new URL('../../tools/browser-submit-guard.js', import.meta.url));

export function browserFlags(dir, env = process.env, {secrets = []} = {}) {
  const cdp = twinBrowser(env);
  if (isTwin(env) && !cdp) throw new Error('a live-test twin without its own browser: no Claude session (it would drive your own Chrome)');
  if (!cdp) return ['--chrome'];
  const file = path.join(dir, 'twin-mcp.json');
  const args = ['@playwright/mcp@latest', '--cdp-endpoint', cdp, '--init-script', GUARD];
  const values = [...new Set(secrets.filter(Boolean).map(String))];
  if (values.length) {
    const secretsFile = path.join(dir, 'twin-secrets.env');
    writePrivate(secretsFile, values.map((value, i) => `SITE_PASSWORD_${i + 1}=${JSON.stringify(value)}`).join('\n') + '\n');
    args.push('--secrets', secretsFile);
  }
  writePrivate(file, JSON.stringify({mcpServers: {playwright: {command: 'npx', args}}}));
  // --no-chrome: the person's own "Claude in Chrome by default" setting would otherwise hand this session their real Chrome too.
  return ['--no-chrome', '--mcp-config', file, '--strict-mcp-config'];
}
// Said to the session in a twin, after its usual instructions.
// First in the prompt: it overrides the apply skill's claude-in-chrome steps, which this session does not have.
export const twinNote = (env = process.env) => (twinBrowser(env) ? 'LIVE TEST (a twin of the app). This overrides every claude-in-chrome step of the skill: '
  + 'your browser is the twin\'s own Chromium, reached ONLY through the Playwright MCP tools (mcp__playwright__*). It is a real Chromium with the '
  + 'Job Pilotto extension installed and the person\'s sign-ins; the form tab is already open there (mcp__playwright__browser_tabs to select it). '
  + 'Use browser_navigate / browser_snapshot / browser_click / browser_type / browser_evaluate where the skill says navigate / read_page / '
  + 'computer / form_input / javascript_tool. There is no claude-in-chrome here and that is expected: never stop to ask for it. Never press Submit.\n\n' : '');
