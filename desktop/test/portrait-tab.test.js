// Your portrait tab (spec criteria 1-3): it is the last Profile tab with its subtitle, nothing on it edits, every statement has a chip, and each chip opens its source tab.
// Fictional status; a minimal DOM.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const renderer = path.join(import.meta.dirname, '../renderer');
const read = file => fs.readFileSync(path.join(renderer, file), 'utf8');

test('Your portrait is the last Profile tab, has its subtitle, and the palette lists tabs by their buttons', () => {
  const html = read('index.html');
  const tabs = [...html.matchAll(/data-profile-tab="(\w+)"/g)].map(m => m[1]);
  assert.equal(tabs.at(-1), 'portrait');
  assert.match(html, /How you come across, written by AI from everything we know\. Updated as we learn\./);
  assert.match(read('pages/nav.js'), /querySelectorAll\('\[data-profile-tab\]'\)\.forEach\(tab => add\('Settings', `Open Profile: /);   // ⌘K entry comes from the tab button
  assert.match(read('pages/profile-save-bar.js'), /portrait: 'Your portrait'/);
});

test('the tab draws no editable control; a chip is a button that opens its statement\'s source', async () => {
  const source = read('pages/portrait.js');
  assert.doesNotMatch(source, /<input|<textarea|contenteditable|'input'|'textarea'|Not true|Edit/);
  const panel = read('index.html').match(/id="setting-portrait"[\s\S]*?<\/div>\s*<\/div>/)[0];
  assert.doesNotMatch(panel, /<input|<textarea|contenteditable|<button/);
  assert.match(source, /tag\(evidence\[id\]\.label, .*onClick: \(\) => open\(evidence\[id\]\.tab\)/);
  assert.match(source, /statement\.evidence\.filter\(id => evidence\[id\]\)/);   // only evidence the stored list knows becomes a chip
});
