// Every Notion call waits and retries when Notion is busy (429) or briefly down (502/503/504): a busy moment once
// left a form without the owner's name, because the contact read failed on the first 429.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as notion from '../lib/notion.js';

test('a 429 is retried after Retry-After, then the answer is returned', async () => {
  const waits = [];
  notion.useSleep(async ms => { waits.push(ms); });
  let calls = 0;
  const fetcher = async () => (++calls < 3
    ? {ok: false, status: 429, headers: {get: name => (name === 'retry-after' ? '2' : null)}, json: async () => ({message: 'rate limited'})}
    : {ok: true, status: 200, json: async () => ({results: ['ok']})});
  assert.deepEqual(await notion.call('t', 'GET', 'blocks/x/children', null, fetcher), {results: ['ok']});
  assert.deepEqual(waits, [2000, 2000]);
});

test('without Retry-After it backs off; it gives up after its retries; other errors fail at once', async () => {
  const waits = [];
  notion.useSleep(async ms => { waits.push(ms); });
  const busy = async () => ({ok: false, status: 503, json: async () => ({})});
  await assert.rejects(notion.call('t', 'GET', 'pages/x', null, busy), error => error.status === 503);
  assert.deepEqual(waits, [500, 1000, 2000, 4000]);
  waits.length = 0;
  const missing = async () => ({ok: false, status: 404, json: async () => ({message: 'Could not find page'})});
  await assert.rejects(notion.call('t', 'GET', 'pages/x', null, missing), /Could not find page/);
  assert.deepEqual(waits, []);
  await assert.rejects(notion.call('t', 'GET', 'pages/x', null, busy, {retries: 0}), error => error.status === 503);
  assert.deepEqual(waits, []);
});

test('one pace for the whole app: calls take turns ~340 ms apart, and a 429 makes every call wait it out', async () => {
  const token = `pace-test-${process.pid}-${Date.now()}`;  // its own pace file: other test files run at the same time
  notion._pace.reset(token);
  const waits = [];
  let now = 1_000_000;  // a fake clock: sleeping moves it on, nothing depends on the machine's speed
  notion.useClock(() => now);
  notion.useSleep(async ms => { waits.push(ms); now += ms; });
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    if (calls === 2) return {ok: false, status: 429, headers: {get: () => '2'}, json: async () => ({})};
    return {ok: true, status: 200, json: async () => ({ok: true})};
  };
  await Promise.all([notion.call(token, 'GET', 'a', null, fetcher, {pace: true}), notion.call(token, 'GET', 'b', null, fetcher, {pace: true})]);
  assert.ok(waits.includes(340), `the second call waited exactly its turn: ${waits}`);
  assert.ok(notion._pace.state().calmUntil >= 1_000_000 + 2000, 'after the 429 the whole app pauses 2 s');
  notion.useClock(null);
  notion._pace.reset(token);
});

test('the local e2e HTTP stand-in answers a burst without real Notion pacing', async t => {
  const names = ['JOB_PILOTTO_E2E', 'JOB_PILOTTO_E2E_NOTION_BASE_URL', 'JOB_PILOTTO_E2E_NOTION_STANDIN'];
  const previous = names.map(name => process.env[name]);
  process.env.JOB_PILOTTO_E2E = '1';
  process.env.JOB_PILOTTO_E2E_NOTION_BASE_URL = 'http://127.0.0.1:12345';
  process.env.JOB_PILOTTO_E2E_NOTION_STANDIN = '1';
  t.after(() => {
    for (const [index, name] of names.entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  });
  const requested = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requested.push(url);
    return {ok: true, status: 200, json: async () => ({results: []})};
  });
  const client = await import('../lib/notion-core.js?local-standin');
  const token = `standin-test-${process.pid}-${Date.now()}`, waits = [];
  let now = 1_000_000;
  client.useClock(() => now);
  client.useSleep(async ms => { waits.push(ms); now += ms; });
  t.after(() => client._pace.reset(token));
  for (let n = 0; n < 20; n++) assert.deepEqual(await client.call(token, 'GET', 'pages/fixture'), {results: []});
  assert.deepEqual(requested, Array(20).fill('http://127.0.0.1:12345/v1/pages/fixture'));
  assert.deepEqual(waits, [], 'the stand-in must not waste about 340 ms wall clock per request');
});

