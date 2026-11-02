// The judges' sketch (extension/account-fill.js accountSketch, run from its own source as ladder-capture.mjs does) reads a picklist's choice the way the panel
// does (extension/review.js comboFilled, __jobadabraChosen): a react-select chip, a labelled hidden input holding the value, never typed search text alone.
// Every picklist shape in one loop, and the form audit (page/browser-form-fastpath.js) must agree on each. Headless Chromium; skipped without Chromium.
// 11 Oct 2026: a chosen Country (+41) read "empty", so the form-ready judge said "needs Country*" on a filled form.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {functionSource, loadReader} from '../../ladder-capture.mjs';

const root = path.resolve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..', '..', '..');
let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!fs.existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }

// react-select as a hosted board draws it: the chip (or a placeholder) beside a search input whose own value stays empty.
const reactSelect = (id, inner, typed = '') => `<div class="select__container"><label for="${id}">${id}*</label><div class="select-shell"><div class="select__control"><div class="select__value-container">${inner}
  <div class="select__input-container"><input class="select__input" id="${id}" role="combobox" aria-required="true" type="text" value="${typed}"></div></div></div></div></div>`;
// A type-to-search picklist that keeps its choice in a hidden input its label points to (app-core/test/panel-widgets.test.js PICKLIST).
const picklist = (id, code, typed) => `<div class="row"><label for="${id}__h">${id} *</label><div class="field"><div><span><div class="fd-input-group--control">
  <input type="text" role="combobox" aria-required="true" aria-label="${id}" value="${typed}"></div></span></div><input type="hidden" id="${id}__h" value="${code}"></div></div>`;
const menu = (id, options) => `<div class="row"><label for="${id}">${id}</label><select id="${id}" required>${options}</select></div>`;

const SHAPES = [
  ['react-select single chip', reactSelect('country', '<div class="select__single-value"><span>+41</span></div>'), 'filled'],
  ['react-select multi chips', reactSelect('languages', '<div class="select__multi-value"><div class="select__multi-value__label">English</div></div>'), 'filled'],
  ['react-select placeholder', reactSelect('gender', '<div class="select__placeholder">Select...</div>'), 'empty'],
  ['react-select typed, nothing chosen', reactSelect('city', '<div class="select__placeholder">Select...</div>', 'Zur'), 'empty'],
  ['picklist with its hidden value', picklist('salutation', '688', 'Monsieur'), 'filled'],
  ['picklist typed, no value', picklist('title', '', 'Mons'), 'empty'],
  ['menu with a choice', menu('canton', '<option value="">Choose</option><option value="zh" selected>Zurich</option>'), 'filled'],
  ['menu on its placeholder sentinel', menu('region', '<option value="0" selected>Please choose</option><option value="1">North</option>'), 'empty'],
  ['menu with no choice', menu('team', '<option value="" selected>Choose</option><option value="a">A</option>'), 'empty'],
];

test('every picklist shape reads chosen or not in the judges\' sketch, and the form audit agrees', {skip: !chromium && 'no Chromium installed'}, async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body><form>${SHAPES.map(([, html]) => html).join('\n')}</form></body></html>`);
    await loadReader(page);   // the one control reader, as the extension loads it before the sketch (judge-sketch.js)
    const sketch = await page.evaluate(functionSource('account-fill.js', 'export function accountSketch'));
    assert.equal(sketch.controls.length, SHAPES.length, 'one control per shape');
    await page.addScriptTag({content: fs.readFileSync(path.join(root, 'extension/page/browser-form-fastpath.js'), 'utf8')});
    const audit = await page.evaluate('window.__jobPilottoAuditVisibleFields()');
    SHAPES.forEach(([name, , want], index) => {
      assert.equal(sketch.controls[index].state, want, `judges' sketch: ${name}`);
      assert.equal(audit[index].filled, want === 'filled', `form audit: ${name}`);
    });
  } finally { await browser.close(); }
});
