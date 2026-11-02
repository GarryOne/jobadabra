// The one attempt log per control (extension/page/attempts.js; spec docs/superpowers/specs/2026-10-12-fill-ladder.md, amendment 1; the owner's case: the 6th try in a row on one
// dropdown): a try that failed on a state is not made again, a control gets a few tries in all, and one that used them without holding its answer is given up once.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadJsdom, openPage} from './helpers/page.js';

const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom is not installed here (run npm install in worker/)';
const FORM = '<form><label for="city">City</label><input id="city"><div role="group" id="g"><button type="button" aria-pressed="false">Yes</button></div></form>';

test('a try that failed on this state is not made again; another verb may; a control gets CAP tries in all, then it is given up once', {skip}, () => {
  const window = openPage(JSDOM, FORM), log = window.__jobadabraAttempts, box = window.document.getElementById('city');
  assert.equal(log.CAP, 3);
  assert.equal(log.mayTry(box, 'retype'), true);
  log.note(box, 'retype', log.stateOf(box));   // it stays empty: the try did not work
  assert.equal(log.mayTry(box, 'retype'), false, 'the same try on the same state');
  assert.equal(log.mayTry(box, 'type_real'), true, 'another way may still be tried');
  log.note(box, 'type_real', log.stateOf(box));
  assert.equal(log.mayTry(box, 'pick'), true);
  log.note(box, 'pick', log.stateOf(box));
  assert.equal(log.count(box), 3);
  assert.equal(log.gaveUp(box), 'tries', 'its last allowed try did not work');
  assert.equal(log.mayTry(box, 'anything'), false, 'no fourth try');
  assert.deepEqual(JSON.parse(JSON.stringify(log.drain())), [{field: 'city', kind: 'text', tries: 3}], 'listed once for the worker\'s log');
  assert.deepEqual(log.drain().length, 0);
  window.close();
});

test('a try that worked may be made again on the same state (a page that wipes a box twice), still within the tries in all', {skip}, () => {
  const window = openPage(JSDOM, FORM), log = window.__jobadabraAttempts, box = window.document.getElementById('city');
  for (let wipe = 1; wipe <= 3; wipe++) {
    box.value = '';
    const before = log.stateOf(box);
    assert.equal(log.mayTry(box, 'retype'), true, `wipe ${wipe}`);
    box.value = 'Zurich';
    log.note(box, 'retype', before);
  }
  box.value = '';
  assert.equal(log.mayTry(box, 'retype'), false, 'the fourth wipe is not typed again');
  assert.equal(log.gaveUp(box), 'tries', 'the page keeps wiping it: given up at the cap, so the person is told once');
  window.close();
});

test('a group the one reader cannot read: the operator says whether the press worked; at the cap a group whose last press worked is not given up', {skip}, () => {
  const window = openPage(JSDOM, FORM), log = window.__jobadabraAttempts, group = window.document.getElementById('g');
  log.note(group, 'press', log.stateOf(group), true);
  assert.equal(log.mayTry(group, 'press'), true, 'a press that worked does not block another');
  log.note(group, 'press', log.stateOf(group), false);
  assert.equal(log.mayTry(group, 'press'), false, 'one that failed on this state does');
  log.note(group, 'tap', log.stateOf(group), true);
  assert.equal(log.mayTry(group, 'other'), false, 'its tries are used');
  assert.equal(log.gaveUp(group), '', 'its last press worked: not given up');
  window.close();
});

test('the fastpath types a wiped box again only as its attempt log allows, then lists it as given up', {skip}, () => {
  const window = openPage(JSDOM, FORM), box = window.document.getElementById('city');
  window.__jobPilottoFillKnownFields([{field: 'city', value: 'Zurich'}]);
  let typedAgain = 0;
  for (let wipe = 0; wipe < 6; wipe++) { box.value = ''; typedAgain += window.__jobadabraRetypeWiped(0); }
  assert.equal(typedAgain, 3, 'three times, not the old five');
  box.value = '';
  window.__jobadabraAttempts.note(box, 'retype', window.__jobadabraAttempts.stateOf(box), false);
  assert.deepEqual(JSON.parse(JSON.stringify(window.__jobadabraRetypeGaveUp())).map(item => item.field), ['city']);
  window.close();
});

// cc's review of #507: a menu the page set back to its own default read as answered. The fill marks its pick; another option shown is a mismatch, and a native menu the page
// set back is picked again within its attempt log, then given up.
const MENU = '<form><label for="country">Country</label><select id="country"><option value="">Choose</option><option value="IL">Israel</option><option value="CH">Switzerland</option></select></form>';

test('a menu showing another option than the fill picked reads mismatch; a custom menu\'s chip too', {skip}, () => {
  const window = openPage(JSDOM, MENU + '<div class="select__container"><div class="select__single-value">Israel</div><input id="combo" role="combobox"></div>');
  const RB = window.__jobadabraReadBack, menu = window.document.getElementById('country'), combo = window.document.getElementById('combo');
  window.__jobPilottoFillKnownFields([{field: 'country', value: 'CH'}]);
  assert.equal(RB.stateOf(menu), 'committed');
  menu.value = 'IL';
  assert.equal(RB.stateOf(menu), 'mismatch', 'the page set it to another option');
  combo.setAttribute('data-jobadabra-picked', 'switzerland');
  assert.equal(RB.stateOf(combo), 'mismatch', 'the chip shows another option than the fill picked');
  window.close();
});

test('a native menu the page sets back is picked again, at most CAP times, then given up', {skip}, () => {
  const window = openPage(JSDOM, MENU), menu = window.document.getElementById('country');
  window.__jobPilottoFillKnownFields([{field: 'country', value: 'CH'}]);
  let again = 0;
  for (let round = 0; round < 6; round++) { menu.value = 'IL'; again += window.__jobadabraRetypeWiped(0); }
  assert.equal(again, window.__jobadabraAttempts.CAP, 'picked again within its attempt log');
  assert.equal(window.__jobadabraAttempts.gaveUp(menu), 'tries', 'the page keeps setting it back: left for the person once');
  menu.value = 'IL';
  assert.equal(window.__jobadabraRetypeWiped(0), 0);
  window.close();
});

test('a try that worked tells the run it progressed (value_stayed, relayed by hook.js); a failed one says nothing', {skip}, () => {
  const window = openPage(JSDOM, FORM), log = window.__jobadabraAttempts, box = window.document.getElementById('city');
  const heard = [];
  window.document.addEventListener('jobadabra:progress', event => heard.push(event.detail));
  log.note(box, 'retype', log.stateOf(box), false);
  assert.deepEqual(heard, []);
  log.note(box, 'type_real', log.stateOf(box), true);
  assert.deepEqual(heard, ['value_stayed']);
  window.close();
});
