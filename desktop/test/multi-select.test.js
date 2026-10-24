// The multi-value control (renderer/multi-select.js): its rows, and the roles and keys a screen reader and the keyboard rely on.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {multiRows} from '../renderer/multi-rows.js';

const GROUPS = [{name: 'A', options: [{id: 'a', label: 'One', title: 'first'}, {id: 'b', label: 'Two'}]}, {name: 'B', options: [{id: 'c', label: 'Three'}]}];

test('rows: a heading per group, each option with its tick and count', () => {
  assert.deepEqual(multiRows(GROUPS, ['b'], {a: 3, b: 0}), [
    {heading: 'A'},
    {id: 'a', label: 'One', title: 'first', checked: false, count: 3},
    {id: 'b', label: 'Two', title: '', checked: true, count: 0},
    {heading: 'B'},
    {id: 'c', label: 'Three', title: '', checked: false, count: null},
  ]);
});

test('the control is a menu of checkboxes that stays open, closes on Esc and moves with the arrow keys', () => {
  const source = fs.readFileSync(new URL('../renderer/multi-select.js', import.meta.url), 'utf8');
  assert.match(source, /'menuitemcheckbox'/);
  assert.match(source, /'aria-checked'/);
  assert.match(source, /aria-haspopup/);
  assert.match(source, /event\.key === 'Escape'[\s\S]*close\(true\)/, 'Esc closes and returns focus to the button');
  assert.match(source, /menuStep\(/, '↑ ↓ Home End');
  assert.doesNotMatch(source, /list\.hidden = true;\s*\n\s*onToggle/, 'a tick does not close the list');
});

// A tick redraws the list: the clicked row is detached by the time the document's click handler runs, so "outside" must come from the event's path.
test('an outside click is read from the event path, not from the clicked row (a tick redraws it)', () => {
  const source = fs.readFileSync(new URL('../renderer/multi-select.js', import.meta.url), 'utf8');
  assert.match(source, /event\.composedPath\(\)/);
  assert.doesNotMatch(source, /!list\.contains\(event\.target\)/);
});
