import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as notion from '../lib/notion.js';

const rich = text => [{plain_text: text}];
// A Profile page with a toggle and a table; `edited` is its last_edited_time.
function fakeNotion(state) {
  const routes = [];
  const fetcher = async (url, {method = 'GET'} = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0];
    routes.push(`${method} ${route}`);
    const json = value => ({ok: true, status: 200, json: async () => value});
    if (route === 'pages/profile') return json({last_edited_time: state.edited});
    if (route === 'blocks/profile/children') return json({results: [
      {id: 'h', type: 'heading_2', heading_2: {rich_text: rich('Contact')}},
      {id: 'tg', type: 'toggle', has_children: true, toggle: {rich_text: rich('Salary')}},
      {id: 'tb', type: 'table', has_children: true, table: {}}]});
    if (route === 'blocks/tg/children') return json({results: [{id: 'p', type: 'paragraph', paragraph: {rich_text: rich(state.salary)}}]});
    if (route === 'blocks/tb/children') return json({results: [{id: 'r', type: 'table_row', table_row: {cells: [rich('Email'), rich('ada@example.com')]}}]});
    if (method !== 'GET') return json({});
    throw new Error(`unexpected ${route}`);
  };
  return {fetcher, routes};
}
const ago = minutes => new Date(Date.now() - minutes * 60_000).toISOString();
const cache = {cache: true};

test('a kept page costs nothing when read again, one check once a write happened, a full read once it changed', async () => {
  notion._trees.reset();
  const state = {edited: ago(30), salary: 'CHF 150k'};
  const {fetcher, routes} = fakeNotion(state);
  assert.equal(await notion.pageText('t', 'profile', fetcher, cache), 'Contact\nSalary\nCHF 150k\nEmail | ada@example.com');
  const first = routes.length;
  assert.equal(first, 4);  // the check + the page + the toggle + the table
  await notion.textBlocks('t', 'profile', fetcher, cache);
  assert.equal(routes.length, first, 'read again at once: no request');

  await notion.call('t', 'PATCH', 'blocks/elsewhere/children', {children: []}, fetcher);  // the app wrote something
  await notion.pageText('t', 'profile', fetcher, cache);
  assert.deepEqual(routes.slice(first + 1), ['GET pages/profile'], 'after a write: only the check, the page is unchanged');

  state.edited = ago(10);
  state.salary = 'CHF 160k';
  await notion.call('t', 'PATCH', 'blocks/x', {}, fetcher);
  assert.match(await notion.pageText('t', 'profile', fetcher, cache), /CHF 160k/, 'changed in Notion: read again');
});

test('a page edited in the last 2 minutes is always read again (Notion rounds the edit time to the minute)', async () => {
  notion._trees.reset();
  const state = {edited: new Date().toISOString(), salary: 'a'};
  const {fetcher, routes} = fakeNotion(state);
  await notion.pageText('t', 'profile', fetcher, cache);
  state.salary = 'b';
  await notion.call('t', 'PATCH', 'blocks/x', {}, fetcher);
  assert.match(await notion.pageText('t', 'profile', fetcher, cache), /\nb\n/);
  assert.equal(routes.filter(route => route === 'GET blocks/profile/children').length, 2);
});

test('readers asking for the same page at once share one read', async () => {
  notion._trees.reset();
  const {fetcher, routes} = fakeNotion({edited: ago(30), salary: 'x'});
  await Promise.all([notion.pageText('t', 'profile', fetcher, cache), notion.textBlocks('t', 'profile', fetcher, cache),
    notion.pageText('t', 'profile', fetcher, cache)]);
  assert.equal(routes.length, 4);
});

test('the app and the Python engine take turns through the same pace file', async () => {
  const pace = await import('../lib/notion-pace.js');
  const path = await import('node:path');
  assert.equal(path.basename(pace.paceFile('abc')), 'jobadabra-notion-ba7816bf8f01.pace');  // src/notion/pace.py
  const token = `test-${Date.now()}`;
  const clock = () => 5_000_000;  // a fixed clock: the result doesn't depend on how fast the machine is
  const first = await pace.claim(token, clock), second = await pace.claim(token, clock);
  assert.equal(second - first, pace.GAP_MS);
  await pace.calmUntil(token, 5_002_000);
  assert.equal(await pace.claim(token, clock), 5_002_000);
  (await import('node:fs')).rmSync(pace.paceFile(token), {force: true});
});

// 17 Oct 2026, the owner's Profile: the Your details move appended its sections, read them back from the kept page (Notion still said the page was
// last edited 30 min ago), found "5 line(s) did not save", and its retry appended every section a second time. A write to a kept page drops it.
test('a write to a kept page (its children, one of its blocks, a nested block) drops that page: the next read sees the write', async () => {
  notion._trees.reset();
  const state = {edited: ago(30), salary: 'CHF 150k'};
  const {fetcher, routes} = fakeNotion(state);
  const lines = ['Contact'];
  const page = async (url, options = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0], method = options.method || 'GET';
    if (route === 'blocks/profile/children' && method === 'GET') {
      routes.push(`${method} ${route}`);
      return {ok: true, status: 200, json: async () => ({results: lines.map((text, at) => ({id: `b${at}`, type: 'paragraph', paragraph: {rich_text: rich(text)}}))})};
    }
    if (route === 'blocks/profile/children') lines.push('🛂 Work eligibility');
    if (route === 'blocks/b1' && method === 'DELETE') lines.splice(1, 1);
    return fetcher(url, options);
  };
  assert.equal(await notion.pageText('t', 'profile', page, cache), 'Contact');
  await notion.call('t', 'PATCH', 'blocks/profile/children', {children: []}, page);
  assert.equal(await notion.pageText('t', 'profile', page, cache), 'Contact\n🛂 Work eligibility', 'appended: read again, though Notion\'s edit time did not move');
  await notion.call('t', 'DELETE', 'blocks/b1', null, page);
  assert.equal(await notion.pageText('t', 'profile', page, cache), 'Contact', 'one of its blocks removed: read again');
  const reads = routes.filter(route => route === 'GET blocks/profile/children').length;
  await notion.call('t', 'PATCH', 'blocks/elsewhere', {}, page);
  await notion.pageText('t', 'profile', page, cache);
  assert.equal(routes.filter(route => route === 'GET blocks/profile/children').length, reads, 'a write elsewhere: the kept page stays');
  notion._trees.reset();
  await notion.pageText('t', 'profile', fetcher, cache);
  const before = routes.filter(route => route === 'GET blocks/profile/children').length;
  await notion.call('t', 'PATCH', 'blocks/p', {}, fetcher);   // the paragraph inside the toggle
  await notion.pageText('t', 'profile', fetcher, cache);
  assert.equal(routes.filter(route => route === 'GET blocks/profile/children').length, before + 1, 'a nested block edited: its page is read again');
});

test('a database query or a search is a read: it does not clear the kept pages\' checks', async () => {
  notion._trees.reset();
  const {fetcher, routes} = fakeNotion({edited: ago(30), salary: 'a'});
  await notion.pageText('t', 'profile', fetcher, cache);
  const first = routes.length;
  await notion.call('t', 'POST', 'databases/db1/query', {}, fetcher).catch(() => {});
  await notion.call('t', 'POST', 'search', {}, fetcher).catch(() => {});
  await notion.pageText('t', 'profile', fetcher, cache);
  assert.deepEqual(routes.slice(first).filter(route => route.startsWith('GET')), [], 'no check, no read after the queries');
});
