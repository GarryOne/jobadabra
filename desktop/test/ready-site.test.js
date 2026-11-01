// Ready to send, the app's calls to the site (lib/ready-site.js) and the window's handlers (lib/ready-handlers.js): the card shows only for the owner, a send reaches /api/ready/batch with the install key, and nothing else is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {done, link, owner, ownerSecret, runNow, send, status, useKeychainReader, video} from '../lib/ready-site.js';
import {setSiteOff} from '../lib/recipes.js';
import {call as hostedCall} from '../lib/hosted-search.js';
import {DEV_BUILD} from '../lib/telemetry.js';
import {registerReadyHandlers} from '../lib/ready-handlers.js';
import {ownKeyFor, withOwnAi} from '../lib/ready-batch.js';
import {NAMES} from '../lib/ai/index.js';
import {rowOf, waitingOf} from '../renderer/pages/ready-rows.js';

useKeychainReader(() => null);   // no test reads this Mac's Keychain
const storage = (extra = {}) => ({secret: name => (name === 'JOBADABRA_TRIAL_KEY' || /TRIAL/.test(name) ? 'JPF1.install.token' : ''), settings: () => extra, saveSettings: patch => Object.assign(extra, patch), path: name => `/nowhere/${name}`});
const site = (status = 200, body = {ok: true}) => { const seen = []; return {seen, fetcher: async (url, init) => { seen.push({url, init}); return new Response(JSON.stringify(body), {status}); }}; };

test('the owner is whoever the site says yes to; 401 and 404 are no', async () => {
  assert.equal(await owner(storage(), {fetcher: site().fetcher}), true);
  assert.equal(await owner(storage(), {fetcher: site(401, {ok: false}).fetcher}), false);
  assert.equal(await owner(storage(), {fetcher: site(404, {}).fetcher}), false);
});

test('send, run and done reach their routes with the install key, and a refusal reads plainly', async () => {
  const fake = site(200, {ok: true, queued: 2});
  assert.equal((await send(storage(), {night: '2026-10-18', jobs: []}, {fetcher: fake.fetcher})).queued, 2);
  await runNow(storage(), {fetcher: fake.fetcher}); await done(storage(), 'j1', {fetcher: fake.fetcher});
  assert.deepEqual(fake.seen.map(s => new URL(s.url).pathname), ['/api/ready/batch', '/api/ready/run', '/api/ready/done']);
  assert.ok(fake.seen.every(s => s.init.headers['x-api-key'] === 'JPF1.install.token'));
  assert.equal(JSON.parse(fake.seen[2].init.body).job, 'j1');
  assert.match((await runNow(storage(), {fetcher: site(401, {ok: false}).fetcher})).error, /not on for this install/);
});

