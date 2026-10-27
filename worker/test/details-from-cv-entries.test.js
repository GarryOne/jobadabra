// A detail the person left empty that the CV states comes to the page in contact._fromCv (desktop/lib/server-contact.js withCvFallback; owner, 27 Oct 2026): the page
// places it like any saved detail and marks its entry fromCv, so the fields line says "from your CV: check it" (page/fill.js). The _fromCv list itself is never typed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom is not installed here (run npm install in worker/)';
const FORM = `<form><label for="first_name">First Name</label><input id="first_name"><label for="last_name">Last Name</label><input id="last_name">
  <label for="email">Email</label><input id="email" type="email"></form>`;

const entriesOf = (profile) => {
  const window = openPage(JSDOM, FORM);
  const rows = [...window.document.querySelectorAll('input')].map((el) => ({ field: el.id, label: window.__jobPilottoFillKit.labelOf(el), type: el.type || 'text' }));
  return JSON.parse(JSON.stringify(window.__jobPilottoProfileEntries(rows, profile)));   // jsdom objects come from another realm
};

test('the CV\'s names go in, marked fromCv; a saved detail is not marked', { skip }, () => {
  const entries = entriesOf({ first_name: 'Ana', last_name: 'Lupu', email: 'me@x.y', _fromCv: ['first_name', 'last_name'] });
  assert.deepEqual(entries, [{ field: 'first_name', value: 'Ana', fromCv: true }, { field: 'last_name', value: 'Lupu', fromCv: true }, { field: 'email', value: 'me@x.y' }]);
});

test('control: with no _fromCv every entry is a saved detail, as before', { skip }, () => {
  assert.deepEqual(entriesOf({ first_name: 'Ana', email: 'me@x.y' }), [{ field: 'first_name', value: 'Ana' }, { field: 'email', value: 'me@x.y' }]);
});
