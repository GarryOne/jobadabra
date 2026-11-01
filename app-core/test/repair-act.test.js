// The fill ladder's repair, the page's side (extension/page/repair-act.js; spec docs/superpowers/specs/2026-10-12-fill-ladder.md, PR C2): choose_option picks the ONE option that shows the
// fill's own answer in another writing, checked in the page against the answer (the owner's case c, 12 Oct 2026: "+41" pushed into a Country dropdown), never a different answer; retype
// puts the fill's own answer back; the floors refuse a legal question, a password and a button; every repair is a try in the control's attempt log.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadJsdom, openPage} from './helpers/page.js';

const JSDOM = await loadJsdom();
const FORM = `<form>
  <label for="country">Country</label><select id="country"><option value="">Select…</option><option value="DE">Germany</option><option value="CH">Switzerland</option></select>
  <label for="code">Country code</label><select id="code"><option value="">Choose</option><option value="ch1">Switzerland</option><option value="ch2">Switzerland (+41)</option></select>
  <label for="city">City</label><input id="city">
  <label for="pw">Password</label><input id="pw" type="password">
  <label for="terms">I accept the terms</label><input id="terms" type="checkbox">
  <fieldset id="q"><legend>Built backend services?</legend><label><input type="radio" name="b" id="b1"> Yes</label><label><input type="radio" name="b" id="b2"> No</label></fieldset>
  <label for="ko">Based in Texas?</label><input id="ko" data-jobpilotto-category="knockout">
</form>`;

function page() {
  const window = openPage(JSDOM, FORM);
  const doc = window.document;
  [...doc.querySelectorAll('input, select')].forEach((el, index) => el.setAttribute('data-jobpilotto-n', String(index + 1)));   // as the judges' sketch numbers them (extension/account-fill.js)
  window.__jobPilottoValueClass.mark([{field: 'country', value: '+41'}, {field: 'code', value: '+41'}, {field: 'city', value: 'Zurich'}, {field: 'pw', value: 'x'}]);
  return {window, doc, act: window.__jobPilottoRepairAct};
}

test('choose_option: the calling code\'s country is picked by the dial-code table; option 0 finds it, a named option is checked', {skip: !JSDOM}, async () => {
  const {window, doc, act} = page();
  assert.deepEqual(JSON.parse(JSON.stringify(await act.choose_option(1, 0))), {ok: true, why: ''});
  assert.equal(doc.getElementById('country').value, 'CH');
  assert.equal(doc.getElementById('country').getAttribute('data-jobpilotto-picked'), 'switzerland', 'the fill\'s own pick, for the one reader\'s mismatch');
  doc.getElementById('country').value = '';
  assert.equal((await act.choose_option(1, 2)).ok, false, 'option 2 (Germany) does not show the answer: refused, never a different answer');
  assert.equal(doc.getElementById('country').value, '');
  window.close();
});

test('choose_option: two options that both fit is no pick (never guessed)', {skip: !JSDOM}, async () => {
  const {window, doc, act} = page();
  assert.equal((await act.choose_option(2, 0)).why, 'no option shows the answer');
  assert.equal(doc.getElementById('code').value, '');
  assert.equal((await act.choose_option(2, 3)).ok, true, 'the model named the one with the code: checked, it fits');
  assert.equal(doc.getElementById('code').value, 'ch2');
  window.close();
});

test('retype puts the fill\'s own answer back; the floors refuse a password and a legal question', {skip: !JSDOM}, async () => {
  const {window, doc, act} = page();
  assert.equal((await act.retype(3)).ok, true);
  assert.equal(doc.getElementById('city').value, 'Zurich');
  assert.deepEqual(JSON.parse(JSON.stringify(await act.retype(4))), {ok: false, why: 'a password'});
  assert.equal(doc.getElementById('pw').value, '');
  assert.equal((await act.commit(5)).why, 'a legal question');
  assert.equal(act.spot(5), null, 'no real click on a legal question either');
  assert.equal((await act.retype(9)).why, 'no such control');
  window.close();
});

test('every repair is a try in the control\'s attempt log: a few in all, then refused', {skip: !JSDOM}, async () => {
  const {window, doc, act} = page();
  const city = doc.getElementById('city');
  city.addEventListener('blur', () => { city.value = ''; });   // a page that drops the value every time
  const whys = [];
  for (let i = 0; i < 5; i++) whys.push((await act.retype(3)).why);
  assert.equal(whys[0], 'the page did not keep it');
  assert.equal(whys.at(-1), 'its tries are used');
  assert.ok(window.__jobPilottoAttempts.count(city) <= window.__jobPilottoAttempts.CAP);
  window.close();
});

test('floors: a native radio or checkbox and a knockout question are never repaired, in any verb or by a real click (a click there can only flip the answer)', {skip: !JSDOM}, async () => {
  const {window, doc, act} = page();
  const number = id => Number(doc.getElementById(id).getAttribute('data-jobpilotto-n'));
  for (const id of ['b1', 'b2', 'terms', 'ko']) {
    assert.equal(act.refused(number(id)).length > 0, true, `${id} refused`);
    assert.equal(act.spot(number(id)), null, `${id}: no real click`);
    assert.equal((await act.commit(number(id))).ok, false, `${id}: no commit`);
  }
  assert.equal(doc.getElementById('b1').checked || doc.getElementById('b2').checked || doc.getElementById('terms').checked, false);
  window.close();
});
