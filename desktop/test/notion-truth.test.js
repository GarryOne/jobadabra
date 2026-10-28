// Notion is the source of truth: contact details and open questions live there, and what an older version left on the Mac moves to
// Notion once (then the Mac copy is gone). Retired Form knowledge notes (PR B1, 28 Oct 2026) are not moved: they stay, unread.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as contact from '../lib/contact.js';
import * as migrate from '../lib/migrate.js';
import {createStorage} from '../lib/storage.js';
import {fakeNotion} from './fake-notion.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
const connected = (ids = {}) => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({setupDone: true, notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers', ...ids}});
  return storage;
};

test('contact details are a section of the Notion Profile; saving rewrites only that section', async () => {
  const storage = connected();
  const {fetcher, texts} = fakeNotion(['## Summary', 'SRE, 10 years', '## 📇 Contact details', 'Email: old@x.com', 'Phone: +41 1', '## Preferences', 'Zurich']);
  assert.deepEqual(await contact.read(storage, fetcher), {email: 'old@x.com', phone: '+41 1'});
  await contact.save(storage, {first_name: 'Igor', email: 'igor@x.com', bogus: 'x'}, fetcher);
  assert.deepEqual(texts(), ['## Summary', 'SRE, 10 years', '## 📇 Contact details', 'First name: Igor', 'Email: igor@x.com', '## Preferences', 'Zurich']);
  assert.equal(storage.settings().contact, undefined);
  // No section yet: it's added at the end.
  const empty = fakeNotion(['## Summary']);
  await contact.save(storage, {email: 'a@b.c'}, empty.fetcher);
  assert.deepEqual(empty.texts(), ['## Summary', '## 📇 Contact details', 'Email: a@b.c']);
});

test('an older Profile\'s "Contact" and "Links" sections are read too (Name is split into first and last)', async () => {
  const storage = connected();
  const {fetcher} = fakeNotion(['## Summary', 'Name: not this one', '## Contact', 'Name: Igor Mardari', 'Location: Geneva, Switzerland',
    'Email: igor@x.com', 'Phone: +40 770', '(Added from CV.)', '## Links', 'LinkedIn: https://linkedin.com/in/igor', 'Medium: https://m.com']);
  assert.deepEqual(await contact.read(storage, fetcher), {full_name: 'Igor Mardari', first_name: 'Igor', last_name: 'Mardari',
    location: 'Geneva, Switzerland', email: 'igor@x.com', phone: '+40 770', linkedin: 'https://linkedin.com/in/igor'});
});

test('data an older version kept on the Mac moves to Notion once, then only Notion has it', async () => {
  const storage = connected({NOTION_KNOWLEDGE_PAGE: 'kp'});
  storage.saveSettings({
    openQuestions: [{key: 'visa sponsorship', question: 'Visa sponsorship', company: 'Acme'}], answeredQuestions: ['x'],
    formKnowledge: [{scope: 'any', kind: 'widget', field: 'City', note: 'Type, then pick the suggestion', value: ''}],
    contact: {email: 'igor@x.com', phone: '+41 1'},
  });
  const page = fakeNotion(['## 📇 Contact details', 'Email: notion@x.com']);  // one fake page stands in for all three
  // (profile copies and search settings have their own tests; they'd need the Python side here)
  const steps = migrate.STEPS.filter(s => !['workspace', 'profile copies', 'search settings', 'search settings format'].includes(s.name));
  const moved = await migrate.run(storage, () => {}, steps, page.fetcher);
  assert.deepEqual(moved, ['open questions', 'contact details']);
  const texts = page.texts();
  assert.ok(texts.includes('Visa sponsorship: ❓ (asked by Acme)'));
  assert.ok(texts.includes('Email: notion@x.com') && texts.includes('Phone: +41 1'));  // Notion's value won
  const settings = storage.settings();
  for (const key of ['openQuestions', 'answeredQuestions', 'contact']) assert.equal(settings[key], undefined, key);
  assert.equal(settings.formKnowledge.length, 1, 'retired notes (PR B1) stay where they are, unread');
  assert.deepEqual(await migrate.run(storage, () => {}, steps, page.fetcher), []);  // nothing left
});

test('search settings become a readable Notion page next to the Profile, created once and rewritten after a rebuild', async () => {
  const {publishSearchSettings} = await import('../lib/strategy.js');
  const storage = connected();
  const calls = [];
  const deps = {
    run: async (_, args) => { calls.push(args.join(' ')); return {code: 0, stdout: '## Roles to look for\n- sre\n'}; },
    ensurePage: async (token, beside, title) => { calls.push(`create ${title} beside ${beside}`); return 'settings-page'; },
    writePage: async (token, page, markdown) => { calls.push(`write ${page}: ${markdown.trim().split('\n')[1]}`); },
  };
  assert.equal(await publishSearchSettings(storage, deps), 'settings-page');
  assert.equal(storage.settings().notionIds.NOTION_SEARCH_SETTINGS_PAGE, 'settings-page');
  await publishSearchSettings(storage, deps);  // exists now: only rewritten
  assert.deepEqual(calls, ['create ⚙️ Search settings beside profile', 'src.notion.search_settings render', 'write settings-page: - sre',
    'src.notion.search_settings render', 'write settings-page: - sre']);
});

test('replacing a strategy keeps the current Profile, answers and search settings in a "Previous strategy" page first', async () => {
  const {snapshotStrategy} = await import('../lib/notion.js');
  const pages = {profile: [{type: 'heading_2', text: 'Hard constraints'}, {type: 'table', rows: [['Constraint', 'Value'], ['Countries', 'Switzerland']]}],
    answers: [{type: 'bulleted_list_item', text: 'Pronouns — He/him'}], settings: [{type: 'paragraph', text: 'Roles: sre'}]};
  const made = [];
  const rich = text => [{plain_text: text, annotations: {}}];
  const fetcher = async (url, init = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0];
    const body = init.body ? JSON.parse(init.body) : {};
    let data = {};
    if (init.method === 'GET' && route === 'pages/profile') data = {parent: {page_id: 'root'}};
    else if (init.method === 'POST' && route === 'pages') { made.push({title: body.properties.title.title[0].text.content, blocks: []}); data = {id: 'snap-1'}; }
    else if (init.method === 'PATCH' && route === 'blocks/snap-1/children') made[0].blocks.push(...body.children);
    else if (init.method === 'GET' && route.endsWith('/children')) {
      const id = route.split('/')[1];
      if (id.startsWith('table-')) data = {results: pages.profile[1].rows.map(cells => ({type: 'table_row', table_row: {cells: cells.map(rich)}}))};
      else data = {results: (pages[id] || []).map((b, i) => b.type === 'table'
        ? {id: `table-${i}`, type: 'table', table: {table_width: 2, has_column_header: true}, has_children: true}
        : {id: `${id}-${i}`, type: b.type, [b.type]: {rich_text: rich(b.text)}, has_children: false})};
      data.has_more = false;
    }
    return {ok: true, json: async () => data};
  };
  const id = await snapshotStrategy('ntn_x', {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers', NOTION_SEARCH_SETTINGS_PAGE: 'settings'}, '28 Sep 2026, 15:02', fetcher);
  assert.equal(id, 'snap1');
  assert.equal(made[0].title, 'Previous strategy — 28 Sep 2026, 15:02');
  const types = made[0].blocks.map(b => b.type);
  assert.deepEqual(types, ['heading_1', 'heading_2', 'table', 'heading_1', 'bulleted_list_item', 'heading_1', 'paragraph']);
  assert.deepEqual(made[0].blocks[2].table.children[1].table_row.cells.map(c => c[0].text.content), ['Countries', 'Switzerland']);
});

// 2 Oct 2026: the Profile's list showed a table that was already gone; copying its rows answered 404 "Could not find block" and the whole save failed.
test('a block the list still shows but Notion no longer has is left out of the "Previous strategy" copy, not fatal', async () => {
  const {snapshotStrategy} = await import('../lib/notion.js');
  const rich = text => [{plain_text: text, annotations: {}}];
  const made = [];
  const reply = (status, data) => ({ok: status < 300, status, json: async () => data});
  const fetcher = async (url, init = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0];
    const body = init.body ? JSON.parse(init.body) : {};
    if (init.method === 'GET' && route === 'pages/profile') return reply(200, {parent: {page_id: 'root'}});
    if (init.method === 'POST' && route === 'pages') { made.push([]); return reply(200, {id: 'snap-1'}); }
    if (init.method === 'PATCH') { made[0].push(...body.children); return reply(200, {}); }
    if (route === 'blocks/profile/children') return reply(200, {has_more: false, results: [
      {id: 'ghost-table', type: 'table', table: {table_width: 2}, has_children: true},
      {id: 'live', type: 'paragraph', paragraph: {rich_text: rich('Home base: Austin')}, has_children: false}]});
    if (route === 'blocks/ghost-table/children') return reply(404, {code: 'object_not_found', message: 'Could not find block with ID: ghost-table.'});
    return reply(200, {results: [], has_more: false});
  };
  await snapshotStrategy('ntn_x', {NOTION_PROFILE_PAGE_ID: 'profile'}, 'now', fetcher);
  assert.deepEqual(made[0].map(b => b.type), ["heading_1", "paragraph"]);
});
