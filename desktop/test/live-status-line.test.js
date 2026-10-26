// A task that goes quiet (an AI call, a wait for the run lock) shows one live "still here" line, not silence and not a wall of lines.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {HEARTBEAT_MS, STATUS_LINE} from '../lib/pipeline.js';

test('the lock wait and the heartbeat are status lines; ordinary progress is not', () => {
  assert.ok(STATUS_LINE.test('Another Jobadabra search is running (app or terminal): waiting for a daily scheduled run started 20:42 (pid 40107); waited 2 min so far…'));
  assert.ok(STATUS_LINE.test('⏳ Still running · no new output for 45 s'));
  assert.ok(!STATUS_LINE.test('Checking employer career pages…'));
  assert.ok(HEARTBEAT_MS.quiet >= HEARTBEAT_MS.every);
});

test('the window and the app both keep only the newest of a row of status lines, and a heartbeat is never the step', () => {
  const pipeline = fs.readFileSync(new URL('../lib/pipeline-queue.js', import.meta.url), 'utf8');
  assert.equal((pipeline.match(/keepRunLine\(log, line\)/g) || []).length, 2, 'both ways a line reaches the run log keep it the one way (renderer/run-lines.js)');
  assert.match(pipeline, /!line\.startsWith\('⏳ Still running'\) && isProgressStep\(line\)/);
  const window = fs.readFileSync(new URL('../renderer/pages/jobs.js', import.meta.url), 'utf8');
  assert.match(window, /keepRunLine\(shared\.logLines, line\)/);
});
