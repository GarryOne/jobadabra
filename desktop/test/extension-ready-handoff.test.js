// "Open in my browser" in the extension (extension/ready-handoff.js): a marked tab asks the app once while it first loads; with a hand-off its
// cookies are set and the tab goes on to the night's page with the same fill mark; when that page is loaded the night's values come back once,
// then the normal fill runs. Each state, and the page side on a small fake page (never a password, a file, a hidden field, or over a value).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createReadyHandoff, restoreInPage} from '../../extension/ready-handoff.js';

const HANDOFF = {url: 'https://job-boards.greenhouse.io/acme/jobs/1#x', cookies: [{url: 'https://job-boards.greenhouse.io/', name: 'gh', value: 'a'}, {url: 'https://job-boards.greenhouse.io/', name: 'bad', value: 'b'}],
  localStorage: {draft: '1'}, sessionStorage: {}, snapshot: {fields: [{id: 'first_name', type: 'text', value: 'Ada'}], files: []}};
const MARKED = 'https://job-boards.greenhouse.io/acme/jobs/1?gh_src=x#jobpilotto-fill=s1';

function world(answer, granted = true) {
  const session = {}, cookies = [], updates = [], scripts = [], asks = [];
  const chrome = {
    storage: {session: {set: async items => Object.assign(session, items)}},
    permissions: {contains: async () => granted},
    cookies: {set: async cookie => (cookie.name === 'bad' ? null : (cookies.push(cookie), cookie))},
    scripting: {executeScript: async ({func, args}) => { scripts.push(args[0]); return [{result: 1}]; }},
  };
  const api = async (path, init) => { asks.push([path, JSON.parse(init.body).url]); return answer; };
  const sessionGet = async name => ({[name]: session[name]});
  const move = async (tabId, url) => { updates.push([tabId, url]); };
  return {flow: createReadyHandoff({chrome, api, sessionGet, move}), session, cookies, updates, scripts, asks};
}

test('no hand-off for this tab: asked once, nothing changes, the normal fill goes on', async () => {
  const w = world({ok: true, handoff: null});
  assert.equal(await w.flow.takeHandoff(7, MARKED, 'complete'), false, 'only while loading');
  assert.equal(await w.flow.takeHandoff(7, MARKED, 'loading'), false);
  assert.equal(await w.flow.takeHandoff(7, MARKED, 'loading'), false);
  assert.deepEqual(w.asks, [['/extension/ready-handoff', MARKED]], 'asked once');
  assert.equal(await w.flow.restoreHandoff(7), 0);
  assert.deepEqual([w.updates, w.scripts], [[], []]);
});

test('the app is not there: no hand-off, the tab is left alone', async () => {
  const w = world(null);
  w.flow = createReadyHandoff({chrome: {storage: {session: {set: async items => Object.assign(w.session, items)}}}, api: async () => { throw new Error('no app'); },
    sessionGet: async name => ({[name]: w.session[name]})});
  assert.equal(await w.flow.takeHandoff(7, MARKED, 'loading'), false);
});

test('a hand-off: its cookies set, the night\'s page loaded with the same mark, the values back once when it is loaded', async () => {
  const w = world({ok: true, handoff: HANDOFF});
  assert.equal(await w.flow.takeHandoff(7, MARKED, 'loading'), true);
  assert.deepEqual(w.cookies.map(c => c.name), ['gh'], 'a cookie Chrome refuses is skipped');
  assert.deepEqual(w.updates, [[7, 'https://job-boards.greenhouse.io/acme/jobs/1#jobpilotto-fill=s1']], 'the fill mark (the app\'s session) goes with it');
  assert.equal(await w.flow.takeHandoff(7, 'https://job-boards.greenhouse.io/acme/jobs/1#jobpilotto-fill=s1', 'loading'), false, 'the second load is not asked again');
  assert.equal(await w.flow.restoreHandoff(7), 1);
  assert.equal(w.scripts[0].snapshot.fields[0].value, 'Ada');
  assert.equal(await w.flow.restoreHandoff(7), 0, 'once');
});

