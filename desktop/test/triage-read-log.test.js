// The Jobs page's form read over IPC (lib/apply-handlers.js triageReadOrNull): a failed read answers null and logs its cause with the job in app.log (#2650).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {triageReadOrNull} from '../lib/apply-handlers.js';
import {logTo} from '../lib/log.js';

// Gitar on #2867: the first version was handed the window log, which keeps a line only while a pipeline task runs; the default must be app.log itself.
test('a read that fails answers null and writes why, with the job, to app.log (#2650)', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-log-'));
  logTo(folder);
  const answer = await triageReadOrNull(async () => { throw new Error('the hidden browser did not start'); }, 'https://jobs.example/1');
  assert.equal(answer, null);
  const written = fs.readFileSync(path.join(folder, 'app.log'), 'utf8');
  assert.match(written, /triage: the form read failed/);
  assert.match(written, /jobs\.example\/1/);
  assert.match(written, /the hidden browser did not start/);
});

test('a read that throws before its promise is still caught; a read that answers is passed through unlogged', async () => {
  const lines = [];
  const log = (...args) => lines.push(args);
  assert.equal(await triageReadOrNull(() => { throw new Error('bad url'); }, 'x', log), null);
  assert.deepEqual(await triageReadOrNull(async ({url}) => ({url, auto: true}), 'https://jobs.example/2', log), {url: 'https://jobs.example/2', auto: true});
  assert.deepEqual(lines, [['apply', 'triage: the form read failed', {url: 'x', error: 'bad url'}]]);
});

test('the triageRead IPC hands no logger of its own, so the read logs to app.log', () => {
  const source = fs.readFileSync(new URL('../lib/apply-handlers.js', import.meta.url), 'utf8');
  assert.match(source, /triageReadOrNull\(background\.triageRead, String\(job\?\.url \|\| ''\)\)\)\)/);
});
