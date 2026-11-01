// Layer 2 helper: a real SQLite store in a temp profile, seeded and read through the engine's own commands, no Notion, no AI, no browser.
// The same environment the app gives the engine (e2e/lib/store-call.mjs storeEnv) and the same first-run config (lib/pipeline-env.js ensureConfig), so a screen test
// shows what the engine hands the window for these records. Never anyone's data: the profile is a fresh temp folder, HOME is that folder, no app is followed.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensureConfig} from '../../lib/pipeline-env.js';
import {storeEnv} from '../../e2e/lib/store-call.mjs';
import {python} from '../../e2e/lib/python.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const SHELL = ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'SYSTEMROOT'];

/** A fresh temp profile on the SQLite store with the app's first-run config. -> {profile, call, engine, remove}. */
export function newStore() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-screen-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({store: 'sqlite'}));
  fs.mkdirSync(path.join(profile, 'data'), {recursive: true});
  ensureConfig({path: name => path.join(profile, name), readText: name => fs.readFileSync(path.join(profile, name), 'utf8'), writeText: (name, text) => fs.writeFileSync(path.join(profile, name), text)});
  const env = () => ({...Object.fromEntries(SHELL.filter(name => process.env[name]).map(name => [name, process.env[name]])), PYTHONUTF8: '1', ...storeEnv({profile})});
  const run = args => execFileSync(python(), args, {cwd: REPO, env: env(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000});
  return {
    profile,
    /** One store method (`python -m src.stores call`) -> its result; throws with the engine's error. */
    call(entity, method, kwargs = {}) {
      const answer = JSON.parse(run(['-m', 'src.stores', 'call', entity, method, JSON.stringify(kwargs)]).trim().split('\n').pop());
      if (answer.error) throw new Error(`${entity}.${method}: ${answer.error}`);
      return answer.result;
    },
    /** An engine module as the app runs it (`python -m <module> <args>`) -> its last stdout line, parsed when JSON. */
    engine(...args) {
      const last = run(['-m', ...args]).trim().split('\n').pop();
      try { return JSON.parse(last); } catch { return last; }
    },
    remove: () => fs.rmSync(profile, {recursive: true, force: true}),
  };
}

/** Writes a scenario ({rows: [{key, fields}], events: [{rowKey, kind, at, ...}]}, e2e/lib/focus-data.mjs) into the store -> {rowKey: the store's record}. */
export function seed(store, data) {
  const made = {};
  for (const {key, fields: {stage, sections = {}, ...job}} of data.rows) {
    made[key] = store.call('applications', 'create', {job, stage});
    if (!made[key]?.id) throw new Error(`the store did not create ${job.url}`);
    for (const [name, markdown] of Object.entries(sections)) store.call('applications', 'set_section', {app_id: made[key].id, name, markdown});
  }
  for (const {rowKey, kind, at, ...fields} of data.events) store.call('events', 'add', {app_id: made[rowKey].id, kind, at, ...fields});
  return made;
}
