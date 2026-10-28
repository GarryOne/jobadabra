// The Jobs bar painted from the kept state survives a render before Focus is read (owner, 28 Oct 2026: "I clicked on it. It vanished"): renderer/suggestions.js barState.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {barState} from '../renderer/suggestions.js';

test('before Focus is read, a render leaves the kept bar alone (null), never hides it', () => {
  assert.equal(barState(false, []), null, 'the click or the questions count arriving first');
  assert.equal(barState(false, [{kind: 'insight'}]), null);
});

test('once Focus is read, the bar shows with its entries and hides at zero', () => {
  assert.deepEqual(barState(true, [{kind: 'insight'}]), {shown: true, entries: [{kind: 'insight'}]});
  assert.deepEqual(barState(true, []), {shown: false, entries: []});
});

test('renderJobsSuggestions asks barState before it touches the bar', () => {
  const page = fs.readFileSync(new URL('../renderer/pages/focus-suggestions.js', import.meta.url), 'utf8');
  const body = page.slice(page.indexOf('export function renderJobsSuggestions'));
  assert.ok(body.indexOf('barState(') > 0 && body.indexOf('barState(') < body.indexOf('show(bar'), 'barState first, then show');
  assert.match(body.slice(0, body.indexOf('show(bar')), /if \(!state\) \{ loadFocus\(\); return; \}/, 'an unknown Focus is read by the bar itself, not waited for (it is read only when its view opens)');
});
