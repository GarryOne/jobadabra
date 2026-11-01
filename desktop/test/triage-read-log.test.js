// The Jobs page's form read over IPC (lib/apply-handlers.js triageReadOrNull): a failed read answers null and logs its cause with the job (#2650).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {triageReadOrNull} from '../lib/apply-handlers.js';

test('a read that fails answers null and logs why, with the job (#2650)', async () => {
  const lines = [];
  const answer = await triageReadOrNull(async () => { throw new Error('the hidden browser did not start'); }, 'https://jobs.example/1', line => lines.push(line));
  assert.equal(answer, null);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /jobs\.example\/1.*the hidden browser did not start/);
});

test('a read that throws before its promise is still caught; a read that answers is passed through unlogged', async () => {
  const lines = [];
  assert.equal(await triageReadOrNull(() => { throw new Error('bad url'); }, 'x', line => lines.push(line)), null);
  assert.deepEqual(await triageReadOrNull(async ({url}) => ({url, auto: true}), 'https://jobs.example/2', line => lines.push(line)), {url: 'https://jobs.example/2', auto: true});
  assert.equal(lines.length, 1);
});
