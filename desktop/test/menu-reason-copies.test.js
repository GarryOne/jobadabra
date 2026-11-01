// The app's copies of the menu reasons (lib/reports.js MECHANICAL, lib/question-labels.js leftReason) and the worker's (app-core/src/report.js)
// match extension/menu-reason.js, the one the fill writes: a reason added there and not here fails this test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {MENU_REASONS, OLD_MENU_REASON} from '../../extension/menu-reason.js';
import {MECHANICAL} from '../lib/reports.js';
import {LEFT_REASONS, leftReason} from '../lib/question-labels.js';

test('every menu reason the fill writes is a failure the app reports and a reason word it counts', () => {
  const worker = fs.readFileSync(new URL('../../app-core/src/report.js', import.meta.url), 'utf8');
  for (const {text, cause} of [...MENU_REASONS, {text: OLD_MENU_REASON, cause: 'real_click'}]) {
    assert.ok(MECHANICAL.includes(text), `reports.js: ${text}`);
    assert.ok(worker.includes(`'${text}'`), `worker report.js: ${text}`);
    assert.equal(leftReason(`${text} (1.0 s)`), cause, text);
    assert.ok(LEFT_REASONS.includes(cause), cause);
  }
  assert.equal(leftReason('dropdown not clicked: the click failed'), 'menu_not_clicked');
});
