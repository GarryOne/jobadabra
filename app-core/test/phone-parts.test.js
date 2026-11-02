// A phone split into boxes, told apart by STRUCTURE (no label words): the box inside a picker (its own wrapper holds a listbox) takes the calling code, the first plain box after it the
// national number, a further one nothing (16 Oct 2026, a Workday "My Information" step that got the whole "+41795550123" in all three). Two shapes: the capture's own markup and a
// variant in other languages with another widget; and the controls that must NOT split: a phone with no picker keeps the whole number in each of its boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom is not installed here (run npm install in app-core/)';
const PROFILE = { phone: '+41 79 555 01 23', first_name: 'Test' };

const entriesOf = (html, profile = PROFILE) => {
  const window = openPage(JSDOM, html);
  const rows = [...window.document.querySelectorAll('input')].map((el) => ({ field: el.id, label: window.__jobadabraFillKit.labelOf(el), type: el.type || 'text' }));
  return Object.fromEntries(window.__jobadabraProfileEntries(rows, profile).map((entry) => [entry.field, entry.value]));
};

test('picker, number and extension boxes each take their own part', { skip }, () => {
  const entries = entriesOf(`<form><label for="c">Country Phone Code</label><div class="w"><div class="m"><input id="c" placeholder="Search"><ul role="listbox"></ul></div></div>
    <label for="n">Phone Number</label><div><input id="n"></div><label for="x">Phone Extension</label><div><input id="x"></div></form>`);
  assert.deepEqual(entries, { c: '+41', n: '795550123' });
});

test('variant: other words, a popup-button picker, a trunk zero', { skip }, () => {
  assert.deepEqual(entriesOf(`<form><label for="n">Telefonnummer</label><input id="n" type="tel"><label for="x">Telefon intern</label><input id="x">
    <label for="c">Telefon Vorwahl</label><span><input id="c" aria-haspopup="listbox"></span></form>`), { n: '795550123', c: '+41' });
  assert.deepEqual(entriesOf(`<form><label for="c">Phone</label><span><input id="c" role="presentation" aria-haspopup="true"></span><label for="n">Phone</label><input id="n"></form>`, { phone: '+41 079 555 01 23' }),
    { c: '+41', n: '795550123' });
});

test('control: a phone with no picker keeps the whole number in each box it had', { skip }, () => {
  assert.deepEqual(entriesOf(`<form><label for="n">Phone</label><input id="n" type="tel"></form>`), { n: '+41 79 555 01 23' });
  assert.deepEqual(entriesOf(`<form><label for="a">Home phone</label><input id="a"><label for="b">Mobile phone</label><input id="b"></form>`), { a: '+41 79 555 01 23', b: '+41 79 555 01 23' });
});

test('control: one box with its country list in its own wrapper (a flag dropdown) is the whole phone', { skip }, () => {
  assert.deepEqual(entriesOf(`<form><label for="n">Phone</label><div class="iti"><div class="iti__flag-container"><ul role="listbox"></ul></div><input id="n" type="tel"></div></form>`), { n: '+41 79 555 01 23' });
});
