// The fill ladder's value class (extension/page/value-class.js; spec docs/superpowers/specs/2026-10-12-fill-ladder.md, amendment 3; the owner's case c, "+41" pushed into a Country
// dropdown): the kind of the fill's own answer from a fixed list, by shape and the dial-code table named by the browser (never a word list), marked on each answered control so the
// judges' sketch can say "answer dial_code" without the value.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadJsdom, openPage} from './helpers/page.js';

const JSDOM = await loadJsdom();

test('each answer\'s kind: a calling code, a country name in English or the page\'s language, an e-mail, a phone, a date, a number, an address, free text', {skip: !JSDOM}, () => {
  const window = openPage(JSDOM, '<form></form>');
  window.document.documentElement.lang = 'de-CH';
  const of = window.__jobPilottoValueClass.of;
  const cases = [['+41', 'dial_code'], ['0041', 'dial_code'], ['+1', 'dial_code'], ['+41 79 555 01 23', 'phone'], ['0795550123', 'phone'], ['+41795550123', 'phone'],
    ['Switzerland', 'country_name'], ['Schweiz', 'country_name'], ['  united kingdom ', 'country_name'], ['ada@example.com', 'email_shaped'],
    ['2026-11-02', 'date'], ['02.11.2026', 'date'], ['11/02/2026', 'date'], ['42', 'number'], ['3.5', 'number'], ['120000', 'number'],
    ['https://example.com/ada', 'url'], ['www.example.ch', 'url'], ['linkedin.com/in/ada', 'url'], ['German', 'free_text'], ['Yes', 'free_text'], ['', 'none'], [null, 'none']];
  assert.deepEqual(cases.map(([value]) => of(value)), cases.map(([, want]) => want));
  window.close();
});

test('the fill\'s answers mark each answered control with its kind; a choice group, a checkbox, a file or a password is not marked', {skip: !JSDOM}, () => {
  const window = openPage(JSDOM, `<form><select id="country"><option>Select</option><option>Switzerland (+41)</option></select><input name="mail"><input id="pw" type="password">
    <input id="ok" type="checkbox"><input type="radio" name="g" value="a"></form>`);
  window.__jobPilottoValueClass.mark([{field: 'country', value: '+41'}, {field: 'mail', value: 'ada@example.com'}, {field: 'pw', value: 'x'}, {field: 'ok', value: 'Yes'}, {field: 'radio:g', value: 'a'}, {field: 'nope', value: '1'}]);
  const cls = selector => window.document.querySelector(selector).getAttribute('data-jobpilotto-class');
  assert.deepEqual(['#country', '[name=mail]', '#pw', '#ok', '[name=g]'].map(cls), ['dial_code', 'email_shaped', null, null, null]);
  window.close();
});

test('the judges\' sketch carries the kind and the legal mark, never the value', {skip: !JSDOM}, async () => {
  const {accountSketch} = await import('../../extension/account-fill.js');
  const window = openPage(JSDOM, `<form><label for="country">Country</label><select id="country"><option>Select</option><option>Switzerland (+41)</option></select>
    <label for="terms">I accept the terms</label><input id="terms" type="checkbox"></form>`);
  window.__jobPilottoValueClass.mark([{field: 'country', value: '+41'}]);
  window.document.getElementById('terms').dataset.jobpilottoCategory = 'legal';   // the AI's reading (page/categories.js)
  const sketch = JSON.parse(JSON.stringify(window.eval(`(${accountSketch})()`)));
  assert.deepEqual(sketch.controls.map(item => [item.label, item.answer || '', !!item.legal]), [['Country', 'dial_code', false], ['I accept the terms', '', true]]);
  assert.ok(!/"\+41"/.test(JSON.stringify(sketch)) && sketch.controls.every(item => !('value' in item)), 'the answer itself never leaves the page (an option\'s text may: the page\'s own wording)');
  window.close();
});

test('the sketch names each control\'s field box by its fingerprint: the same widget on two sites is the same, never its text or id', {skip: !JSDOM}, async () => {
  const {accountSketch} = await import('../../extension/account-fill.js');
  const fpOf = html => { const window = openPage(JSDOM, html); const sketch = JSON.parse(JSON.stringify(window.eval(`(${accountSketch})()`))); window.close(); return sketch.controls.map(item => item.fp || ''); };
  const one = fpOf('<form><div class="field"><label for="a">Country</label><select id="a"><option>Pick</option><option>Switzerland</option></select></div><div class="field"><label for="b">City</label><input id="b"></div></form>');
  const two = fpOf('<form><div class="field"><label for="x">Land</label><select id="x"><option>Wählen</option><option>Schweiz</option></select></div><div class="field"><label for="y">Ort</label><input id="y"></div></form>');
  assert.ok(one.every(fp => /^[a-z0-9]{6,16}$/.test(fp)), JSON.stringify(one));
  assert.deepEqual(two, one, 'other words and ids, the same widgets: the same fingerprints');
  assert.notEqual(one[0], one[1], 'a menu and a box are different widgets');
});
