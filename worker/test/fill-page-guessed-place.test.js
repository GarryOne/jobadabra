// A box the PAGE filled with its own guess of the person's place is not answered (benchmark form 106, 27 Oct 2026: Workable fills "Address" from the
// visitor's IP, "Des Moines, United States of America"; the contact pass skipped every box holding text, so the saved street never went in, 3 runs of 3).
// A place box holding text the fill never typed takes the saved place when the two disagree, and asks the person to check it; agreeing text is kept;
// a name or e-mail the page holds (a site account's own) is kept; a box the person changed after the fill keeps the person's text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const PROFILE = {first_name: 'Ada', email: 'ada.tester@example.test', street: 'Musterstrasse 12', postal_code: '8001', location: 'Zurich, Switzerland'};
const page = (address, extra = '') => `<form>
  <label for="firstname">First name</label><input id="firstname" name="firstname" required>
  <label for="email">Email</label><input id="email" name="email" type="email" value="${extra}" required>
  <label for="address">Address</label><input id="address" name="address" value="${address}" required>
  <label for="city">City</label><input id="city" name="city" value="Zürich">
</form>`;
const valueOf = (window, id) => window.document.getElementById(id).value;

test('a place the page guessed is replaced by the saved one, and the person is asked to check it', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, page('Des Moines, United States of America'));
  const summary = await window.__jobPilottoExtensionFill([], PROFILE, null, '', false);
  assert.equal(valueOf(window, 'address'), 'Musterstrasse 12');
  assert.ok(summary.todo.some(line => /^Check: Address \(it held the page's own text/.test(line)), summary.todo.join(' | '));
  assert.ok(!JSON.stringify(summary).includes('Des Moines'), 'the page\'s old value never leaves the page');
});

test('a place that agrees with the saved one is kept (another spelling, the city part)', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, page('Musterstrasse 12'));
  const summary = await window.__jobPilottoExtensionFill([], {...PROFILE, location_forms: ['Zürich', 'CH']}, null, '', false);
  assert.equal(valueOf(window, 'address'), 'Musterstrasse 12');
  assert.equal(valueOf(window, 'city'), 'Zürich');
  assert.ok(!summary.todo.some(line => /page's own text/.test(line)), summary.todo.join(' | '));
});

test('an e-mail the page holds (a site account\'s own) is kept', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, page('', 'ada@work.example'));
  await window.__jobPilottoExtensionFill([], PROFILE, null, '', false);
  assert.equal(valueOf(window, 'email'), 'ada@work.example');
  assert.equal(valueOf(window, 'address'), 'Musterstrasse 12');
});

test('a box the person changed after the fill keeps the person\'s text', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, page(''));
  await window.__jobPilottoExtensionFill([], PROFILE, null, '', false);
  const box = window.document.getElementById('address');
  box.value = 'Bahnhofstrasse 5';
  box.removeAttribute('data-jobpilotto-typed');   // what the person's own typing does (browser-form-fastpath.js follow: a trusted input event)
  await window.__jobPilottoExtensionFill([], PROFILE, null, '', false);
  assert.equal(valueOf(window, 'address'), 'Bahnhofstrasse 5');
});
