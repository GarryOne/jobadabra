// A store call's arguments and answer are the person's data: a real `python -m src.stores call` (memory store, no token, not following the
// app's folder) must leave them out of engine.log, app.log and the run-end tail that technical reports read; app.log gets one [store] line.
// Guards desktop/lib/store/engine.js and pipeline-run.js (logArgs, privateOutput).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as engineLog from '../lib/engine-log.js';
import {logTo} from '../lib/log.js';
import * as pipelineRun from '../lib/pipeline-run.js';
import * as engine from '../lib/store/engine.js';
import {logText} from './log-text.mjs';

test('a store call\'s arguments and answer never reach engine.log, app.log or a report', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-store-private-'));
  const storage = {settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts)};
  logTo(dir);
  engineLog.setFile(path.join(dir, 'engine.log'));
  const ended = [];
  pipelineRun.onRunEnd(run => ended.push(run));
  // Isolated: the memory store (nothing persists), no Notion token, no .env, never the Desktop App's folder.
  const isolated = {JOBADABRA_STORE: 'memory', JOBADABRA_FOLLOW_APP: '0', JOBADABRA_NO_DOTENV: '1', NOTION_TOKEN: ''};
  const run = (s, args, onLine, extra, options) => pipelineRun.run(s, args, onLine, {...extra, ...isolated}, options);
  const marker = `private-${process.pid}-${Date.now()}`;
  const answer = await engine.call(storage, 'applications', 'set_stage', {job: {url: `https://x.example/${marker}`, title: marker}, stage: 'Saved'}, {run});
  assert.ok(JSON.stringify(answer).includes(marker), 'the caller still gets the answer (proves the marker was in stdout)');
  const engineText = logText(path.join(dir, 'engine.log')), appText = logText(path.join(dir, 'app.log'));
  assert.ok(!engineText.includes(marker), 'engine.log has no argument or answer');
  assert.ok(!appText.includes(marker), 'app.log has no argument or answer');
  const mine = ended.find(r => r.args.join(' ') === 'src.stores call applications set_stage');
  assert.ok(mine, 'the run-end listeners see the call by its identity');
  assert.ok(!JSON.stringify(mine).includes(marker), 'the run-end tail (technical reports) has no argument or answer');
  assert.match(engineText, /---- python -m src\.stores call applications set_stage run_id=/);
  assert.match(appText, /\[store\] applications\.set_stage \{"exit":0,"bytes":\d+,"ms":\d+\}/);
  logTo(null);
  engineLog.setFile(null);
});
