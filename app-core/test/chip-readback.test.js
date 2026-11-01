// A picker whose search box is a plain input and whose choice stands beside it as a chip is read by that chip (extension/page/read-back.js chipOf; 16 Oct 2026, Workday "My Information":
// the calling-code picker held "Switzerland (+41)" and the card said "the site did not keep it"). Same class as the owner's open SuccessFactors "shows Switzerland, listed as left".
// Shapes: the capture's own markup, a variant (other tags, aria-selected chip), and the guards: an OPEN menu's options are choices not a value, a plain box beside other fields is
// untouched, and a plain box with nothing chosen stays empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadJsdom, openPage} from './helpers/page.js';

const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom is not installed here (run npm install in worker/)';

const stateOfFirst = (html, id = 'f') => {
  const window = openPage(JSDOM, html);
  for (const el of window.document.querySelectorAll('*')) el.getClientRects = () => [{width: 1, height: 1}];   // jsdom draws nothing: every element counts as shown
  const state = window.__jobadabraReadBack.stateOf(window.document.getElementById(id));
  window.close();
  return state;
};
const WORKDAY = (chip) => `<form><div class="field"><div class="m"><input id="f" placeholder="Search"><ul role="listbox" aria-label="items selected">${chip}</ul></div></div>
  <input id="other"></form>`;

test('the chip of a selected item beside the search box is the picker\'s value', { skip }, () => {
  assert.equal(stateOfFirst(WORKDAY('<li role="presentation"><div role="option" aria-posinset="1"><p>Switzerland (+41)</p></div></li>')), 'committed');
});

test('variant: a selected option (aria-selected=true) in the box\'s own area', { skip }, () => {
  assert.equal(stateOfFirst(`<form><div><input id="f"><div role="listbox"><span role="option" aria-selected="true">Suisse</span></div></div><input id="other"></form>`), 'committed');
});

test('guards: an open menu\'s options are choices, nothing chosen stays empty', { skip }, () => {
  assert.equal(stateOfFirst(`<form><div><input id="f" aria-expanded="true"><ul role="listbox"><li role="option" aria-selected="false">Suisse</li><li role="option" aria-selected="false">France</li></ul></div><input id="other"></form>`), 'empty', 'open menu');
  assert.equal(stateOfFirst(`<form><div><input id="f"><ul role="listbox"><li role="option" aria-selected="false">Suisse</li></ul></div><input id="other"></form>`), 'empty', 'closed list of choices');
  assert.equal(stateOfFirst(WORKDAY('')), 'empty', 'no chip');
  assert.equal(stateOfFirst(`<form><label for="f">City</label><input id="f"><input id="other"></form>`), 'empty', 'a plain box');
});
