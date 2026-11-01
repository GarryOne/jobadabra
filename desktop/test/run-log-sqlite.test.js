// A run the engine logs on this Mac's store (src/run_log.py) is the one Recent activity lists: the engine writes it into a
// temporary data/tracker.sqlite and the desktop's sqlite store (lib/store/sqlite.js) reads it back through the engine
// (`python -m src.stores call`), as the app does. Isolated: a temp data folder, the sqlite store, no Notion token, the app's
// own folder not followed (JOBADABRA_FOLLOW_APP=0), so nothing reaches the owner's data or Notion.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as engine from '../lib/store/engine.js';
import * as sqliteStore from '../lib/store/sqlite.js';
import {recordLink} from '../lib/run-rows.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const python = process.env.JOBADABRA_CHECK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-runlog-'));
const env = {...process.env, JOBADABRA_STORE: 'sqlite', JOBADABRA_DATA_DIR: data, JOBADABRA_FOLLOW_APP: '0',
  JOBADABRA_TRIGGER: 'Mac (you)', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'};
for (const name of ['NOTION_TOKEN', 'GITHUB_RUN_ID', 'GITHUB_EVENT_NAME', 'ANTHROPIC_API_KEY']) delete env[name];

// The engine's side: a Gmail check that sent its message, logged by run_log.
const LOGGED = `
from src import run_log, telegram
from src.stores import open_stores
stores = open_stores()
run = run_log.new_run('mail')
run.update(mail={'model': 'claude-haiku-5-5', 'pending': 3, 'done': 3, 'usd': 0.012, 'tokens_in': 900, 'tokens_out': 120},
           updates=['Acme: Stage → Rejected'], telegram='sent 1 message(s)', seconds=42)
run_log.begin(stores, run)
telegram.MESSAGES.append('<b>1 application update</b>\\nAcme: rejected')
print('LOGGED ' + run_log.log_run(stores, run))
`;

const runEngine = async (storage, args) => {
  const done = spawnSync(python, ['-m', ...args], {cwd: root, env, encoding: 'utf8'});
  return {code: done.status, stdout: done.stdout};
};

test('a run the engine logs on SQLite is listed by Recent activity with its numbers and message', async () => {
  const logged = spawnSync(python, ['-c', LOGGED], {cwd: root, env, encoding: 'utf8'});
  assert.equal(logged.status, 0, logged.stderr);
  const ref = /LOGGED (\S+)/.exec(logged.stdout)?.[1];
  assert.match(ref || '', /^store:cron_runs\/[0-9a-f]{32}$/, logged.stdout);
  assert.match(logged.stdout, new RegExp(`Cronjob run logged: ${ref}`));   // the line the app links its activity row by
  assert.ok(fs.existsSync(path.join(data, 'tracker.sqlite')), 'the run is in the temp store, not elsewhere');

  const store = sqliteStore.open({}, {call: (storage, entity, method, kwargs) => engine.call(storage, entity, method, kwargs, {run: runEngine})});
  const rows = await store.runs.list();
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.notionUrl, recordLink(ref.split('/')[1]));
  assert.deepEqual([row.mode, row.ok, row.startedBy, row.where, row.telegram], ['mail', true, 'Mac (you)', 'mac', true]);
  assert.ok(Math.abs(row.usd - 0.012) < 1e-9, String(row.usd));
  assert.ok(row.endedAt, 'a finished run has its end');
  const detail = await store.runs.detail(row.notionUrl);
  assert.equal(detail.message, '1 application update\nAcme: rejected');
  assert.ok(detail.report.some(line => /Gmail check/.test(line)), JSON.stringify(detail.report));
});

test.after(() => fs.rmSync(data, {recursive: true, force: true}));