test('cookies not granted (optional permission): the page still moves on, no cookie is set', async () => {
  const w = world({ok: true, handoff: HANDOFF}, false);
  assert.equal(await w.flow.takeHandoff(7, MARKED, 'loading'), true);
  assert.deepEqual(w.cookies, []);
  assert.equal(w.updates.length, 1);
});

test('the first page finishes loading while the app still answers: that load waits and stops when the tab moved on (no fill of the first page); the night\'s page is never held', async () => {
  let release;
  const w = world(null);
  w.flow = createReadyHandoff({chrome: {storage: {session: {set: async items => Object.assign(w.session, items)}}, permissions: {contains: async () => true}, cookies: {set: async c => c}},
    api: () => new Promise(done => { release = () => done({ok: true, handoff: HANDOFF}); }), sessionGet: async name => ({[name]: w.session[name]}),
    move: async (tabId, url) => { w.updates.push([tabId, url]); }});
  const loading = w.flow.takeHandoff(7, MARKED, 'loading');
  const complete = w.flow.takeHandoff(7, MARKED, 'complete');
  const night = 'https://job-boards.greenhouse.io/acme/jobs/1#jobpilotto-fill=s1';
  assert.equal(await w.flow.takeHandoff(7, night, 'complete'), false, 'another address is not held');
  await new Promise(done => setTimeout(done, 5)); release();
  assert.deepEqual([await loading, await complete], [true, true], 'the first page\'s complete stops too: the fill waits for the night\'s page');
  assert.equal(await w.flow.takeHandoff(7, night, 'complete'), false, 'the night\'s page then fills');
});

function page(nodes) {
  const store = () => { const data = {}; return {getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, data}; };
  const events = [];
  for (const node of nodes) node.dispatchEvent = event => events.push([node.id || node.name, event.type]);
  const marks = {};
  globalThis.document = {getElementById: id => nodes.find(n => n.id === id) || null, getElementsByName: name => nodes.filter(n => n.name === name),
    documentElement: {setAttribute: (k, v) => { marks[k] = v; }, getAttribute: k => marks[k] ?? null}, marks};
  globalThis.localStorage = store(); globalThis.sessionStorage = store();
  globalThis.Event = class { constructor(type) { this.type = type; } };
  return events;
}

test('the page side puts back only the storage and marks the night\'s page: no field value is written (the page clears them; the fill types the night\'s answers)', () => {
  const nodes = [{id: 'first_name', type: 'text', value: ''}, {id: 'consent', type: 'checkbox', checked: false}];
  const events = page(nodes);
  globalThis.localStorage.setItem('kept', 'mine');
  const restored = restoreInPage({localStorage: {draft: '1', kept: 'night'}, sessionStorage: {step: '2'}, fromNight: true, snapshot: {fields: [
    {id: 'first_name', type: 'text', value: 'Ada'}, {id: 'consent', type: 'checkbox', value: true}]}});
  assert.equal(restored, 2, 'two storage items');
  assert.equal(nodes[0].value, '', 'no field value is written into the page'); assert.equal(nodes[1].checked, false);
  assert.deepEqual(events, [], 'no input or change event');
  assert.deepEqual(globalThis.localStorage.data, {kept: 'mine', draft: '1'}, 'storage added, never overwritten');
  assert.equal(globalThis.sessionStorage.data.step, '2');
  assert.equal(globalThis.document.marks['data-jobpilotto-night'], '1', 'the panel says "Last night\'s fill is back" (review.js)');
  page([]); restoreInPage({localStorage: {}, snapshot: {fields: []}});
  assert.equal(globalThis.document.marks['data-jobpilotto-night'], undefined, 'a hand-off not from a night leaves the page unmarked');
});
