// The test-only Full automation switch: on only under JOB_PILOTTO_E2E with its own flag, and never gives a user a Full automation runner.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {e2eFullAutomation} from '../lib/background-apply-controller.js';
import {modeRunner} from '../renderer/apply-settings-model.js';

test('the switch needs both the e2e marker and its own flag', () => {
  assert.equal(e2eFullAutomation({}), false);
  assert.equal(e2eFullAutomation({JOB_PILOTTO_E2E_FULL_AUTOMATION: '1'}), false, 'the flag alone changes nothing');
  assert.equal(e2eFullAutomation({JOB_PILOTTO_E2E: '1'}), false);
  assert.equal(e2eFullAutomation({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_FULL_AUTOMATION: '1'}), true);
});

test('without the pair, Full automation has no runner and no screen can offer it', () => {
  assert.equal(modeRunner('auto'), '');
});
