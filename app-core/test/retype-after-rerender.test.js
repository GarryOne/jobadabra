// A box the fill typed that a toolkit re-created with a NEW generated id and no name is typed again where it now stands, found by its question (extension/page/browser-form-fastpath.js
// byLabel). 15 Oct 2026, the owner's real SuccessFactors fill (SAP UI5 gives every re-created control a new auto id): Address, Postal Code and City were typed, Country was picked, the section
// was drawn again empty with new ids, and the retype that followed a box by its old id or name never found them. Never two boxes with one question: then it is not told apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadJsdom, openPage} from './helpers/page.js';

const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom is not installed here (run npm install in worker/)';
const SECTION = ids => ids.map((id, i) => `<p><label for="${id}">${['Team name', 'Project code'][i]}</label><input id="${id}" type="text"></p>`).join('');
const PAGE = `<form><div id="sec">${SECTION(['__input1-inner', '__input2-inner'])}</div></form>`;

function typed() {
  const window = openPage(JSDOM, PAGE);
  window.__jobPilottoNoGuard = true;
  window.__jobPilottoFillKnownFields([{field: '__input1-inner', value: 'Platform'}, {field: '__input2-inner', value: 'P4711'}]);
  return window;
}

test('boxes re-created with new ids are typed again by their question', {skip}, () => {
  const window = typed();
  window.document.getElementById('sec').innerHTML = SECTION(['__input11-inner', '__input12-inner']);   // drawn again: new ids, empty
  assert.equal(window.__jobPilottoRetypeWiped(0), 2);
  assert.deepEqual(['__input11-inner', '__input12-inner'].map((id) => window.document.getElementById(id).value), ['Platform', 'P4711']);
  window.close();
});

test('two re-created boxes with the same question are not told apart: neither is typed', {skip}, () => {
  const window = typed();
  window.document.getElementById('sec').innerHTML = SECTION(['__input21-inner', '__input22-inner']) + `<p><label for="dup">Team name</label><input id="dup" type="text"></p>`;
  window.__jobPilottoRetypeWiped(0);
  assert.equal(window.document.getElementById('__input21-inner').value, '', 'one question, two boxes');
  assert.equal(window.document.getElementById('dup').value, '');
  assert.equal(window.document.getElementById('__input22-inner').value, 'P4711', 'the other question is still found');
  window.close();
});
