// The crash rule is wired at start: the app's start-up jobs sweep presses the last run's quit cut off, after the data moves settle (the sweep itself: test/background-apply-controller.test.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('start-up hands interrupted presses to the person once the store is settled', () => {
  const source = fs.readFileSync(new URL('../lib/background-handlers.js', import.meta.url), 'utf8');
  assert.match(source, /moves\.catch\(\(\) => \{\}\)\.then\(\(\) => backgroundApplyFor\(storage\)\.sweepInterrupted\(\)\)/, 'the sweep runs after the start-up moves, even when a move failed');
});