test('the shared stand-in pacer ignores slot and 429 clocks, with or without a loopback port', async t => {
  const names = ['JOB_PILOTTO_E2E', 'JOB_PILOTTO_E2E_NOTION_BASE_URL', 'JOB_PILOTTO_E2E_NOTION_STANDIN'];
  const previous = names.map(name => process.env[name]);
  t.after(() => {
    for (const [index, name] of names.entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  });
  const pace = await import('../lib/notion-pace.js');
  for (const base of ['http://127.0.0.1', 'http://127.0.0.1:12345']) {
    Object.assign(process.env, {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_NOTION_BASE_URL: base, JOB_PILOTTO_E2E_NOTION_STANDIN: '1'});
    const token = `standin-shared-${process.pid}-${encodeURIComponent(base)}`;
    t.after(() => notion._pace.reset(token));
    await pace.calmUntil(token, 1_005_000);
    for (let n = 0; n < 20; n++) assert.equal(await pace.claim(token, () => 1_000_000), 1_000_000);
  }
});

test('a stand-in 429 keeps its retry backoff without recording shared cool-down state', async t => {
  const names = ['JOB_PILOTTO_E2E', 'JOB_PILOTTO_E2E_NOTION_BASE_URL', 'JOB_PILOTTO_E2E_NOTION_STANDIN'];
  const previous = names.map(name => process.env[name]);
  Object.assign(process.env, {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_NOTION_BASE_URL: 'http://127.0.0.1:12345', JOB_PILOTTO_E2E_NOTION_STANDIN: '1'});
  t.after(() => {
    for (const [index, name] of names.entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  });
  let calls = 0, now = 1_000_000;
  const waits = [];
  t.mock.method(globalThis, 'fetch', async () => (++calls === 1
    ? {ok: false, status: 429, headers: {get: () => '2'}, json: async () => ({})}
    : {ok: true, status: 200, json: async () => ({ok: true})}));
  const client = await import('../lib/notion-core.js?standin-calm');
  const token = `standin-calm-${process.pid}`;
  client.useClock(() => now);
  client.useSleep(async ms => { waits.push(ms); now += ms; });
  t.after(() => client._pace.reset(token));
  assert.deepEqual(await client.call(token, 'GET', 'pages/fixture'), {ok: true});
  assert.deepEqual(waits, [2000]);
  assert.equal(client._pace.state().calmUntil, 0);
});

for (const [title, e2e, standin, base, expected] of [
  ['a local fault proxy', '1', '', 'http://127.0.0.1:12345', 'http://127.0.0.1:12345/v1/'],
  ['a marker outside e2e', '', '1', 'http://127.0.0.1:12345', 'https://api.notion.com/v1/'],
  ['a marker on the real API', '1', '1', 'https://api.notion.com', 'https://api.notion.com/v1/'],
]) test(`${title} still takes real Notion turns`, async t => {
  const names = ['JOB_PILOTTO_E2E', 'JOB_PILOTTO_E2E_NOTION_BASE_URL', 'JOB_PILOTTO_E2E_NOTION_STANDIN'];
  const previous = names.map(name => process.env[name]);
  for (const [index, value] of [e2e, base, standin].entries()) process.env[names[index]] = value;
  t.after(() => {
    for (const [index, name] of names.entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  });
  const requested = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requested.push(url);
    return {ok: true, status: 200, json: async () => ({ok: true})};
  });
  const client = await import(`../lib/notion-core.js?pace-control=${encodeURIComponent(title)}`);
  const token = `standin-control-${process.pid}-${title}`, waits = [];
  let now = 1_000_000;
  client.useClock(() => now);
  client.useSleep(async ms => { waits.push(ms); now += ms; });
  t.after(() => client._pace.reset(token));
  for (let n = 0; n < 2; n++) assert.deepEqual(await client.call(token, 'GET', 'pages/fixture'), {ok: true});
  assert.deepEqual(requested, Array(2).fill(expected + 'pages/fixture'));
  assert.deepEqual(waits, [340]);
});
