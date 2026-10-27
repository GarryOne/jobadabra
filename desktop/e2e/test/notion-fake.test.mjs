// The in-memory Notion (lib/notion-fake.mjs): the requests the app makes, in Notion's shapes (docs/notion-surface.md).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createNotionFake} from '../lib/notion-fake.mjs';

const call = (fake, method, path, body = {}, query = '') => fake.handle(method, path, body, new URLSearchParams(query));
const text = value => [{text: {content: value}}];

test('a database, its rows, filtered and paged queries, newest first', () => {
  const fake = createNotionFake();
  const db = call(fake, 'POST', 'databases', {parent: {page_id: fake.root.id}, title: text('Job Tracker'),
    properties: {Job: {title: {}}, Stage: {select: {}}, 'Job URL': {url: {}}, Fit: {number: {}}, Applied: {date: {}}}}).body;
  for (const [i, stage] of ['Saved', 'Applied', 'Applied'].entries())
    call(fake, 'POST', 'pages', {parent: {database_id: db.id}, properties: {Job: {title: text(`Job ${i}`)}, Stage: {select: {name: stage}}, 'Job URL': {url: `https://x/${i}`}, Fit: {number: 70 + i}, Applied: {date: {start: `2026-10-0${i + 1}`}}}});
  const q = filter => call(fake, 'POST', `databases/${db.id}/query`, {filter}).body.results.map(row => row.properties.Job.title[0].plain_text);
  assert.deepEqual(q({property: 'Stage', select: {equals: 'Applied'}}).sort(), ['Job 1', 'Job 2']);
  assert.deepEqual(q({and: [{property: 'Fit', number: {greater_than: 70}}, {property: 'Applied', date: {on_or_after: '2026-10-03'}}]}), ['Job 2']);
  assert.deepEqual(q({or: [{property: 'Job URL', url: {equals: 'https://x/0'}}, {property: 'Job', title: {equals: 'Job 2'}}]}).sort(), ['Job 0', 'Job 2']);
  const first = call(fake, 'POST', `databases/${db.id}/query`, {page_size: 2}).body;
  assert.equal(first.results.length, 2); assert.equal(first.has_more, true);
  assert.equal(call(fake, 'POST', `databases/${db.id}/query`, {page_size: 2, start_cursor: first.next_cursor}).body.results.length, 1);
  assert.equal(call(fake, 'POST', `databases/${db.id}/query`, {filter: {property: 'Stage', select: {does_not_exist: 'x'}}}).status, 400, 'an unknown filter is said, not ignored');
});

