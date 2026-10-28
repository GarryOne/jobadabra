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

test('two views of one text: Structured and Plain text; the plain letter draws no chip, label or control', () => {
  const source = read('pages/portrait.js');
  assert.match(source, /\['structured', 'Structured'\], \['letter', 'Plain text'\]/);
  const letter = source.match(/const letterSheet = [\s\S]*?\n};/)[0];
  assert.doesNotMatch(letter, /tag\(|button|portrait-label|portrait-sources/);
  assert.match(source, /Settings → Connections → AI/);   // a first portrait with no AI says what to do (Gitar on #2334)
  assert.match(source, /if \(!status\.sections\.length\)/);
});

test('What we learned names the portrait in its lead and the link opens that Profile tab (PR B2b note, owner 28 Oct 2026)', () => {
  const html = read('index.html');
  const lead = html.match(/<h3>What we learned about you<\/h3><p class="muted small">([^<]*(?:<button[^>]*>[^<]*<\/button>[^<]*)*)<\/p>/)[1];
  assert.match(lead, /<button type="button" class="link" data-open-profile-tab="portrait">Your portrait<\/button>/);
  assert.ok(html.includes('data-profile-tab="portrait"'), 'the tab the link opens exists');
  assert.match(read('pages/profile.js'), /querySelectorAll\('\[data-open-profile-tab\]'\)[\s\S]*profileTab\(link\.dataset\.openProfileTab\)/);
});
