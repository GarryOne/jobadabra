// Strategy → What you're targeting → Edit: the lists change in the search settings AND the Notion page (or neither), only lists from the fixed set.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EDITABLE_LISTS, cleanEdits, editLists} from '../lib/strategy.js';

function setup({writeFails = false} = {}) {
  const files = {'config/search.json': JSON.stringify({role_keywords: ['vendeu(r|se)', 'store manager'],
    locations: {top_tier: ['geneva', 'switzerland'], country_wide: [], abroad: []}, quality_stack_keywords: ['lightroom'], title_exclude_keywords: ['stage']})};
  const calls = [];
  const storage = {readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; calls.push(['write', name]); },
    secret: name => (name === 'NOTION_TOKEN' ? 'tok' : ''), settings: () => ({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_SEARCH_SETTINGS_PAGE: 'settings'}}), saveSettings() {}};
  const deps = {wait: async () => {}, run: async (_, args) => { calls.push(['run', args.slice(-1)[0]]); return {code: 0, stdout: '## Roles to look for\n- x\n'}; }, ensurePage: async () => 'settings',
    writePage: async (token, page) => { calls.push(['publish', page]); if (writeFails) throw new Error('Notion said no'); }};
  return {files, calls, storage, deps};
}
const search = files => JSON.parse(files['config/search.json']);

test('a place moves from Best places to Anywhere in, a role is added: read first, then written and published', async () => {
  const t = setup();
  const result = await editLists(t.storage, {places: {remove: ['switzerland']}, country: {add: ['Switzerland']}, roles: {add: ['Verkäufer']}}, t.deps);
  assert.deepEqual(result.changed.sort(), ['country', 'places', 'roles']);
  const now = search(t.files);
  assert.deepEqual(now.locations.top_tier, ['geneva']);
  assert.deepEqual(now.locations.country_wide, ['switzerland']);
  assert.deepEqual(now.target_roles.map(role => role.title), ['/vendeu(r|se)/', 'store manager', 'Verkäufer']);   // one list; role_keywords and the searches follow it
  assert.deepEqual(now.role_keywords, ['vendeu(r|se)', 'store manager', 'verkäufer']);
  assert.deepEqual(now.title_exclude_keywords, ['stage']);          // other lists untouched
  assert.deepEqual(t.calls.slice(0, 2), [['run', 'sync'], ['write', 'config/search.json']]);
  assert.ok(t.calls.some(call => call[0] === 'publish'));
});

test('Notion refusing leaves the cached settings as they were', async () => {
  const t = setup({writeFails: true});
  const before = t.files['config/search.json'];
  await assert.rejects(editLists(t.storage, {places: {remove: ['switzerland']}}, t.deps), /Notion said no/);
  assert.equal(t.files['config/search.json'], before);
});

test('only the fixed lists, sane words, escaped as text', () => {
  assert.deepEqual(Object.keys(EDITABLE_LISTS).sort(), ['abroad', 'country', 'finders', 'gplaces', 'gqueries', 'languages', 'places', 'remoteSkip', 'rights', 'roles', 'searchOverride', 'skip', 'stack', 'titleSkip']);
  assert.deepEqual(cleanEdits({title_exclude_keywords: {add: ['x y']}, roles: {add: ['a', 'c++ dev', 'x'.repeat(61), 'two\nlines']}}),
    {roles: {add: ['c++ dev'], remove: []}});
  assert.deepEqual(cleanEdits({roles: {add: [], remove: []}}), {});
});

test('search phrases and hidden languages are kept as written, in their own files; remote is a Yes/No', async () => {
  const t = setup();
  t.files['config/preferences.json'] = JSON.stringify({disqualifying_languages: ['english', 'german'], work_rights: [], digest_min_score: 50});
  const result = await editLists(t.storage, {roles: {add: ['Vendeur Magasin']}, languages: {remove: ['english']}, rights: {add: ['EU']},
    remote: {set: 'No'}}, t.deps);
  assert.deepEqual(result.changed.sort(), ['languages', 'remote', 'rights', 'roles']);
  const prefs = JSON.parse(t.files['config/preferences.json']);
  assert.deepEqual(prefs.disqualifying_languages, ['german']);
  assert.deepEqual(prefs.work_rights, ['eu']);
  assert.equal(prefs.digest_min_score, 50, 'the rest of the preferences untouched');
  assert.deepEqual(search(t.files).jobs_board_search_queries, ['/vendeu(r|se)/', 'store manager', 'Vendeur Magasin']);   // a role title is a job board search too
  assert.deepEqual(search(t.files).remote_jobs, ['No']);
  assert.deepEqual(cleanEdits({remote: {set: 'maybe'}}), {});
});

test('nothing asked, nothing read or written', async () => {
  const t = setup();
  assert.deepEqual(await editLists(t.storage, {}, t.deps), {changed: []});
  assert.deepEqual(t.calls, []);
});

test("a save drops the engine's copy of the settings page, so the next search reads the page itself", async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-copy-'));
  const copy = path.join(dir, 'data', 'cache', 'notion-pages', 'settings.json');
  fs.mkdirSync(path.dirname(copy), {recursive: true});
  fs.writeFileSync(copy, '{"edited": "2026-10-07T10:33:00.000Z", "text": "- suisse"}');
  const t = setup();
  t.storage.path = (...parts) => path.join(dir, ...parts);
  await editLists(t.storage, {country: {add: ['Romandie']}}, t.deps);
  assert.equal(fs.existsSync(copy), false);
});

test('a roles edit asks the engine to redraft the words drawn from the old field, after the write and before the publish; other edits do not', async () => {
  const t = setup();
  await editLists(t.storage, {roles: {add: ['Pilot']}}, t.deps);
  const steps = t.calls.map(call => call.join(':'));
  assert.ok(steps.indexOf('write:config/search.json') < steps.indexOf('run:apply'), steps.join(' '));
  assert.ok(steps.indexOf('run:apply') < steps.findIndex(step => step.startsWith('publish')), steps.join(' '));
  const other = setup();
  await editLists(other.storage, {places: {add: ['Zurich']}}, other.deps);
  assert.ok(!other.calls.some(call => call[1] === 'apply'));
});
