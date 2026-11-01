// A radio question's options are one answer, not one control each: the judges' sketch (extension/account-fill.js accountSketch) never calls the option the fill did not pick
// a miss while a sibling of its group holds the choice. 15 Oct 2026, bake-off form 13 (Breezy yes/no radios): the fill marked every option "filled", the unchosen one read match "no",
// the repair rung (test runs) toggled it and turned three right answers (Yes, Yes, No) into three wrong ones (No, No, Yes). Headless Chromium; skipped without Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {functionSource, loadReader} from '../../ladder-capture.mjs';

let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!fs.existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }

// Options with no value attribute, as an Angular list draws them: the words are all that tell Yes from No. [name, picked option index or -1 for none]
const GROUPS = [['q_picked_first', 0], ['q_picked_second', 1], ['q_none_picked', -1]];
const group = ([name, picked]) => `<li><h3>${name} question?*</h3><ul>${['Yes', 'No'].map((word, index) =>
  `<li><label><input type="radio" name="${name}" required data-jobadabra-filled ${index === picked ? 'checked' : ''}><span>${word}</span></label></li>`).join('')}</ul></li>`;

test('a radio option the fill did not pick is not a miss while its group holds a choice', {skip: !chromium && 'no Chromium installed'}, async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body><form><ul>${GROUPS.map(group).join('')}</ul></form></body></html>`);
    await loadReader(page);
    const sketch = await page.evaluate(functionSource('account-fill.js', 'export function accountSketch'));
    const matches = sketch.controls.map(control => control.match);
    assert.deepEqual(matches.slice(0, 4), ['yes', '', '', 'yes'], 'a group with a choice: the chosen option yes, its sibling not a miss');
    assert.deepEqual(matches.slice(4), ['no', 'no'], 'a group with no choice after the fill answered it is still a miss');
  } finally { await browser.close(); }
});
