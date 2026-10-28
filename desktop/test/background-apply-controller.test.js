// Full automation is not shipped in step A: the controller refuses to queue it, so no browser starts and nothing can reach a submit reservation.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyController} from '../lib/background-apply-controller.js';

const touched = [];
const spy = name => (...args) => { touched.push(name); return args; };
const make = (options = {}) => createBackgroundApplyController({}, {
  store: {queue: spy('store.queue')}, browser: {start: spy('browser.start')}, terminals: {list: () => [], byUrl: () => null, startForm: spy('terminals.startForm')},
  config: () => ({mode: 'auto', chosenAt: '2026-10-28T10:00:00Z'}), ...options});

test('Full automation cannot be queued before its gates ship: no store write, no browser, no session', async () => {
  const result = await make().enqueue([{url: 'https://jobs.example.test/a'}], 'auto');
  assert.equal(result.ok, false);
  assert.match(result.error, /Full automation is not available/);
  assert.deepEqual(touched, []);
});

test('Background automation without the downloaded browser refuses before any store write, session or launch', async () => {
  touched.length = 0;
  const result = await make({config: () => ({mode: 'fill', chosenAt: '2026-10-28T10:00:00Z'}), browser: {ready: () => false, start: spy('browser.start')}})
    .enqueue([{url: 'https://jobs.example.test/b'}], 'fill');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BACKGROUND_BROWSER_MISSING');
  assert.deepEqual(touched, []);
});

test('registering the apply handlers creates the controller without touching storage paths', () => {
  assert.doesNotThrow(() => createBackgroundApplyController({}, {store: {}}));   // CI #2324: a storage with no path() crashed handler registration
});

test('the live view reaches only a hidden-browser session\'s held tab, never a visible session or an unknown id', async () => {
  const records = {bg: {id: 'bg', background: {}}, visible: {id: 'visible'}}, asked = [];
  const controller = createBackgroundApplyController({}, {store: {}, terminals: {record: id => records[id] || null},
    browser: {pageSocket: async id => { asked.push(id); return `ws://127.0.0.1:9/devtools/page/${id}`; }}});
  assert.equal(await controller.page('bg'), 'ws://127.0.0.1:9/devtools/page/bg');
  assert.equal(await controller.page('visible'), null);
  assert.equal(await controller.page('nobody'), null);
  assert.deepEqual(asked, ['bg'], 'the browser is asked only for the hidden session');
});

test('the controller reads the notifier when it notifies, not when it is created', async () => {
  const hooks = await import('../lib/server-hooks.js');
  const record = {id: 's1', url: 'https://jobs.example.test/n', background: {}}, sent = [];
  const controller = createBackgroundApplyController({}, {   // the controller exists before main.js wires the notifier (bot review on #2324)
    store: {handoff: async () => ({mode: 'fill', state: 'needs_user_handoff', reason: 'stopped', session: 's1'})},
    browser: {start: async () => ({owner: 'o1'})}, terminals: {record: () => record, report: () => {}}, config: () => ({}), log: () => {}, token: () => 'fictional', port: 1});
  hooks.setNotifier((...args) => sent.push(args));
  try { await controller.handle({owner: 'o1', session: 's1', action: 'manual', reason: 'stopped'}); }
  finally { hooks.setNotifier(() => {}); }
  assert.equal(sent.length, 1);
});
