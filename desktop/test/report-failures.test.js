// Owner, 19 Oct 2026: Report said "Jobadabra could not prepare this report. Is the app open?" on a Doctolib form with the app open and connected. Cause found by a recording (fake applicant, no live site): one request whose
// path held a malformed percent escape ("/p/100%/x") made the scrub throw, the route answered 500, and the worker turned every failed call into the one sentence "Is the app open?". Guards: the scrub never throws on
// a URL; a throw in the route is an answer ("failed"), not a silence; the worker names each way a call can fail; the panel has one true, different sentence for every kind (and only "app" asks if the app is open).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {after, test} from 'node:test';
import {prepare} from '../lib/report-form.js';
import {registerReportHandlers} from '../lib/report-handlers.js';
import {visitMore} from '../lib/server-hooks.js';

const TAB = 7, URL_A = 'https://jobs.example.test/apply#jobpilotto-fill';
const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const entry = url => ({method: 'GET', url, type: 'xhr', mode: 'cors', startMs: 0, waitMs: 5, bodyKey: '', status: 200, failed: false, headers: {'content-type': 'application/json'}, hadCookie: false, body: Buffer.from('{}').toString('base64'), size: 2});

test('the scrub never throws on an address: a malformed percent escape in a path, an odd host', () => {
  for (const url of ['https://a.test/p/100%/x', 'https://a.test/%E0%A4%A', 'https://a.test/x?q=%zz', 'https://a.test/%', 'http://exa mple.test/a', 'http://[::1/x']) {
    let result; assert.doesNotThrow(() => { result = prepare({entries: [entry(url), entry('https://a.test/fine')]}); }, url);
    assert.equal(result.ok, true, url);
    assert.ok(result.preview.responses >= 1, `${url}: the other requests are kept`);
  }
});

test('a throw while preparing is an answer the panel can name ("failed"), logged without a value', async () => {
  const handlers = {};
  registerReportHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}, uploader: {send: async () => ({ok: true}), count: () => 0, deleteAll: async () => ({ok: true})}, texts: () => ['full name: Rosalind Quill\n'],
    storage: {settings: () => ({}), saveSettings() {}}});
  const entries = new Proxy([], {get() { throw new Error('boom'); }});
  assert.deepEqual(await visitMore['/extension/report-form']({action: 'submit', entries}), {ok: false, refused: 'failed'});
});

// The worker on stand-in chrome and fetch: each way the call to the app can fail.
let answerWith = () => http(200, {ok: true}), shared = null;   // one worker for the file (each one keeps a timer running); each test says how the app answers
async function worker(respond) {
  answerWith = respond;
  if (shared) return shared;
  const listeners = {debugger: [], navigate: [], committed: [], removed: []};
  globalThis.chrome = {
    runtime: {onMessage: {addListener() {}}, getManifest: () => ({version: '1'}), sendMessage: async () => ({})},
    storage: {local: {get: async () => ({workerUrl: 'http://app.test', token: 't'}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}, remove: async () => {}}, onChanged: {addListener() {}}},
    webNavigation: {onBeforeNavigate: {addListener: fn => listeners.navigate.push(fn)}, onCommitted: {addListener: fn => listeners.committed.push(fn)}},
    tabs: {onRemoved: {addListener: fn => listeners.removed.push(fn)}, query: async () => [], get: async () => ({id: TAB, url: URL_A}), sendMessage: async () => {}},
    debugger: {onDetach: {addListener() {}}, onEvent: {addListener: fn => listeners.debugger.push(fn)}, getTargets: async () => [], attach: async () => {}, detach: async () => {},
      sendCommand: async (target, method) => (method === 'Page.getFrameTree' ? {frameTree: {frame: {id: 'top'}}} : method === 'Network.getResponseBody' ? {body: '<form></form>', base64Encoded: false} : {})},
    scripting: {executeScript: async () => [{result: false}]},
  };
  globalThis.fetch = async (url, init) => answerWith(JSON.parse(init?.body || '{}'));
  const {createReportMessages} = await import('../../extension/messages-report.js');
  const handle = createReportMessages();
  const ask = message => new Promise(resolve => { handle(message, {tab: {id: TAB}}, resolve); });
  for (const fn of listeners.navigate) await fn({frameId: 0, tabId: TAB, url: URL_A});
  await new Promise(resolve => setTimeout(resolve, 20));
  const emit = (method, params) => listeners.debugger.forEach(fn => fn({tabId: TAB}, method, params));
  emit('Network.requestWillBeSent', {requestId: 'A', loaderId: 'A', frameId: 'top', type: 'Document', request: {url: 'https://jobs.example.test/apply', method: 'GET', headers: {'Sec-Fetch-Mode': 'navigate'}}});
  emit('Network.responseReceived', {requestId: 'A', response: {status: 200, headers: {'Content-Type': 'text/html'}}});
  emit('Network.loadingFinished', {requestId: 'A', encodedDataLength: 10});
  emit('Page.frameNavigated', {frame: {id: 'top'}});
  await new Promise(resolve => setTimeout(resolve, 20));
  shared = ask;
  return ask;
}
after(async () => { if (shared) await (await import('../../extension/stop.js')).stopAll('test'); });   // halts the recording's timers so the file can end
const http = (status, data) => ({ok: status < 400, status, json: async () => data});

