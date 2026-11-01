// The journey may shorten a wait (the history poll, the resume wait); a user never gets the shortened one.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {e2eMs} from '../lib/e2e-timing.js';

test('a wait is shortened only in the journey, only by a number', () => {
  assert.equal(e2eMs('HISTORY_MS', 15000, {}), 15000);
  assert.equal(e2eMs('HISTORY_MS', 15000, {JOBADABRA_E2E_HISTORY_MS: '3000'}), 15000, 'a user never gets it');
  assert.equal(e2eMs('HISTORY_MS', 15000, {JOBADABRA_E2E: '1', JOBADABRA_E2E_HISTORY_MS: '3000'}), 3000);
  assert.equal(e2eMs('HISTORY_MS', 15000, {JOBADABRA_E2E: '1', JOBADABRA_E2E_HISTORY_MS: 'fast'}), 15000);
  assert.equal(e2eMs('HISTORY_MS', 15000, {JOBADABRA_E2E: '1'}), 15000);
});
