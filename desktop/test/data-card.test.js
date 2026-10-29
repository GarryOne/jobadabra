// Settings → Move your data: Export options live inside the Export card, the dismissed-jobs checkbox is gone, and every Cancel is a solid secondary button, never bare text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('renderer/index.html');
const pages = fs.readdirSync(path.join(root, 'renderer/pages')).filter(name => name.endsWith('.js')).map(name => `renderer/pages/${name}`);

test('Export options sit inside the Export card and still hold both checkboxes', () => {
  const card = html.slice(html.indexOf('<b>Export</b>'), html.indexOf('<b>Import</b>'));
  for (const id of ['export-data', 'export-keys', 'export-accounts', 'data-progress="export"']) assert.ok(card.includes(id), `${id} is in the Export card`);
  assert.ok(card.includes('Export options'));
  assert.equal(html.split('Export options').length - 1, 1, 'one Export options fold');
});

test('the dismissed-jobs option is gone end to end: dismissed jobs always stay', () => {
  for (const file of ['renderer/index.html', 'renderer/pages/data.js', 'lib/pipeline-commands.js', 'lib/system-handlers.js', '../src/desktop.py', '../src/desktop_tracker.py', '../src/desktop_visits.py']) {
    assert.ok(!/clear-jobs-dismissed|clearDismissed|clear-dismissed|clear_dismissed/.test(read(file)), file);
  }
});

test('every Cancel / Not now button is a solid secondary one, never a ghost (bare text)', () => {
  const found = [];
  const scan = (file, text) => text.split('\n').forEach((line, i) => {
    if (/class="ghost"[^>]*>\s*(Cancel|Not now)\s*</.test(line) || /'ghost'\s*,\s*'(Cancel|Not now)'/.test(line) || (/ghost/.test(line) && /\.textContent = 'Cancel'/.test(line))) found.push(`${file}:${i + 1}`);
  });
  scan('renderer/index.html', html);
  pages.forEach(file => scan(file, read(file)));
  assert.deepEqual(found, [], `use the secondary button class:\n${found.join('\n')}`);
});
