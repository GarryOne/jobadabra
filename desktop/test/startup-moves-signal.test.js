// The app tells when its start-up move into the store is over ("startup moves finished"), because that move drops profile.md and answers.md once Notion has them:
// the settings suite's export lost them under it (main, 28 Oct 2026). The suite waits for that line (e2e/lib/wait-on-state.mjs) before it writes its own local copies.
// Behaviour, not source text (Gitar on #2347): the end is reported on success AND on a throw, and the wait helper counts it against the app starts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as startupMove from '../lib/startup-move.js';
import {waitForLogLine} from '../e2e/lib/wait-on-state.mjs';

test('the move reports its end when it succeeds, with how many it moved, before settled() resolves', async () => {
  const seen = [];
  startupMove.track(Promise.resolve(['a', 'b']), outcome => seen.push(outcome));
  await startupMove.settled();
  assert.deepEqual(seen, [{moved: 2}]);
});

test('the move reports its end when it throws, and settled() still resolves', async () => {
  const seen = [];
  startupMove.track(Promise.reject(new Error('settings unreadable')), outcome => seen.push(outcome)).catch(() => {});
  await startupMove.settled();
  assert.deepEqual(seen, [{moved: 0, error: 'settings unreadable'}]);
});

test('waitForLogLine returns once every app start has its finished line, and throws on a hang', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-wait-state-'));
  fs.mkdirSync(path.join(profile, 'logs'));
  const log = path.join(profile, 'logs', 'app.log');
  fs.writeFileSync(log, '[app] start 1\n');
  await assert.rejects(waitForLogLine(profile, /startup moves finished/g, {what: 'the move', capMs: 400}), /the move never finished/);
  fs.appendFileSync(log, '[migrate] startup moves finished {"moved":0,"error":"x"}\n');
  await waitForLogLine(profile, /startup moves finished/g, {capMs: 400});
  fs.rmSync(profile, {recursive: true, force: true});
});
