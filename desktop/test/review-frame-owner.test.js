// Empty child-frame polls cannot erase Applying state; real framed forms keep reporting.
import assert from 'node:assert/strict';
import {test} from 'node:test';

const MAIN = 'https://jobs.example.test/apply', CHILD = 'https://widget.example.test/check';
const store = {'session:81': 'form-1', 'role:81': {role: 'form', page: MAIN}};
const local = {workerUrl: 'http://127.0.0.1:12345', token: 'fixture'};
globalThis.chrome = {
  runtime: {onMessage: {addListener() {}}, getManifest: () => ({version: 'test'})},
  storage: {
    session: {get: async keys => keys == null ? {...store} : Object.fromEntries([].concat(keys).filter(key => key in store).map(key => [key, store[key]])),
      set: async values => Object.assign(store, values), remove: async () => {}},
    local: {get: async () => ({...local}), set: async () => {}},
  },
};
const review = await import('../lib/review.js');
const {createAppMessages} = await import('../../extension/messages-app.js');
const sessions = [{id: 'form-1', kind: 'form', url: MAIN}];
let reports = [];
globalThis.fetch = async (url, init) => {
  const route = new URL(url).pathname;
  if (route === '/extension/log') return Response.json({ok: true});
  assert.equal(route, '/extension/review', 'no AI, live app, account, or other network route');
  const payload = JSON.parse(init.body); reports.push(payload);
  return Response.json(review.report(sessions, payload));
};
const message = (page = 'form', url = MAIN, total = 10) => ({type: 'review', payload: {page, url, total, left: Math.min(6, total), watch: []}});
const sender = (frameId, url = MAIN) => ({frameId, documentId: `document-${frameId}`, tab: {id: 81, url}});
const relay = handler => (value, source) => new Promise(resolve => handler(value, source, resolve));

test('form → helper-frame reading → form → helper-frame reading never flips Applying state or tab URL', async () => {
  review._reset(); reports = [];
  const send = relay(createAppMessages({bootId: async () => 'fixture-boot', jobOf: async () => MAIN}));
  const snapshots = [];
  for (const [value, source] of [[message(), sender(0)], [message('reading', CHILD, 0), sender(9)],
    [message(), sender(0)], [message('reading', CHILD, 0), sender(12)]]) {
    await send(value, source);
    const state = review.allStates()[0];
    snapshots.push({url: state.url, total: state.total, left: state.left, page: state.page});
  }
  assert.deepEqual(snapshots, Array.from({length: 4}, () => ({url: MAIN, total: 10, left: 6, page: undefined})));
  assert.equal(reports.length, 2, 'only top-document reports reach the app');
});

test('actual embedded form reports keep their session replies, watches and commands', async () => {
  review._reset(); reports = [];
  const send = relay(createAppMessages({bootId: async () => 'fixture-boot', jobOf: async () => MAIN}));
  await send(message(), sender(0));
  review.setWatch('form-1', [{id: 'w1', label: 'A required field'}]);
  review.queueFocus('form-1', 'A required field');
  const child = await send(message('form', CHILD, 3), sender(4));
  assert.equal(child.matched, 'form-1');
  assert.equal(child.watch[0].id, 'w1');
  assert.deepEqual(child.commands, [{focus: 'A required field'}]);
  assert.equal(review.allStates()[0].total, 3, 'a child application still reports its fields');
  const embedded = 'https://embedded.example.test/form';
  await send(message('form', embedded, 8), sender(0, embedded));
  assert.equal(review.allStates()[0].url, embedded, 'the existing AI-selected form-frame navigation remains reportable');
  assert.equal(review.allStates()[0].total, 8);
});


test('the top document may still clear progress when it really starts reading a new page, and account frames still relay', async () => {
  review._reset(); reports = [];
  const send = relay(createAppMessages({bootId: async () => 'fixture-boot', jobOf: async () => MAIN}));
  await send(message(), sender(0));
  await send(message('reading', MAIN, 0), sender(0));
  assert.equal(review.allStates()[0].page, 'reading');
  assert.equal(review.allStates()[0].total, 0, 'no sticky form counts across a real top-document reading');
  const account = message('account', CHILD, 0);
  account.payload.account = true;
  const result = await send(account, sender(7));
  assert.equal(result.matched, 'form-1', 'a zero-required-field account frame still gets the normal reply');
  assert.equal(reports.at(-1).account, true);
});
