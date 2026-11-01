// A phone country picker lists "Switzerland +41" and, once picked, shows only a flag and "+41" (the pool's "Country given up after retype" on five Greenhouse rows, 13 Oct 2026: it WAS
// set; the fill compared "+41" with "Switzerland", called it another choice, retyped it and recorded a false left). Every place that compares a shown value with the fill's answer
// agrees: value-class.js fits (the fill's pick record), read-back.js pickedOther (the panel, the audit, the judges' sketch), and flow.js reads the pick's own verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadJsdom, openPage} from './helpers/page.js';

const JSDOM = await loadJsdom();

test('the answer shows in another writing: a country by its bare calling code, a calling code by its country; a different country never', {skip: !JSDOM}, () => {
  const window = openPage(JSDOM, '<form></form>');
  const fits = window.__jobPilottoValueClass.fits;
  assert.equal(fits('Switzerland', '+41'), true, 'the chip shows the code only');
  assert.equal(fits('Switzerland', 'Switzerland +41'), true);
  assert.equal(fits('Switzerland', '+49'), false, 'another country');
  assert.equal(fits('+41', 'Switzerland'), true);
  assert.equal(fits('Germany', '+41'), false);
  window.close();
});

test('a picker that shows the picked option\'s calling code only is that option; another code is another choice', {skip: !JSDOM}, () => {
  const window = openPage(JSDOM, `<div class="select__container"><div class="select__value-container"><div class="select__single-value">+41</div><input id="cc" role="combobox"></div></div>`);
  const input = window.document.getElementById('cc');
  input.setAttribute('data-jobpilotto-picked', 'switzerland41');
  assert.equal(window.__jobPilottoReadBack.stateOf(input), 'committed');
  input.setAttribute('data-jobpilotto-picked', 'germany49');
  assert.equal(window.__jobPilottoReadBack.stateOf(input), 'mismatch', 'the chip shows another country\'s code');
  input.setAttribute('data-jobpilotto-picked', 'switzerland');
  assert.equal(window.__jobPilottoReadBack.stateOf(input), 'mismatch', 'a code that is no part of the picked option is another choice');
  window.close();
});

test('flow.js takes the pick\'s own verdict (same), never its own exact compare of the asked text with the clicked option', () => {
  const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  assert.match(read('extension/flow.js'), /last\.same/);
  assert.match(read('extension/page/fill-menus.js'), /same:/);
});
