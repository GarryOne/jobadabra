// A suite reads and writes the person's data through the engine's own store command (`python -m src.stores call <entity> <method> '<json>'`, src/stores/__main__.py),
// with the environment the app gives the engine (desktop/lib/pipeline-env.js): the same store the app opens, whichever it is (this Mac's or Notion, the stand-in in a test).
// One seed helper then works on both stores (P7 step 4, spec 2026-10-09-store-adapters.md). The real-Notion helpers in lib/notion.mjs are for notion-real only.
// Guarded by test/store-call.test.mjs.
// Job: run the backbone
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {python} from './python.mjs';
import {logStoreCall} from './run-logs.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const TEXT_FILES = {JOB_PILOTTO_PROFILE_FILE: 'profile.md', JOB_PILOTTO_ANSWERS_FILE: 'answers.md', JOB_PILOTTO_KNOWLEDGE_FILE: 'knowledge.md'};   // desktop/lib/store/text-files.js

// The engine's environment for the app on `profile`: its data and config folders, and its store (settings.json): this Mac's with its text files, or Notion
// with the run's token, the workspace's ids and the Notion the run points at (the stand-in). Never the person's Keychain: a test has none (JOB_PILOTTO_E2E).
// Never anyone's real data: the profile must be a temp folder (the harness's own, lib/app.mjs launch), HOME is that profile and the engine does not follow
// an app set up on this computer (src/paths.py follow_app, which would open the person's own data and Notion ids).
const inTemp = folder => [os.tmpdir(), fs.realpathSync(os.tmpdir())].some(root => path.resolve(folder).startsWith(root));
/** Build the engine environment from a temp profile and supplied token/URL; standIn identifies the in-memory service.
 * Throws for a profile outside temp or an unconnected Notion store; returns only that store's isolated environment. */
export function storeEnv({profile, token = '', notionUrl = '', standIn = false}) {
  if (!inTemp(profile)) throw new Error(`not a temp profile: ${profile}`);
  const settings = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
  const env = {HOME: profile, JOB_PILOTTO_FOLLOW_APP: '0', JOB_PILOTTO_E2E: '1', JOB_PILOTTO_NO_DOTENV: '1', JOB_PILOTTO_CONFIG_DIR: path.join(profile, 'config'), JOB_PILOTTO_DATA_DIR: path.join(profile, 'data')};
  if (settings.store === 'sqlite') {
    env.JOB_PILOTTO_STORE = 'sqlite';
    env.JOB_PILOTTO_DISABLE = 'mail,notion,telegram,google_jobs';   // this Mac's store: no optional service is reached
    for (const [variable, name] of Object.entries(TEXT_FILES)) env[variable] = path.join(profile, name);
    return env;
  }
  if (!token || !settings.notionIds) throw new Error('the store is Notion, and the app is not connected yet (no token or no workspace ids in settings.json)');
  return {...env, JOB_PILOTTO_STORE: 'notion', NOTION_TOKEN: token, ...settings.notionIds, ...(notionUrl ? {JOB_PILOTTO_E2E_NOTION_BASE_URL: notionUrl} : {}),
    ...(standIn ? {JOB_PILOTTO_E2E_NOTION_STANDIN: '1'} : {})};
}

// One store method; -> its JSON answer. A refused or failing call throws with the engine's own error (exit 2 refused, 1 raised).
export function storeCall(ctx, entity, method, kwargs = {}, {profile = ctx.profile} = {}) {
  // Only what Python needs from this shell, then the store's own variables: no token or key from the shell ever reaches the command.
  const shell = Object.fromEntries(['PATH', 'TMPDIR', 'LANG', 'SYSTEMROOT', 'TEMP', 'TMP'].filter(name => process.env[name]).map(name => [name, process.env[name]]));
  const notionUrl = ctx.appEnv?.JOB_PILOTTO_E2E_NOTION_BASE_URL || '';
  // The engine's Notion requests go to the profile's notion-requests.log, beside the app's (kept with the artifacts, lib/run-logs.mjs).
  const env = {...shell, PYTHONUTF8: '1', ...storeEnv({profile, token: ctx.store === 'sqlite' ? '' : ctx.token, notionUrl, standIn: ctx.store === 'standin'}), JOB_PILOTTO_NOTION_LOG: path.join(profile, 'logs', 'notion-requests.log')};
  fs.mkdirSync(path.join(profile, 'logs'), {recursive: true});
  const said = (ok, error) => logStoreCall(profile, {entity, method, store: ctx.store, notionUrl, ok, error});
  return new Promise((resolve, reject) => {
    execFile(python(), ['-m', 'src.stores', 'call', entity, method, JSON.stringify(kwargs)], {cwd: REPO, env, maxBuffer: 64 * 1024 * 1024, timeout: 120000}, (error, stdout, stderr) => {
      let answer;
      try { answer = stdout.trim() ? JSON.parse(stdout) : null; } catch { answer = undefined; }
      if (error) { const message = `store ${entity}.${method}: ${answer?.error || stderr.trim().split('\n').pop() || error.message}`; said(false, message); return reject(new Error(message)); }
      if (answer === undefined) { said(false, 'not JSON'); return reject(new Error(`store ${entity}.${method}: not JSON: ${stdout.slice(0, 200)}`)); }
      said(true);
      resolve(answer && typeof answer === 'object' && 'result' in answer ? answer.result : answer);   // the command answers {result}
    });
  });
}
