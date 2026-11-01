// Wrong values at a replay's end (lib/wrong-values.mjs): the typed value must be the decided one (layer 1), a contact/home answer must be the applicant's own (layer 2),
// and the gate calls a row worse when the count rises. Headless Chromium for the page part; skipped where playwright has no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {CONTACT} from '../../lib/apply-fixtures.mjs';
import {itemOfReplies, knownFailures, wrongValues} from '../../lib/wrong-values.mjs';
import {fell, judge, summary} from '../../replay-gate.mjs';

let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!fs.existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }

const reply = answers => ({route: '/extension/answer', body: JSON.stringify({answers})});
const fill = (field, value, fact = 'none') => ({field, value, use: 'fill', fact, category: 'normal'});

test('only typed answers (use fill) are decided; a proposal is not', () => {
  const {answers} = itemOfReplies([reply([fill('a', 'x'), {...fill('b', 'y'), use: 'propose'}])]);
  assert.deepEqual(answers.map(one => one.field), ['a']);
});

test('a contact or home answer that is not the applicant\'s own is wrong, in any writing of the right one', () => {
  const wrong = knownFailures([fill('em', 'someone@else.test', 'contact'), fill('ph', '+41795550123', 'contact'), fill('ph2', '+49 170 555 0000', 'contact'), fill('c', 'Israel', 'home_location'),
    fill('c2', 'Zurich, Switzerland', 'home_location'), fill('n', 'Ada Tester', 'contact'), fill('n2', 'Eve Other', 'contact'), fill('e2', CONTACT.email, 'contact'), fill('s', 'yes', 'sponsorship')], CONTACT);
  assert.deepEqual(wrong.map(one => one.field), ['em', 'ph2', 'c', 'n2']);
});

test('a box holding another value than its answer is wrong; an empty one, a picked choice and another page are not', {skip: !chromium && 'no playwright browser'}, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<form><input id="first" value="Ada"><input id="city" value="Geneva"><input id="mail" value=""><select id="country"><option value="">-</option><option>Israel</option><option>Switzerland</option></select></form>');
    await page.selectOption('#country', 'Israel');
    const replies = [reply([fill('first', 'Ada', 'contact'), fill('city', 'Zurich', 'home_location'), fill('mail', CONTACT.email, 'contact'), fill('country', 'Switzerland', 'home_location'), fill('gone', 'x')])];
    const result = await wrongValues(page, replies, CONTACT);
    assert.deepEqual(result.wrong.map(one => `${one.layer}:${one.field}:${one.held}`).sort(), ['typed:city:Geneva', 'typed:country:Israel']);
    assert.equal(result.compared, 3, 'the empty box and the field on another page are not compared');
  } finally { await browser.close(); }
});

test('the gate: a rise of the wrong count is worse; no count in the baseline never counts; every wrong field is listed', () => {
  const form = wrong => ({reached: 'form', filled: 8, left: 4, wrong});
  assert.equal(fell(form(0), form(2)), 'wrong values 2, baseline 0');
  assert.equal(fell(form(2), form(2)), '');
  assert.equal(fell({reached: 'form', filled: 8, left: 4}, form(3)), '');
  const rec = {name: 'a', outcome: form(1), live: {asks: 1}, network: {hit: 1, extra: 0, notRecorded: 0}, wrongValues: [{field: 'country', answer: 'Switzerland', held: 'Israel', layer: 'typed'}]};
  const result = judge([rec], {rows: {a: {same: true, streak: 2, outcome: form(1)}}});
  assert.equal(result.rows.a.verdict, 'same');
  assert.match(summary(result), /Wrong values \(1\)[\s\S]*\| a \| country \| Switzerland \| Israel \| typed \|/);
});

test('no false alarm on the two shapes of 14 Oct 2026: a yes/no choice citing the place, and the place in the form\'s language', () => {
  const fill = (field, value, fact) => ({field, value, fact, use: 'fill'});
  assert.deepEqual(knownFailures([fill('radio:candidate[answers_attributes][1][boolean]', 'No', 'home_location'), fill('input_3621', 'Schweiz', 'home_location'),
    fill('city', 'Zürich', 'home_location')], CONTACT), []);
  assert.equal(knownFailures([fill('country', 'Israel', 'home_location')], CONTACT).length, 1, 'a wrong country is still wrong');
});
