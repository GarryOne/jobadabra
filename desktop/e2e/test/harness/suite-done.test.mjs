// The "a suite that left no done marker did not pass" guard (lib/suite-done.mjs): a lock that returned 0 early must not turn a CI step green.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {clearDone, markDone, verdict} from '../../lib/suite-done.mjs';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-suite-done-'));

test('an exit 0 with no marker is a failure, with a marker it stays 0, and a failing status is kept', () => {
  const env = {E2E_ARTIFACTS: folder()}, lines = [];
  assert.equal(verdict(0, env, line => lines.push(line)), 1);
  assert.match(lines.join(), /left no done\.txt/);
  markDone(0, env);
  assert.equal(verdict(0, env, () => {}), 0);
  assert.equal(verdict(3, {E2E_ARTIFACTS: folder()}, () => {}), 3);
});

test('an old marker does not vouch for a new run, and no artifacts folder means no check', () => {
  const env = {E2E_ARTIFACTS: folder()};
  markDone(0, env);
  clearDone(env);
  assert.equal(verdict(0, env, () => {}), 1);
  assert.equal(verdict(0, {}, () => {}), 0);
});
