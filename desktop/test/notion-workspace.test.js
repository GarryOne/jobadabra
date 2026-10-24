// "Connect with Notion" with the Jobadabra template: the token's duplicated_template_id is the page Notion copied
// the template into; the app waits for that copy (never an older one), builds in it when empty, repairs what's missing.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as notion from '../lib/notion.js';
import * as oauth from '../lib/notion-oauth.js';
import {connectWorkspace} from '../lib/notion-workspace.js';

const T = notion.TEMPLATE;
const COPY = '3e862be8fd868143b431df70d505ed7c';
const COPY_DASHED = '3e862be8-fd86-8143-b431-df70d505ed7c';
const title = text => [{plain_text: text, text: {content: text}}];
const page = (id, parent, name) => ({object: 'page', id, parent: parent ? {type: 'page_id', page_id: parent} : {type: 'workspace', workspace: true},
  last_edited_time: '2026-09-30', properties: {title: {type: 'title', title: title(name)}}});
const database = (id, parent, name) => ({object: 'database', id, parent: {type: 'page_id', page_id: parent}, last_edited_time: '2026-09-30',
  title: title(name), properties: {}});
const columns = env => Object.fromEntries((T.required_properties[env] || []).map(name => [name, {}]));
const workspaceItems = (root, prefix) => [
  ...Object.entries(T.databases).map(([env, name]) => ({...database(`${prefix}db_${env}`, root, name), properties: columns(env)})),
  ...Object.entries(T.pages).map(([env, name]) => page(`${prefix}pg_${env}`, root, name))];

// A fake Notion: `appears` returns what the search sees on the nth search (Notion copying the template over time).
function fakeNotion(appears) {
  let searches = 0, current = [];
  const fetcher = async (url, init = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0];
    const body = init.body ? JSON.parse(init.body) : {};
    const reply = data => ({ok: true, json: async () => data});
    if (route === 'search') {
      if (body.filter.value === 'database') current = appears(++searches);  // one database + one page search per look
      return reply({results: current.filter(i => i.object === body.filter.value), has_more: false});
    }
    if (route.startsWith('databases/')) return reply(current.find(i => `databases/${i.id}` === route) || {properties: {}});
    return reply({});
  };
  return fetcher;
}
const noRepair = async (_, ids) => ({ids, created: [], columns: []});
const fast = {sleep: async () => {}, repair: noRepair};

test('the token\'s duplicated_template_id becomes the page to use; anything else means "the user picked a page"', () => {
  assert.equal(oauth.templateRoot({duplicated_template_id: COPY_DASHED}), COPY);
  assert.equal(oauth.templateRoot({duplicated_template_id: COPY.toUpperCase()}), COPY);
  assert.equal(oauth.templateRoot({duplicated_template_id: null}), null);
  assert.equal(oauth.templateRoot({}), null);
  assert.equal(oauth.templateRoot({duplicated_template_id: 'tpl'}), null);
  assert.equal(oauth.templateRoot(null), null);
});

test('one click: the copied template is found once Notion has shared it, and an older copy elsewhere is ignored', async () => {
  const old = workspaceItems('old-root', 'old_');
  const copy = workspaceItems(COPY_DASHED, 'new_');
  // Look 1: only the old copy; look 2: half the new one; look 3: all of it.
  const fetcher = fakeNotion(n => [page('old-root', null, 'Jobadabra'), ...old, ...(n === 1 ? [] : n === 2 ? copy.slice(0, 4) : copy)]);
  const progress = [];
  let built = false;
  const result = await connectWorkspace('ntn_x', {templateRoot: COPY_DASHED, fetcher, onProgress: p => progress.push(p), ...fast,
    repair: async (...args) => { built = true; return noRepair(...args); }});
  assert.equal(result.ok, true);
  assert.ok(Object.values(result.ids).every(id => id.startsWith('new_')), JSON.stringify(result.ids));
  assert.equal(built, false);  // nothing rebuilt next to a copy Notion was still making
  assert.ok(progress.length >= 2 && progress.every(p => p.template));
  assert.equal(progress[0].found, 0);
});

test('the template\'s copy stays empty: the workspace is built in that page from the schema', async () => {
  const fetcher = fakeNotion(() => [page(COPY_DASHED, null, 'Jobadabra')]);
  let builtIn = null;
  const repair = async (_, ids, _schema, _fetcher, root) => {
    builtIn = root;
    return {ids: {...ids, NOTION_PROFILE_PAGE_ID: 'p'}, created: ['Profile — CV and Preferences'], columns: []};
  };
  const result = await connectWorkspace('ntn_x', {templateRoot: COPY_DASHED, fetcher, ...fast, repair});
  assert.equal(builtIn, COPY);
  assert.equal(result.ok, true);
  assert.deepEqual(result.built, ['Profile — CV and Preferences']);
});

test('an older template copy (a database missing): the schema adds it inside the copied page', async () => {
  const [first, ...rest] = workspaceItems(COPY_DASHED, 'new_');
  let added = false;
  const fetcher = fakeNotion(() => (added ? [first, ...rest] : rest));
  let repairedIn = null;
  const repair = async (_, ids, _schema, _fetcher, root) => { repairedIn = root; added = true; return {ids, created: [first.title[0].plain_text], columns: []}; };
  const result = await connectWorkspace('ntn_x', {templateRoot: COPY, fetcher, ...fast, repair});
  assert.equal(repairedIn, COPY);
  assert.equal(result.ok, true);
  assert.deepEqual(result.repaired.created, [first.title[0].plain_text]);
});

test('without a template (the user picked their own empty page): built in the one shared page, as before', async () => {
  const fetcher = fakeNotion(() => [page('mine', null, 'Jobadabra')]);
  let builtIn = null;
  const repair = async (_, ids, _schema, _fetcher, root) => { builtIn = root; return {ids: {NOTION_PROFILE_PAGE_ID: 'p'}, created: ['x'], columns: []}; };
  const result = await connectWorkspace('ntn_x', {fetcher, ...fast, repair});
  assert.equal(builtIn, 'mine');
  assert.equal(result.ok, true);
});
