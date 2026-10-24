// The window says "Notion" only while Notion holds the data (renderer/store-words.js; window-free modules: renderer/store-name.js). Target
// reached 9 Oct 2026: no hard-coded Notion sentence left. A new one goes through storeName()/byStore() (where()/byWhere() without the
// window), or, when it is about Notion itself (connecting it, a Notion page link, Always on, a Notion error), is marked: `// about Notion`
// at the end of its JS line, `data-about-notion` on its element in index.html (`data-notion-only` when it shows only with Notion).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {counts} from './store-words-count.js';

const desktop = path.join(import.meta.dirname, '..');
// Files with Notion sentences left (9 Oct 2026), at their count: lower it when you convert one, never raise it
// (regenerate: node --input-type=module -e "import {counts} from './test/store-words-count.js'; …").
const ALLOWED = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'store-words-allowed.json'), 'utf8'));

test('no file says "Notion" in more sentences than it did (use storeName()/byStore() from renderer/store-words.js)', () => {
  const over = Object.entries(counts(desktop)).filter(([file, n]) => n > (ALLOWED[file] || 0)).map(([file, n]) => `${file}: ${n} (allowed ${ALLOWED[file] || 0})`);
  assert.deepEqual(over, []);
});

test('index.html counts too: visible words and titles, not what the page already handles by store', async () => {
  const {countHtml} = await import('./store-words-count.js');
  assert.equal(countHtml('<p title="Saved to Notion">Hi</p>'), 1, 'a title is read');
  assert.equal(countHtml('<p class="muted">Saved to Notion 🎤 Interviews</p>'), 1, 'visible text');
  assert.equal(countHtml('<button data-notion-only>Edit in your Notion</button>\n<b data-store-saved>Saved in Notion</b>'), 0, 'handled by the page');
  assert.equal(countHtml('<button id="notion-go" data-x="notion">Connect with Notion</button>\n<!-- Notion here -->'), 0, 'about Notion itself, ids, comments');
});

test('store-name.js follows the store for the window-free modules', async () => {
  const {byWhere, setWhere, where} = await import('../renderer/store-name.js');
  assert.equal(where(), 'Notion', 'before the state is read');
  setWhere('Jobadabra');
  assert.equal(byWhere('in Notion', 'here'), 'here');
  setWhere('Notion');
  assert.equal(byWhere('in Notion', 'here'), 'in Notion');
});

// desktop/lib counts too (9 Oct 2026: its errors and dialogs said "Notion could not be updated" on this Mac's store); its helper follows the settings.
test('desktop/lib is counted, and its byStore follows the store in the settings', async () => {
  const {count, DIRS} = await import('./store-words-count.js');
  assert.ok(DIRS.includes('lib') && DIRS.includes('lib/store'));
  assert.equal(count("return {ok: false, error: 'Notion could not be updated. Try again.'};"), 1, 'a message the window shows');
  assert.equal(count("import * as notion from './notion.js';   // Notion-only: a goal's own row"), 0, 'a trailing comment is no sentence');
  const {byStore} = await import('../lib/store/words.js');
  const on = store => ({settings: () => (store ? {store} : {})});
  assert.deepEqual([byStore(on(''), 'in Notion', 'here'), byStore(on('notion'), 'in Notion', 'here'), byStore(on('sqlite'), 'in Notion', 'here')],
    ['in Notion', 'in Notion', 'here']);
});
