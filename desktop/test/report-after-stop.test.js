// Owner, 19 Oct 2026: "The recording should be on always. So clicking Report should already send the recording", and his own failing case was Stop, then Report. The worker (extension/messages-report.js) on stand-in
// chrome and fetch: a form page is recorded, the person presses Stop, then Report: the app is handed the pages recorded BEFORE the Stop, Send sends that once with the note, Cancel sends nothing. Never a real report.
import assert from 'node:assert/strict';
import {test} from 'node:test';

const TAB = 7, URL_A = 'https://jobs.example.test/apply#jobadabra-fill';
function stand() {
  const listeners = {debugger: [], navigate: [], committed: [], removed: []}, calls = [];
  const chrome = {
    runtime: {onMessage: {addListener() {}}, getManifest: () => ({version: '1'}), sendMessage: async () => ({})},
    storage: {local: {get: async () => ({workerUrl: 'http://app.test', token: 't'}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}, remove: async () => {}}, onChanged: {addListener() {}}},
    webNavigation: {onBeforeNavigate: {addListener: fn => listeners.navigate.push(fn)}, onCommitted: {addListener: fn => listeners.committed.push(fn)}},
    tabs: {onRemoved: {addListener: fn => listeners.removed.push(fn)}, query: async () => [], get: async () => ({id: TAB, url: URL_A}), sendMessage: async () => {}},
    debugger: {onDetach: {addListener() {}}, onEvent: {addListener: fn => listeners.debugger.push(fn)}, getTargets: async () => [], attach: async () => {}, detach: async () => {},
      sendCommand: async (target, method) => (method === 'Page.getFrameTree' ? {frameTree: {frame: {id: 'top'}}} : method === 'Network.getResponseBody' ? {body: '<form></form>', base64Encoded: false} : {})},
    scripting: {executeScript: async () => [{result: false}]},
  };
  globalThis.chrome = chrome;
  globalThis.fetch = async (url, init) => { const body = JSON.parse(init?.body || '{}'); calls.push(body); const answer = body.action === 'submit' ? {ok: true, preview: {responses: body.entries.length, hosts: [], removed: {}}} : {ok: true, enabled: true}; return {ok: true, status: 200, json: async () => answer}; };
  const emit = (method, params) => listeners.debugger.forEach(fn => fn({tabId: TAB}, method, params));
  return {chrome, calls, listeners, emit};
}
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

test('fill, Stop, Report: the app gets the pages recorded before the Stop; Send sends once with the note; Cancel sends nothing', async () => {
  const world = stand();
  const {createReportMessages} = await import('../../extension/messages-report.js');
  const {stopAll, isStopped} = await import('../../extension/stop.js');
  const handle = createReportMessages();
  const ask = (message, sender = {tab: {id: TAB}}) => new Promise(resolve => { const keep = handle(message, sender, resolve); if (keep !== true) resolve(undefined); });
  for (const fn of world.listeners.navigate) await fn({frameId: 0, tabId: TAB, url: URL_A});   // the app opened the tab with the mark: recording starts
  await tick();
  world.emit('Network.requestWillBeSent', {requestId: 'A', loaderId: 'A', frameId: 'top', type: 'Document', request: {url: 'https://jobs.example.test/apply', method: 'GET', headers: {'Sec-Fetch-Mode': 'navigate'}}});
  world.emit('Network.responseReceived', {requestId: 'A', response: {status: 200, headers: {'Content-Type': 'text/html'}}});
  world.emit('Network.loadingFinished', {requestId: 'A', encodedDataLength: 10});
  world.emit('Page.frameNavigated', {frame: {id: 'top'}});
  await tick();
  assert.equal((await ask({type: 'report-state'})).has, true, 'control: the page is recorded before the Stop');
  await stopAll('test');
  assert.equal(isStopped(), true);
  const state = await ask({type: 'report-state'});
  assert.equal(state.has, true, 'a Stop keeps what was recorded'); assert.equal(state.stopped, true); assert.equal(state.tracing, false, 'and records nothing more');
  assert.deepEqual(await ask({type: 'report-send'}), {ok: true, preview: {responses: 1, hosts: [], removed: {}}});
  const submit = world.calls.find(call => call.action === 'submit');
  assert.deepEqual(submit.entries.map(entry => entry.url), ['https://jobs.example.test/apply'], 'the pages recorded before the Stop go to the app');
  assert.deepEqual(await ask({type: 'report-confirm', note: 'stopped at the CV step'}), {ok: true});
  assert.deepEqual(world.calls.filter(call => call.action === 'send'), [{action: 'send', note: 'stopped at the CV step'}], 'one send, with the note');
  await ask({type: 'report-cancel'});
  assert.equal(world.calls.filter(call => call.action === 'send').length, 1, 'Cancel sent nothing');
  assert.ok(world.calls.some(call => call.action === 'cancel'), 'the app is told to drop what it holds');
  assert.equal(await ask({type: 'report-send'}, {}), undefined, 'a message that is not from a tab is ignored');
});