// What each failure of the call becomes, in the words of the panel.
const CALLS = {
  'the app does not answer (fetch fails)': {respond: () => { throw new TypeError('Failed to fetch'); }, kind: 'app'},
  'the app answers with an error (HTTP 500)': {respond: () => http(500, {error: 'boom'}), kind: 'failed'},
  'the app refuses the token (401)': {respond: () => http(401, {error: 'Wrong token'}), kind: 'connect'},
  'an older app has no such route (404)': {respond: () => http(404, {error: 'Not found'}), kind: 'old'},
  'the app says it is off': {respond: () => http(200, {ok: false, refused: 'off'}), kind: 'off'},
  'the app says it expired': {respond: () => http(200, {ok: false, refused: 'expired'}), kind: 'expired'},
};
for (const [name, {respond, kind}] of Object.entries(CALLS)) {
  test(`Report when ${name}: the worker says "${kind}", never the generic "app"`, async () => {
    const ask = await worker(body => (body.action === 'state' ? http(200, {ok: true, enabled: true}) : respond(body)));
    const answer = await ask({type: 'report-send'});
    assert.equal(answer.ok, false); assert.equal(answer.refused, kind);
    const confirm = await ask({type: 'report-confirm', note: ''});
    assert.equal(confirm.refused, kind, 'Send fails with the same truth');
  });
}
test('the app not answering the switch question is "app" at the press, not "turned off in Settings"', async () => {
  const ask = await worker(() => { throw new TypeError('Failed to fetch'); });
  const state = await ask({type: 'report-state'});
  assert.equal(state.problem, 'app'); assert.notEqual(state.enabled, true);
});

// The panel's sentences: run the popup's own file on a stand-in window to read them.
function panelWords() {
  const window = {}, document = {createElement: () => ({}), };
  vm.runInNewContext(read('extension/panel-report.js'), {window, document});
  return window.__jobPilottoReport;
}
test('every kind a failed Report can have has its own true sentence; only "app" asks if the app is open', () => {
  const {words, sentence} = panelWords();
  const kinds = new Set([...read('extension/messages-report.js').matchAll(/refused: '(\w+)'/g)].map(m => m[1]));
  for (const code of ['extension/messages-report.js', 'desktop/lib/report-handlers.js', 'extension/trace.js']) for (const m of read(code).matchAll(/refused: '(\w+)'/g)) kinds.add(m[1]);
  for (const kind of Object.values(CALLS).map(c => c.kind)) kinds.add(kind);
  for (const kind of ['stopped', 'worker']) kinds.add(kind);
  const seen = new Map();
  for (const kind of kinds) {
    const text = sentence({refused: kind});
    assert.ok(words[kind], `no sentence for "${kind}"`);
    assert.equal(text, words[kind]);
    assert.ok(!seen.has(text), `"${kind}" and "${seen.get(text)}" say the same thing`); seen.set(text, kind);
    if (kind !== 'app') assert.doesNotMatch(text, /app open/i, `"${kind}" must not ask if the app is open`);
  }
  assert.match(words.app, /app/i);
  assert.match(sentence({blocked: ['email']}), /could not remove everything personal/, 'blocked has its own sentence, with what was found');
  assert.doesNotMatch(sentence({refused: 'never-heard-of'}), /app open/i, 'an unknown kind is not blamed on the app being closed');
});
