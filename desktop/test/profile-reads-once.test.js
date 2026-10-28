// Settings → Profile opens its tabs against real Notion calls (a stubbed global fetch, the path the app takes): every reader of the Profile and
// Application answers pages shares one read per page per visit, and switching tabs again reads nothing more (17 Oct 2026: 17 calls cold, 12 warm).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as contact from '../lib/contact.js';
import * as sections from '../lib/profile-sections.js';
import {_trees} from '../lib/notion-core.js';
import {registerTextOutlineHandlers} from '../lib/text-outline-handlers.js';
import {createStorage} from '../lib/storage.js';
import * as locations from '../lib/locations-store.js';
import {pageTree} from '../lib/notion.js';
import * as questions from '../lib/questions.js';
import * as strategySettings from '../lib/strategy-settings.js';

const rich = text => [{plain_text: text}];
const para = (id, text) => ({id, type: 'paragraph', paragraph: {rich_text: rich(text)}});
const PAGES = {
  profile: [{id: 'tg', type: 'toggle', has_children: true, toggle: {rich_text: rich('Salary')}}, {id: 'h', type: 'heading_2', heading_2: {rich_text: rich('📇 Contact details')}}, para('c', 'Email: ada@example.com')],
  answers: [para('a', 'Notice period: ❓')],
};
const CHILDREN = {tg: [para('p', 'CHF 150k')]};

// The reads that cost: one page check and one block list per page/toggle. `calls` is how many reached Notion.
function stubNotion() {
  const calls = [], real = globalThis.fetch;
  globalThis.fetch = async (url, {method = 'GET'} = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0].replace(/-/g, '');   // Notion takes an id with or without dashes
    calls.push(`${method} ${route}`);
    const json = value => ({ok: true, status: 200, json: async () => value});
    const page = route.match(/^blocks\/(profile|answers)\/children$/);
    if (page) return json({results: PAGES[page[1]], has_more: false});
    if (/^pages\/(profile|answers)$/.test(route)) return json({last_edited_time: new Date(Date.now() - 3_600_000).toISOString()});
    const child = route.match(/^blocks\/(\w+)\/children$/);
    if (child && CHILDREN[child[1]]) return json({results: CHILDREN[child[1]], has_more: false});
    throw new Error(`unexpected ${method} ${route}`);
  };
  return {calls, restore: () => { globalThis.fetch = real; }};
}

const storage = () => {
  const made = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-reads-')), {encrypt: value => value, decrypt: value => value});
  made.saveSettings({store: 'notion', profileMovedAt: 'x', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}});
  made.setSecret('NOTION_TOKEN', 'secret');
  return made;
};

// Everything the Profile tabs ask the main process at open, as the app wires it.
function readers(made) {
  const handlers = new Map();
  registerTextOutlineHandlers({ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, storage: made, DEMO: false, log() {}});
  const outline = name => handlers.get('textOutline')(null, name);
  return {
    'Profile outline (Experience, Strategy tabs)': () => outline('profile'),
    'Application answers outline': () => outline('answers'),
    'Your details facts': () => sections.read(made),
    'Contact details': () => contact.read(made),
    'Locations (Strategy)': () => locations.profileRows(made),
    'Questions drawer': () => questions.list(made),
    'Standard answers': () => questions.standardAnswers(made),
    'Strategy texts': () => strategySettings.profileTexts(made),
  };
}
const blockReads = calls => calls.filter(call => call.startsWith('GET blocks/'));

test('a cold Profile open reads each page once, all tabs together; a tab switch reads nothing more', async () => {
  _trees.reset();
  const stub = stubNotion();
  try {
    const all = readers(storage());
    await Promise.all(Object.values(all).map(read => read()));
    const cold = blockReads(stub.calls);
    // 2 pages + 1 toggle = 3 block lists, however many tabs asked
    assert.deepEqual([...cold].sort(), ['GET blocks/answers/children', 'GET blocks/profile/children', 'GET blocks/tg/children'], `cold open: ${stub.calls.join(', ')}`);
    const before = stub.calls.length;
    for (const [name, read] of Object.entries(all)) { await read(); assert.equal(stub.calls.length, before, `${name}: warm tab switch made a call: ${stub.calls.slice(before)}`); }
  } finally { stub.restore(); }
});

test('one page asked for with and without dashes is one read (the id comes from settings, a link, or Notion\'s own answers)', async () => {
  _trees.reset();
  const stub = stubNotion();
  try {
    await Promise.all([pageTree('secret', 'pro-file'), pageTree('secret', 'profile')]);
    assert.equal(blockReads(stub.calls).filter(call => call === 'GET blocks/profile/children').length, 1, stub.calls.join(', '));
  } finally { stub.restore(); }
});