test('an archived page leaves queries and cannot be edited, as in Notion', () => {
  const fake = createNotionFake();
  const db = call(fake, 'POST', 'databases', {parent: {page_id: fake.root.id}, title: text('T'), properties: {Name: {title: {}}}}).body;
  const row = call(fake, 'POST', 'pages', {parent: {database_id: db.id}, properties: {Name: {title: text('a')}}}).body;
  assert.equal(call(fake, 'PATCH', `pages/${row.id}`, {archived: true}).status, 200);
  assert.equal(call(fake, 'POST', `databases/${db.id}/query`, {}).body.results.length, 0);
  const again = call(fake, 'PATCH', `pages/${row.id}`, {archived: true});
  assert.equal(again.status, 400); assert.match(again.body.message, /Can't edit block that is archived/);
});

test('page bodies: append, insert after a block, read in pages, delete one block; search finds pages and databases', () => {
  const fake = createNotionFake();
  const pageId = call(fake, 'POST', 'pages', {parent: {page_id: fake.root.id}, properties: {title: {title: text('⚙️ Search settings')}},
    children: [{type: 'heading_3', heading_3: {rich_text: text('Roles to look for')}}, {type: 'bulleted_list_item', bulleted_list_item: {rich_text: text('sre')}}]}).body.id;
  const [heading] = call(fake, 'GET', `blocks/${pageId}/children`).body.results;
  call(fake, 'PATCH', `blocks/${pageId}/children`, {after: heading.id, children: [{type: 'bulleted_list_item', bulleted_list_item: {rich_text: text('devops')}}]});
  let blocks = call(fake, 'GET', `blocks/${pageId}/children`).body.results;
  assert.deepEqual(blocks.map(block => block[block.type].rich_text[0].plain_text), ['Roles to look for', 'devops', 'sre']);
  call(fake, 'DELETE', `blocks/${blocks[2].id}`);
  blocks = call(fake, 'GET', `blocks/${pageId}/children`).body.results;
  assert.equal(blocks.length, 2);
  assert.equal(call(fake, 'POST', 'search', {query: 'search settings', filter: {property: 'object', value: 'page'}}).body.results[0].id, pageId);
  assert.equal(call(fake, 'GET', 'users/me').status, 200);
  assert.equal(call(fake, 'GET', 'comments').status, 400, 'a request the stand-in does not know is said, never answered with made-up data');
});

test('a scenario is plain data, loaded in one call', () => {
  const fake = createNotionFake();
  const ids = fake.seed({databases: [{title: 'Job Tracker', properties: {Job: {title: {}}, Stage: {select: {}}},
    rows: Array.from({length: 200}, (_, i) => ({Job: {title: text(`Job ${i}`)}, Stage: {select: {name: i % 2 ? 'Applied' : 'Saved'}}}))}]});
  const all = [];
  for (let cursor; ;) { const out = call(fake, 'POST', `databases/${ids['Job Tracker']}/query`, {start_cursor: cursor}).body; all.push(...out.results); if (!out.has_more) break; cursor = out.next_cursor; }
  assert.equal(all.length, 200);
});

test('every id comes back with dashes, as from Notion, whatever the request sent', () => {
  const fake = createNotionFake();
  const bare = fake.root.id.replace(/-/g, '');
  const db = call(fake, 'POST', 'databases', {parent: {type: 'page_id', page_id: bare}, title: text('T'), properties: {Name: {title: {}}}}).body;
  const page = call(fake, 'POST', 'pages', {parent: {page_id: bare}, properties: {title: {title: text('👤 Profile')}}}).body;
  assert.equal(db.parent.page_id, fake.root.id);
  assert.equal(page.parent.page_id, fake.root.id);
  const row = call(fake, 'POST', 'pages', {parent: {database_id: db.id.replace(/-/g, '')}, properties: {Name: {title: text('a')}}}).body;
  assert.equal(row.parent.database_id, db.id);
});

test('an uploaded file keeps its bytes and reads back as a hosted file block', async () => {
  const {startNotionFake} = await import('../lib/notion-fake.mjs');
  const fake = await startNotionFake();
  try {
    const page = fake.handle('POST', 'pages', {parent: {page_id: fake.root.id}, properties: {title: {title: text('Kit')}}}, {}, new URLSearchParams()).body;
    const upload = fake.handle('POST', 'file_uploads', {filename: 'cv.pdf', content_type: 'application/pdf'}, new URLSearchParams()).body;
    const boundary = 'b0undary', body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cv.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      Buffer.from([0x25, 0x50, 0x44, 0x46, 0x0d, 0x0a, 0xff]), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const sent = await fetch(`${fake.url}/v1/file_uploads/${upload.id}/send`, {method: 'POST', headers: {authorization: `Bearer ${fake.token}`, 'content-type': `multipart/form-data; boundary=${boundary}`}, body});
    assert.equal((await sent.json()).status, 'uploaded');
    call(fake, 'PATCH', `blocks/${page.id}/children`, {children: [{type: 'file', file: {type: 'file_upload', file_upload: {id: upload.id}}}]});
    const [block] = call(fake, 'GET', `blocks/${page.id}/children`).body.results;
    assert.equal(block.file.type, 'file'); assert.equal(block.file.name, 'cv.pdf');
    const got = await fetch(block.file.file.url);
    assert.equal(got.headers.get('content-type'), 'application/pdf');
    assert.deepEqual([...Buffer.from(await got.arrayBuffer())], [0x25, 0x50, 0x44, 0x46, 0x0d, 0x0a, 0xff]);
  } finally { await fake.close(); }
});

test('a two-way relation gets its other side on the target, and a rename of that side is followed, as in Notion', () => {
  const fake = createNotionFake();
  const make = title => call(fake, 'POST', 'databases', {parent: {page_id: fake.root.id}, title: text(title), properties: {Name: {title: {}}}}).body;
  const apps = make('Applications'), runs = make('Runs');
  call(fake, 'PATCH', `databases/${apps.id}`, {properties: {Runs: {relation: {database_id: runs.id, type: 'dual_property', dual_property: {}}}}});
  const other = 'Related to Applications (Runs)';
  assert.equal(call(fake, 'GET', `databases/${runs.id}`).body.properties[other]?.relation.database_id, apps.id);
  call(fake, 'PATCH', `databases/${runs.id}`, {properties: {[other]: {name: 'Application'}}});   // lib/schema.js names it after the schema
  assert.equal(call(fake, 'GET', `databases/${apps.id}`).body.properties.Runs.relation.dual_property.synced_property_name, 'Application');
  call(fake, 'PATCH', `databases/${apps.id}`, {properties: {Solo: {relation: {database_id: runs.id, type: 'single_property', single_property: {}}}}});
  assert.equal(Object.keys(call(fake, 'GET', `databases/${runs.id}`).body.properties).length, 2, 'a one-way relation has no other side');
});

// The class, not the case: any second install (a second app, a relaunch on a new profile, another Mac) connects to what the first built.
test('a second install of the app connects to the workspace the first one built on the stand-in', async () => {
  const {startNotionFake} = await import('../lib/notion-fake.mjs');
  const fake = await startNotionFake();
  const before = {flag: process.env.JOB_PILOTTO_E2E, url: process.env.JOB_PILOTTO_E2E_NOTION_BASE_URL};
  Object.assign(process.env, {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_NOTION_BASE_URL: fake.url});   // read when the app's Notion module loads (lib/notion-core.js)
  // Only the stand-in: a request anywhere else (real Notion) fails the test instead of leaving this computer.
  const fetcher = (url, options) => { if (!String(url).startsWith(fake.url)) throw new Error(`the test reached ${url}`); return fetch(url, options); };
  try {
    const {connectWorkspace} = await import('../../lib/notion-workspace.js');
    const first = await connectWorkspace(fake.token, {sleep: async () => {}, fetcher});
    assert.ok(first.ok && first.built?.length, 'the first install builds the workspace');
    const second = await connectWorkspace(fake.token, {sleep: async () => {}, fetcher});
    assert.deepEqual({ok: second.ok, missing: second.missing, problems: second.problems}, {ok: true, missing: [], problems: []});
    assert.deepEqual(second.ids, first.ids);
  } finally {
    for (const [name, value] of [['JOB_PILOTTO_E2E', before.flag], ['JOB_PILOTTO_E2E_NOTION_BASE_URL', before.url]]) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    await fake.close();
  }
});

test('url filters as Notion has them, and a request the stand-in does not know is recorded as a gap', () => {
  const fake = createNotionFake();
  const db = call(fake, 'POST', 'databases', {parent: {page_id: fake.root.id}, title: text('T'), properties: {Job: {title: {}}, 'Job URL': {url: {}}}}).body;
  call(fake, 'POST', 'pages', {parent: {database_id: db.id}, properties: {Job: {title: text('Lever')}, 'Job URL': {url: 'https://jobs.lever.co/e2e/5e2e'}}});
  const count = filter => call(fake, 'POST', `databases/${db.id}/query`, {filter}).body.results?.length;
  assert.equal(count({property: 'Job URL', url: {contains: '/e2e/5E2E'}}), 1, 'a form page\'s URL finds its job (worker/src/extension.js findRow)');
  assert.equal(count({property: 'Job URL', url: {does_not_contain: 'lever'}}), 0);
  assert.equal(count({property: 'Job URL', url: {is_not_empty: true}}), 1);
  assert.deepEqual(fake.stats.unknown, []);
  assert.equal(call(fake, 'POST', `databases/${db.id}/query`, {filter: {property: 'Job URL', url: {sounds_like: 'x'}}}).status, 400);
  assert.equal(call(fake, 'GET', 'comments').status, 400);
  assert.deepEqual(fake.stats.unknown.map(line => line.split(':')[0]), ['the Notion stand-in does not know the filter url.sounds_like', 'the Notion stand-in does not know GET comments']);
});

test('a change to any block in a page changes the page\'s last_edited_time, as in Notion (the engine re-reads a page by it)', async () => {
  const fake = createNotionFake();
  const bullet = t => ({object: 'block', type: 'bulleted_list_item', bulleted_list_item: {rich_text: text(t)}});
  const made = call(fake, 'POST', 'pages', {parent: {page_id: fake.root.id}, properties: {title: {title: text('Search settings')}},
    children: [{object: 'block', type: 'heading_3', heading_3: {rich_text: text('Kit'), is_toggleable: true, children: [bullet('nested')]}}]}).body;
  const edited = () => call(fake, 'GET', `pages/${made.id}`).body.last_edited_time;
  const tick = () => new Promise(resolve => setTimeout(resolve, 5));
  let before = edited(); await tick();
  call(fake, 'PATCH', `blocks/${made.id}/children`, {children: [bullet('Ticino')]});
  assert.ok(edited() > before, 'appending a block'); before = edited(); await tick();
  const [heading] = call(fake, 'GET', `blocks/${made.id}/children`).body.results;
  const [nested] = call(fake, 'GET', `blocks/${heading.id}/children`).body.results;
  call(fake, 'DELETE', `blocks/${nested.id}`);
  assert.ok(edited() > before, 'deleting a block two levels down'); before = edited(); await tick();
  call(fake, 'PATCH', `blocks/${heading.id}`, {heading_3: {rich_text: text('Kit 2')}});
  assert.ok(edited() > before, 'editing a block');
});

test('the stand-in has its own token, shaped like Notion\'s, and answers any other one with Notion\'s 401', async () => {
  const {startNotionFake} = await import('../lib/notion-fake.mjs');
  const fake = await startNotionFake();
  try {
    assert.match(fake.token, /^ntn_e2e_[0-9a-f]{36}$/);
    const ask = token => fetch(`${fake.url}/v1/users/me`, {headers: {authorization: `Bearer ${token}`}}).then(response => response.status);
    assert.deepEqual([await ask(fake.token), await ask('stand-in')], [200, 401]);
  } finally { await fake.close(); }
});

test('a date that is not ISO 8601 or a number that is not a number is refused before anything is written, as Notion does', () => {
  const fake = createNotionFake();
  const db = call(fake, 'POST', 'databases', {parent: {page_id: fake.root.id}, title: text('Runs'), properties: {Run: {title: {}}, Started: {date: {}}, 'Duration (s)': {number: {}}}}).body;
  const add = properties => call(fake, 'POST', 'pages', {parent: {database_id: db.id}, properties: {Run: {title: text('r')}, ...properties}});
  assert.equal(add({Started: {date: {start: '2026-10-09T16:27:10.816Z'}}, 'Duration (s)': {number: 12}}).status, 200);
  assert.equal(add({Started: {date: {start: '2026-10-09'}}, 'Duration (s)': {number: null}}).status, 200);
  const refused = add({Started: {date: {start: 1791559393371}}});
  assert.deepEqual([refused.status, refused.body.code], [400, 'validation_error']);
  assert.match(refused.body.message, /Started\.date\.start should be a valid ISO 8601/);
  assert.equal(add({'Duration (s)': {number: 'NaN'}}).status, 400);
  const row = add({}).body;
  assert.equal(call(fake, 'PATCH', `pages/${row.id}`, {properties: {Started: {date: {start: 'Invalid Date'}}}}).status, 400);
  assert.equal(call(fake, 'POST', `databases/${db.id}/query`, {}).body.results.length, 3, 'nothing was written by a refused request');
});

// 27 Oct 2026: focusdismiss is about Notion's lag after a write (a query lists a write late), but on the stand-in nothing lagged, so the three in-app hold
// mutants (#1907 #1908 #1909) survived every run. With a lag on, a query answers each row as it stood that long ago; a page read by its id is fresh at once.
test('a listing lag: a query sees each row as it stood that long ago, a page read by its id is fresh', () => {
  let t = 1_000_000;
  const fake = createNotionFake({clock: () => t});
  const db = call(fake, 'POST', 'databases', {parent: {page_id: fake.root.id}, title: text('T'), properties: {Name: {title: {}}, Stage: {select: {}}}}).body;
  const old = call(fake, 'POST', 'pages', {parent: {database_id: db.id}, properties: {Name: {title: text('old')}, Stage: {select: {name: 'Saved'}}}}).body;
  fake.setLag(10_000);
  const names = filter => call(fake, 'POST', `databases/${db.id}/query`, filter ? {filter} : {}).body.results.map(row => row.properties.Name.title[0].plain_text).sort();
  assert.deepEqual(names(), ['old'], 'a row from before the lag is listed as it is');
  const row = call(fake, 'POST', 'pages', {parent: {database_id: db.id}, properties: {Name: {title: text('new')}, Stage: {select: {name: 'Saved'}}}}).body;
  t += 1_000;
  assert.deepEqual(names(), ['old'], 'a row written a second ago is not listed yet');
  t += 10_000;
  assert.deepEqual(names(), ['new', 'old']);
  call(fake, 'PATCH', `pages/${row.id}`, {properties: {Stage: {select: {name: 'Done'}}}});
  call(fake, 'PATCH', `pages/${old.id}`, {archived: true});
  t += 1_000;
  assert.deepEqual(names({property: 'Stage', select: {equals: 'Saved'}}), ['new', 'old'], 'a change and an archive are listed late too');
  assert.equal(call(fake, 'GET', `pages/${row.id}`).body.properties.Stage.select.name, 'Done', 'a page read by its id is fresh');
  t += 10_000;
  assert.deepEqual(names({property: 'Stage', select: {equals: 'Saved'}}), []);
  assert.deepEqual(names(), ['new']);
  fake.setLag(0);
  call(fake, 'POST', 'pages', {parent: {database_id: db.id}, properties: {Name: {title: text('now')}}});
  assert.deepEqual(names(), ['new', 'now'], 'no lag: listed at once');
});