test('the window\'s handlers: not the owner = a closed card; the two numbers are kept in range', async () => {
  const handlers = {}, ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  const kept = {};
  const realFetch = globalThis.fetch; globalThis.fetch = async () => new Response('{}', {status: 401});
  try {
    registerReadyHandlers({ipcMain, storage: storage(kept)});
    const closed = await handlers.readyState();
    assert.equal(closed.owner, false); assert.match(closed.why, /owner's install/);   // the card shows this reason, its buttons off
    assert.deepEqual((await handlers.readySettings({}, {minFit: 500, perNight: 99})).settings, {on: false, told: '', minFit: 100, perNight: 15});
  } finally { globalThis.fetch = realFetch; }
  for (const name of ['readyState', 'readySend', 'readyRun', 'readyDone', 'readyDeleteAll', 'readySettings']) assert.ok(handlers[name], name);
});

test('a row says what the site counted: complete, what is left, a wall', () => {
  assert.deepEqual(rowOf({state: 'prepared'}), {text: 'complete', tone: 'good', done: false, submitted: false});
  assert.equal(rowOf({state: 'partial', left_empty: 2}).text, 'needs you · 2 left');
  assert.equal(rowOf({state: 'wall', wall: 'account'}).text, 'a wall · account');
  assert.equal(rowOf({state: 'something-new'}).tone, 'info');
});

test('the morning line counts forms filled and not yet submitted or deleted, and those that still need you', () => {
  assert.equal(waitingOf([]), null);
  assert.equal(waitingOf([{state: 'wall'}, {state: 'failed'}, {state: 'prepared', cleared_at: 'x'}, {state: 'prepared', submitted_at: 'x'}]), null);
  assert.deepEqual(waitingOf([{state: 'prepared'}, {state: 'partial'}, {state: 'partial'}, {state: 'wall'}]), {ready: 3, left: 2});
});

test('Open live asks the site for a link and opens it in the browser, never inside the app', async () => {
  const handlers = {}, opened = [];
  const ipcMain = {handle: (name, fn) => { handlers[name] = fn; }}, shell = {openExternal: async url => { opened.push(url); }};
  const realFetch = globalThis.fetch; globalThis.fetch = async () => new Response(JSON.stringify({ok: true, url: 'https://www.jobpilotto.top/ready-live?job=j1&k=1.2'}), {status: 200});
  try {
    registerReadyHandlers({ipcMain, shell, storage: storage()});
    assert.deepEqual(await handlers.readyLive({}, 'j1'), {ok: true});
    globalThis.fetch = async () => new Response('{}', {status: 401});
    assert.equal((await handlers.readyLive({}, 'j1')).ok, false);
  } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(opened, ['https://www.jobpilotto.top/ready-live?job=j1&k=1.2']);
  assert.equal((await link(storage(), 'j1', {fetcher: async () => new Response(JSON.stringify({ok: true, url: 'u'}), {status: 200})})).url, 'u');
});

test('an install on its own engine (no JPF1 key) mints its token from the install id, once, and does not save it as its AI key', async () => {
  const saved = {telemetryId: 'install-on-cli'}, minted = [], seen = [];
  const bare = {secret: () => '', settings: () => saved, saveSettings: patch => Object.assign(saved, patch), path: name => `/nowhere/${name}`};
  const fetcher = async (url, init) => {
    if (String(url).endsWith('/api/install-token')) { minted.push(JSON.parse(init.body)); return new Response(JSON.stringify({token: 'tok123'}), {status: 200}); }
    seen.push(init.headers['x-api-key']); return new Response('{}', {status: 200});
  };
  assert.equal(await owner(bare, {fetcher}), true);
  await runNow(bare, {fetcher});
  assert.deepEqual(minted, [{install: 'install-on-cli', purpose: 'ai'}]);   // one mint for two calls
  assert.deepEqual(seen, ['JPF1.install-on-cli.tok123', 'JPF1.install-on-cli.tok123']);
  assert.equal(saved.aiEngine, undefined);   // the engine did not change
  assert.equal(await owner({...bare, settings: () => ({telemetryId: 'offline-install'})}, {fetcher: async () => { throw new Error('offline'); }}), false);
});

test('Fill tonight carries his own Claude key only when he has one, else the batch has none (Free AI)', () => {
  const batch = {night: '2026-10-18', jobs: []};
  assert.deepEqual(withOwnAi(batch, 'sk-ant-api03-mine'), {...batch, ai: {key: 'sk-ant-api03-mine'}});
  for (const other of ['JPF1.i.t', '', undefined, 'sk-openai-x']) assert.deepEqual(withOwnAi(batch, other), batch);
});

test('every call carries the owner secret from the app\'s store or the Keychain item, and never the install id', async () => {
  const fake = site(), has = {...storage(), secret: name => (name === 'READY_OWNER_SECRET' ? 'from-store' : 'JPF1.install.token')};
  await runNow(has, {fetcher: fake.fetcher});
  assert.equal(fake.seen[0].init.headers['x-ready-owner'], 'from-store');
  const asked = []; useKeychainReader(service => { asked.push(service); return 'from-keychain'; });
  try { assert.equal(ownerSecret(storage()), 'from-keychain'); assert.deepEqual(asked, ['job-pilotto.ready.owner_secret']); assert.equal(ownerSecret(has), 'from-store'); }
  finally { useKeychainReader(() => null); }
  assert.equal(ownerSecret(storage()), '');
});

test('the card never says "send" for what is only a fill on the server, and says nothing is submitted (owner, 17 Oct 2026)', async () => {
  const {readFileSync} = await import('node:fs');
  const card = readFileSync(new URL('../renderer/pages/ready-card.js', import.meta.url), 'utf8');
  assert.ok(!/'Send tonight'|'Run now'|Sending tonight/.test(card));
  for (const label of ['Fill tonight on the server', 'Fill now', 'nothing is submitted', 'not submitted']) assert.ok(card.includes(label), label);
});

test('a failed row says why when the night gave a reason, and never a bare internal word', () => {
  assert.deepEqual(rowOf({state: 'failed', wall: 'the night could not start'}), {text: 'could not fill · the night could not start', tone: 'bad', done: false, submitted: false});
  assert.equal(rowOf({state: 'failed', wall: 'error'}).text, 'could not fill');
  assert.equal(rowOf({state: 'wall', wall: 'captcha'}).text, 'a wall · captcha');
});

test('every reason the card cannot work is said in plain words, never hidden (owner, 18 Oct 2026: "show the card always")', async () => {
  useKeychainReader(() => null);
  const now = () => Date.parse('2026-10-18T01:00:00Z');
  const owned = (settings = {}, key = 'JPF1.install.token') => ({secret: name => (name === 'READY_OWNER_SECRET' ? 'owner-secret' : /TRIAL/.test(name) ? key : ''), settings: () => settings, saveSettings: patch => Object.assign(settings, patch), path: name => `/nowhere/${name}`});
  const offline = async () => { throw new Error('offline'); };
  const cases = [
    ['no owner key on this Mac', storage(), site().fetcher, /owner's install/],
    ['the site gave no token today', owned({telemetryId: 'i-1', siteTokenWait: {ai: Date.parse('2026-10-19T00:00:00Z')}}, ''), site().fetcher, /no token today.*asked again at/],
    ['no token: offline', owned({telemetryId: 'i-1'}, ''), offline, /token from our site/],
    ['the site does not know the owner (401)', owned(), site(401, {ok: false}).fetcher, /does not know this install/],
    ['the site does not know the owner (404)', owned(), site(404, {}).fetcher, /does not know this install/],
    ['the site is down (500)', owned(), site(500, {error: 'boom'}).fetcher, /did not answer \(500\): boom/],
    ['the site cannot be reached', owned(), offline, /did not answer.*connection/],
  ];
  for (const [name, store, fetcher, says] of cases) {
    const result = await status(store, {fetcher, now});
    assert.equal(result.ok, false, name);
    assert.match(result.why, says, name);
    assert.ok(!/undefined|null|\[object/.test(result.why), `${name}: ${result.why}`);
  }
  assert.deepEqual(await status(owned(), {fetcher: site(200, {ok: true, jobs: []}).fetcher, now}), {ok: true, jobs: []});
});

test('the night carries the stored Claude key only when the API key is the engine in use; every other engine leaves it home (18 Oct 2026)', () => {
  const keys = {ANTHROPIC_API_KEY: 'sk-ant-api03-old', OPENAI_API_KEY: 'sk-openai-x'};
  for (const engine of NAMES) assert.equal(ownKeyFor({aiEngine: engine}, keys), engine === 'api' ? 'sk-ant-api03-old' : '', engine);
  assert.equal(ownKeyFor({}, keys), 'sk-ant-api03-old');   // an install from before the engine choice, with a key: it runs on the key
  assert.equal(ownKeyFor({}, {}), '');
  assert.deepEqual(withOwnAi({jobs: []}, ownKeyFor({aiEngine: 'cli'}, keys)), {jobs: []});   // the first night's case: Claude Code + an old key -> Free AI
});

test('the owner\'s app run from source reaches the site for Ready to send; a test, CI or smoke run never does, and so does Always on (21 Oct 2026: one rule, recipes.js siteOffForUser)', async () => {
  const owned = {secret: name => (name === 'READY_OWNER_SECRET' ? 'owner-secret' : /TRIAL/.test(name) ? 'JPF1.install.token' : ''), settings: () => ({}), saveSettings() {}, path: name => `/nowhere/${name}`};
  try {
    setSiteOff(DEV_BUILD);
    const fake = site(200, {ok: true, jobs: []});
    assert.deepEqual(await status(owned, {fetcher: fake.fetcher}), {ok: true, jobs: []});
    await runNow(owned, {fetcher: fake.fetcher});
    assert.deepEqual(fake.seen.map(s => new URL(s.url).pathname), ['/api/ready/state', '/api/ready/run']);
    const always = site(200, {ok: true});
    assert.equal((await hostedCall(owned, '/api/hosted/state', {fetcher: always.fetcher})).ok, true);   // Always on: a person presses it, so a development build may too
    assert.equal(always.seen.length, 1);
    for (const run of ['CI', 'a smoke test', 'the end-to-end journey']) {
      setSiteOff(run);
      const none = site();
      const result = await status(owned, {fetcher: none.fetcher});
      assert.equal(result.ok, false, run); assert.match(result.why, new RegExp(`Not in ${run}`)); assert.equal(none.seen.length, 0, run);
    }
  } finally { setSiteOff(''); }
});

test('Watch the fill: the night\'s video of a form comes back as bytes, with the install key and the owner secret; a missing one reads plainly', async () => {
  const seen = [], bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
  const fetcher = async (url, init) => { seen.push({url, init}); return new Response(bytes, {status: 200, headers: {'content-type': 'video/webm'}}); };
  const got = await video({...storage(), secret: name => (name === 'READY_OWNER_SECRET' ? 'owner-secret' : 'JPF1.install.token')}, 'j 1', {fetcher});
  assert.deepEqual([...got.bytes], [...bytes]);
  assert.equal(new URL(seen[0].url).pathname + new URL(seen[0].url).search, '/api/ready/video?job=j%201');
  assert.deepEqual([seen[0].init.headers['x-api-key'], seen[0].init.headers['x-ready-owner']], ['JPF1.install.token', 'owner-secret']);
  assert.match((await video(storage(), 'j1', {fetcher: async () => new Response('{}', {status: 404})})).error, /No video was kept/);
  assert.match((await video(storage(), 'j1', {fetcher: async () => { throw new Error('offline'); }})).error, /Could not reach/);
});

// Open in my browser when the server no longer holds the form (18 Oct 2026: the owner's app said "Ready to send is not on for this install." after a deploy dropped the held tabs):
// the line says what happened and what to do, for every way the site says it: the container's 410 "gone", the site's 404 "nothing held", the container's 404 "not held".
test('a form the server no longer holds reads as "press Fill now", never "not on for this install"', async () => {
  const {handoff, GONE_LINE} = await import('../lib/ready-site.js');
  assert.match(GONE_LINE, /no longer holds this filled form/);
  assert.match(GONE_LINE, /Fill now/);
  for (const [status, body] of [[410, {ok: false, error: 'gone: this container holds no night'}], [404, {ok: false, error: 'nothing held for this job'}], [404, {ok: false, error: 'not held'}]]) {
    const result = await handoff(storage(), 'j1', {fetcher: site(status, body).fetcher});
    assert.equal(result.error, GONE_LINE, `${status} ${body.error}`);
  }
  assert.match((await handoff(storage(), 'j1', {fetcher: site(401, {ok: false}).fetcher})).error, /not on for this install/, 'a refused owner still reads as before');
  assert.equal((await handoff(storage(), 'j1', {fetcher: site(200, {ok: true, url: 'https://boards.example.com/apply'}).fetcher})).url, 'https://boards.example.com/apply');
});

// 18 Oct 2026: Fill now with nothing sent showed "Ready to send is not on for this install." (the site's 404 "no queued night to run"). Only a refused owner reads that line:
// a 401, or a 404 with no reason of Ready to send's own (the route is off). Every reason the site gives is said as that reason, in plain words.
test('only a refused owner reads "not on for this install"; the site\'s own reasons are said as themselves', async () => {
  const {runNow: run, NOT_ON} = await import('../lib/ready-site.js');
  const said = async (status, body) => (await run(storage(), {fetcher: async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status})})).error;
  assert.equal(await said(401, {ok: false, error: 'unauthorized'}), NOT_ON);
  assert.equal(await said(404, 'Not found'), NOT_ON, 'the route is off: plain text, no reason');
  assert.match(await said(404, {ok: false, error: 'no queued night to run'}), /Nothing was sent for tonight/);
  assert.match(await said(409, {ok: false, error: 'already started'}), /already started/i);
  assert.doesNotMatch(await said(404, {ok: false, error: 'no queued night to run'}), /not on for this install/);
});
