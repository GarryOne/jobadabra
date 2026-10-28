// The desktop store contract: every adapter gives the same pages (lib/store/index.js). One scenario, run on each adapter: this Mac's
// Markdown files and Notion (through test/fake-notion.js). An adapter is done when it passes. Python's twin: tests/store_contract.py.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as md from '../lib/store/markdown-page.js';
import {parse, render} from '../lib/portrait.js';
import {fakeNotion} from './fake-notion.js';

const plainCrypto = {encrypt: value => value, decrypt: value => value};
function storageWith(settings, secrets = {}) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-store-')), plainCrypto);
  storage.saveSettings(settings);
  for (const [name, value] of Object.entries(secrets)) storage.setSecret(name, value);
  return storage;
}

const ADAPTERS = {
  sqlite: () => ({store: store.openStore(storageWith({store: 'sqlite'}))}),
  notion: () => {
    const page = fakeNotion();
    const storage = storageWith({store: 'notion', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers', NOTION_PORTRAIT_PAGE: 'portrait'}}, {NOTION_TOKEN: 'secret'});
    return {store: store.openStore(storage, {fetcher: page.fetcher})};
  },
};

for (const [name, make] of Object.entries(ADAPTERS)) {
  test(`${name}: a page is read and edited block by block`, async () => {
    const {store: opened} = make();
    assert.equal(opened.name, name);
    const page = opened.page('profile');
    assert.deepEqual(await page.blocks(), []);
    const heading = await page.appendHeading('📇 Contact details');
    await page.insertAfter(heading, ['Email: a@b.c', 'Phone: 1']);
    await page.append(['Notice period: ❓']);
    let blocks = await page.blocks();
    assert.deepEqual(blocks.map(b => [b.type, b.text]), [['heading_2', '📇 Contact details'], ['bulleted_list_item', 'Email: a@b.c'],
      ['bulleted_list_item', 'Phone: 1'], ['bulleted_list_item', 'Notice period: ❓']]);
    await page.setText(blocks[3], 'Notice period: 3 months');
    blocks = await page.blocks();
    await page.remove(blocks.find(b => b.text.startsWith('Phone')));
    assert.deepEqual((await page.blocks()).map(b => b.text), ['📇 Contact details', 'Email: a@b.c', 'Notice period: 3 months']);
    assert.match(await page.text(), /Email: a@b\.c\nNotice period: 3 months/);
    assert.deepEqual((await page.outline()).map(item => item.text), ['📇 Contact details', 'Email: a@b.c', 'Notice period: 3 months']);
  });

  test(`${name}: the derived portrait is one text page that reads back with its evidence`, async () => {
    const {store: opened} = make(), page = opened.page('portrait');
    assert.deepEqual(await page.blocks(), []);
    const written = {sections: [{key: 'short', title: 'In short', statements: [{text: 'You build platforms.', evidence: ['cv', 'learned:0']}]}],
      evidence: new Map([['cv', {label: 'Your CV', tab: 'cv'}], ['learned:0', {label: 'Willing to travel', tab: 'answers'}]])};
    await page.write(render(written, {date: '2026-10-28', hash: 'abc123'}));
    const read = parse(await page.blocks());
    assert.deepEqual([read.date, read.hash], ['2026-10-28', 'abc123']);
    assert.deepEqual(read.sections[0].statements, [{text: 'You build platforms.', evidence: ['cv', 'learned:0']}]);
    assert.deepEqual(read.evidence['learned:0'], {label: 'Willing to travel', tab: 'answers'});
    await page.write(render({...written, sections: []}, {date: '2026-10-29', hash: 'def456'}));   // a rewrite replaces, never appends
    assert.equal(parse(await page.blocks()).sections.length, 0);
  });

  test(`${name}: conditional removal compares the entire current value, not a shared label or substring`, async () => {
    const {store: opened} = make(), page = opened.page('profile');
    await page.append(['Rule: original']);
    const [old] = await page.outline();
    await page.setText(old, 'Rule: original plus a new instruction');
    assert.equal(await page.remove(old, {ifUnchanged: true}), false);
    assert.match(await page.text(), /plus a new instruction/);
    const [current] = await page.outline();
    assert.equal(await page.remove(current, {ifUnchanged: true}), true);
    assert.equal(await page.text(), '');
  });

  test(`${name}: capabilities, never a name, say what the store can do`, () => {
    const {store: opened} = make();
    assert.ok(opened.caps instanceof Set);
    assert.equal(opened.caps.has(store.LINKS), name === 'notion');
    assert.equal(opened.caps.has(store.CLOUD), name === 'notion');
    assert.equal(opened.link('abc') === null, !opened.caps.has(store.LINKS));
  });
}

test('sqlite: tables keep their rows, and a cell edit keeps the others', async () => {
  const opened = store.openStore(storageWith({store: 'sqlite'}));
  const page = opened.page('answers');
  await page.write('## Work\n\n| Question | Answer |\n|---|---|\n| Notice period | ❓ to confirm |\n| Salary | 100k |\n\n- Visa: ❓ (asked by Acme)\n');
  const [heading, table, line] = await page.outline();
  assert.equal(heading.type, 'heading_2');
  assert.equal(table.type, 'table');
  assert.equal(table.header, true);
  assert.deepEqual(table.rows.map(row => row.cells), [['Question', 'Answer'], ['Notice period', '❓ to confirm'], ['Salary', '100k']]);
  assert.equal(line.text, 'Visa: ❓ (asked by Acme)');
  await page.setCell(table.rows[1], 1, '3 months');
  assert.deepEqual((await page.outline())[1].rows[1].cells, ['Notice period', '3 months']);
  assert.match(await page.text(), /Notice period \| 3 months/);
});

test('sqlite: an edit to a line that changed since it was read throws, never touches another line', async () => {
  const text = '- a\n- b\n';
  const [first] = md.blocks(text);
  assert.throws(() => md.setText('- x\n- b\n', first, 'c'), /changed since it was read/);
  assert.equal(md.setText(text, first, 'c'), '- c\n- b\n');
});

test('the store: a chosen store wins; else Notion as before (connected, or trying: asks to connect)', async () => {
  const connected = {notionIds: {NOTION_PROFILE_PAGE_ID: 'p'}};
  assert.equal(store.chosen(storageWith({})), 'notion');
  await assert.rejects(store.openStore(storageWith({})).page('answers').blocks(), /Connect Notion first/);
  assert.equal(store.trying(storageWith({})), true);
  assert.equal(store.chosen(storageWith(connected, {NOTION_TOKEN: 't'})), 'notion');
  assert.equal(store.trying(storageWith(connected, {NOTION_TOKEN: 't'})), false);
  assert.equal(store.chosen(storageWith({...connected, store: 'sqlite'}, {NOTION_TOKEN: 't'})), 'sqlite');
  assert.equal(store.trying(storageWith({store: 'sqlite'})), false);
  assert.throws(() => store.openStore(storageWith({store: 'postgres'})), /No store called "postgres"/);
});

// #340: a cell holding a pipe ("Remote | hybrid") stays one cell, in the outline and when its neighbours are rewritten.
test('markdown page: a cell with a pipe reads back whole and survives other cells being set', () => {
  const page = '| Q | A |\n| --- | --- |\n| Work mode | x |\n';
  const rowOf = text => md.outline(text)[0].rows[1];
  const first = md.setCell(page, rowOf(page), 1, 'Remote | hybrid');
  assert.deepEqual(rowOf(first).cells, ['Work mode', 'Remote | hybrid']);
  const second = md.setCell(first, rowOf(first), 0, 'Mode');
  assert.deepEqual(rowOf(second).cells, ['Mode', 'Remote | hybrid'], 'rewriting the other cell kept this one');
});

// A real Notion archive is reversible; a competing edit in the DELETE request must survive on the same original block.
test('notion: conditional removal restores a block edited during archive without rewriting its new text', async () => {
  const fake = fakeNotion(['Rule: original']);
  const storage = storageWith({store: 'notion', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile'}}, {NOTION_TOKEN: 'fictional'});
  const fetcher = async (url, init) => {
    if (init?.method === 'DELETE') fake.blocks[0].text = 'Rule: newly edited';
    return fake.fetcher(url, init);
  };
  const page = store.openStore(storage, {fetcher, cache: false}).page('profile'), [old] = await page.outline();
  assert.equal(await page.remove(old, {ifUnchanged: true}), false);
  assert.equal(await page.text(), 'Rule: newly edited');
  assert.equal((await page.outline())[0].id, old.id, 'restore the original identity, never create a replacement');
});
