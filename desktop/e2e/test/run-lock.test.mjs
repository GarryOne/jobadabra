// The e2e helper that waits for the engine's run lock (lib/run-lock.mjs), and the hung-AI step's use of it (#1662).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {lockHolder, waitForRunLock, waitedForLock} from '../lib/run-lock.mjs';

const folder = note => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runlock-')); if (note !== undefined) fs.writeFileSync(path.join(dir, 'run.lock'), note); return dir; };

test('no lock file, an empty one, or a dead holder: nobody holds it', () => {
  assert.equal(lockHolder(folder()), null);
  assert.equal(lockHolder(folder('')), null);
  assert.equal(lockHolder(folder(JSON.stringify({pid: 4242, label: 'scout'})), () => false), null);
});

test('a live holder is returned', () => {
  assert.equal(lockHolder(folder(JSON.stringify({pid: 4242, label: 'scout'})), () => true).label, 'scout');
});

test('waits until the holder is gone, and fails naming it when it never goes', async () => {
  const dir = folder(JSON.stringify({pid: 4242, label: 'scout'}));
  let polls = 0;
  await waitForRunLock(dir, {isAlive: () => ++polls < 3, sleep: async () => {}});
  assert.equal(polls, 3);
  await assert.rejects(waitForRunLock(dir, {maxMs: 0, isAlive: () => true, sleep: async () => {}}), /scout run \(pid 4242\) still holds the run lock/);
});

test('a log that waited for another run is caught', () => {
  assert.equal(waitedForLock(['Another Jobadabra search is running (app or terminal): waiting for a scout run; waited 0 min so far…']), true);
  assert.equal(waitedForLock(['Stopped by Jobadabra: no output for 10 s']), false);
});

test('the hung-AI step waits for the lock before it starts and checks the log after (the class: every step that shortens the silence limit)', () => {
  const dir = path.join(import.meta.dirname, '../suites');
  for (const file of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    if (!src.includes('JOB_PILOTTO_E2E_IDLE_MS')) continue;
    assert.match(src, /waitForRunLock\(/, `${file} shortens the silence limit but does not wait for the run lock first`);
    assert.match(src, /waitedForLock\(/, `${file} does not check that the stopped run never waited for the lock`);
  }
});
