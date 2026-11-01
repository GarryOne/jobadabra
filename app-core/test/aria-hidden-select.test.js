// A native select a menu library hides with aria-hidden (Select2 keeps the real select 1px big, aria-hidden, beside its own box) is still the field that holds the answer; an aria-hidden
// helper input (react-select's "required" input) is not a field (extension/page/read-back.js hiddenAway; the panel, the fill's reader and the audit all ask it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadJsdom, openPage} from './helpers/page.js';

const JSDOM = await loadJsdom();
const FORM = `<form><label for="country">Country</label>
  <select id="country" aria-hidden="true" tabindex="-1"><option value=""></option><option value="ch">Switzerland</option></select>
  <select id="stub" aria-hidden="true"></select>
  <select id="plain"><option>a</option><option>b</option></select>
  <input id="helper" aria-hidden="true" tabindex="-1" required>
  <input id="visible"></form>`;

test('an aria-hidden select with choices is a field; an aria-hidden helper input or a select with no choices is not', {skip: !JSDOM}, () => {
  const window = openPage(JSDOM, FORM);
  const away = id => window.__jobPilottoReadBack.hiddenAway(window.document.getElementById(id));
  assert.deepEqual(['country', 'stub', 'plain', 'helper', 'visible'].map(away), [false, true, false, true, false]);
});

test('the panel, the fill reader and both copies of the audit ask the one rule (never their own aria-hidden test)', () => {
  const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  for (const file of ['extension/panel-form.js', 'extension/page/fill-read.js', 'extension/page/browser-form-fastpath.js', 'tools/browser-form-fastpath.js']) {
    assert.match(read(file), /__jobPilottoReadBack\.hiddenAway/, file);
    assert.doesNotMatch(read(file), /\bel\.getAttribute\('aria-hidden'\) [!=]== 'true'/, `${file} keeps its own test`);
  }
});
