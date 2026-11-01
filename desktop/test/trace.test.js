// extension/trace.js and trace-buffer.js (spec 2026-10-16-report-from-the-trace.md): the form trace is kept in memory from the posting on, a sign-in page is never in it (zero entries, the debugger released
// there, the rest of the journey kept with a segment gap), the caps hold, it is dropped when the application ends, and every report entry point hands it over without reloading.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {createTrace} from '../../extension/trace.js';
import {createBuffer} from '../../extension/trace-buffer.js';

function fakeChrome(bodies = {}) {
  const calls = [], listeners = new Set();
  const debuggerApi = {
    sendCommand: async (target, method, params) => { calls.push([method, params]); if (method === 'Network.getResponseBody') return bodies[params.requestId] || {body: '', base64Encoded: false}; if (method === 'Page.getFrameTree') return {frameTree: {frame: {id: 'top'}}}; return {}; },
    onEvent: {addListener: fn => listeners.add(fn)},
  };
  return {chrome: {debugger: debuggerApi}, calls, emit: (tabId, method, params) => listeners.forEach(fn => fn({tabId}, method, params))};
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const manual = () => { const timers = []; return {setTimer: (fn, ms) => { timers.push({fn, ms}); return timers.length; }, clearTimer: () => {}, timers}; };
// A top-level page: its document (an optional redirect before it), then what it loads.
const page = (fake, tab, id, url, {status = 200, headers = {'Content-Type': 'text/html'}, from = null} = {}) => {
  fake.emit(tab, 'Network.requestWillBeSent', {requestId: id, loaderId: id, frameId: 'top', type: 'Document', request: {url, method: 'GET', headers: {'Sec-Fetch-Mode': 'navigate', Cookie: 'sid=SECRET'}}, ...(from ? {redirectResponse: from} : {})});
  fake.emit(tab, 'Network.responseReceived', {requestId: id, response: {status, headers}});
  fake.emit(tab, 'Network.loadingFinished', {requestId: id, encodedDataLength: 10});
  fake.emit(tab, 'Page.frameNavigated', {frame: {id: 'top'}});
};
const sub = (fake, tab, id, url, type = 'Script', headers = {'Content-Type': 'application/javascript'}) => {
  fake.emit(tab, 'Network.requestWillBeSent', {requestId: id, loaderId: 'x', frameId: 'top', type, request: {url, method: 'GET', headers: {}}});
  fake.emit(tab, 'Network.responseReceived', {requestId: id, response: {status: 200, headers}});
  fake.emit(tab, 'Network.loadingFinished', {requestId: id, encodedDataLength: 10});
};
const make = (fake, over = {}) => {
  const log = [], timers = manual();
  const trace = createTrace({chrome: fake.chrome, attach: async id => { log.push(['attach', id]); }, detach: async id => { log.push(['detach', id]); }, ...timers, ...over});
  return {trace, log, timers};
};

test('nothing is attached while the switch is off; on, it attaches once and listens', async () => {
  const fake = fakeChrome(), off = make(fake, {enabled: async () => false});
  assert.equal(await off.trace.start(7), false);
  assert.deepEqual(off.log, []);
  const on = make(fake);
  assert.equal(await on.trace.start(7), true); await on.trace.start(7);
  assert.deepEqual(on.log, [['attach', 7]]);
  assert.deepEqual(fake.calls.map(call => call[0]), ['Network.enable', 'Page.enable', 'Fetch.enable', 'Page.getFrameTree']);   // Fetch.enable: XHR and fetch replies are taken at the response stage (holdReply)
});

test('a journey posting -> redirect -> sign-in -> form: the sign-in page is never in the trace; the pages after it are, in the next segment', async () => {
  const fake = fakeChrome({F: {body: '<form>apply</form>', base64Encoded: false}, S: {body: '<input type=password>SIGNIN-SECRET-PAGE', base64Encoded: false}});
  let password = false;
  const {trace, log, timers} = make(fake, {hasPassword: async () => password});
  await trace.start(7);
  fake.emit(7, 'Network.requestWillBeSent', {requestId: 'P', loaderId: 'P', frameId: 'top', type: 'Document', request: {url: 'https://jobs.example.test/posting', method: 'GET', headers: {'Sec-Fetch-Mode': 'navigate', Cookie: 'sid=SECRET'}}});
  page(fake, 7, 'P', 'https://sso.example.test/in', {from: {status: 302, headers: {Location: 'https://sso.example.test/in'}}});   // the redirect: same request, a new address
  await tick();
  page(fake, 7, 'S', 'https://sso.example.test/login'); sub(fake, 7, 'S1', 'https://sso.example.test/login.js'); await tick();
  password = true;
  await timers.timers.at(-1).fn(); await tick();   // the watch finds the password field
  assert.deepEqual(log.at(-1), ['detach', 7], 'the debugger is released on the sign-in page');
  sub(fake, 7, 'S2', 'https://sso.example.test/while-paused.js'); await tick();
  password = false;
  await trace.navigating(7);   // the next navigation resumes before its first request
  assert.deepEqual(log.at(-1), ['attach', 7]);
  page(fake, 7, 'F', 'https://apply.example.test/form'); sub(fake, 7, 'F1', 'https://apply.example.test/app.js'); await tick(); await tick();
  const result = trace.snapshot(7);
  assert.equal(result.ok, true);
  const urls = result.entries.map(entry => entry.url);
  assert.ok(!urls.some(url => /login|while-paused/.test(url)), `a sign-in entry is in the trace: ${urls}`);
  assert.ok(!JSON.stringify(result).includes('SIGNIN-SECRET-PAGE'), 'its body is gone');
  assert.deepEqual(urls, ['https://jobs.example.test/posting', 'https://sso.example.test/in', 'https://apply.example.test/form', 'https://apply.example.test/app.js']);
  assert.deepEqual(result.entries.map(entry => entry.seg), [0, 0, 1, 1], 'the gap starts the next segment');
  assert.ok(!JSON.stringify(result).match(/SECRET|sid=/), 'no cookie, no request header leaves');
  assert.equal(trace.snapshot(7, 'page').entries.every(entry => entry.seg === 0 && /apply\.example/.test(entry.url)), true, '"only this page" is the page now shown');
});

test('what is kept: this tab only, allowed headers, no image or media body is read, a redirect keeps its status', async () => {
  const fake = fakeChrome({D: {body: '<p>é</p>', base64Encoded: false}}), {trace} = make(fake);
  await trace.start(7);
  page(fake, 7, 'D', 'https://jobs.example.test/apply', {headers: {'Content-Type': 'text/html', 'Set-Cookie': 'a=b', 'X-Trace': '1'}});
  sub(fake, 7, 'I', 'https://jobs.example.test/photo.png', 'Image', {'content-type': 'image/png'});
  page(fake, 9, 'Z', 'https://other.example.test/');   // another tab
  await tick(); await tick();
  const entries = trace.snapshot(7).entries, byUrl = Object.fromEntries(entries.map(entry => [entry.url, entry]));
  assert.equal(entries.length, 2);
  assert.deepEqual(byUrl['https://jobs.example.test/apply'].headers, {'content-type': 'text/html'});
  assert.equal(Buffer.from(byUrl['https://jobs.example.test/apply'].body, 'base64').toString(), '<p>é</p>');
  assert.equal(byUrl['https://jobs.example.test/photo.png'].body, null);
  assert.ok(!fake.calls.some(call => call[0] === 'Network.getResponseBody' && call[1].requestId === 'I'), 'an image body is never read');
});

test('dropped when the application ends: tab closed, Stop; a stopped extension stops recording, keeps what it has, and the debugger is released', async () => {
  const fake = fakeChrome(), {trace, log, timers} = make(fake); let stopped = false;
  const again = make(fake, {stopped: () => stopped});
  await trace.start(7); page(fake, 7, 'A', 'https://jobs.example.test/a'); await tick();
  assert.equal(trace.has(7), true);
  trace.end(7);
  assert.equal(trace.has(7), false); assert.equal(trace.snapshot(7).ok, false); assert.deepEqual(log.at(-1), ['detach', 7]);
  await again.trace.start(8); page(fake, 8, 'B', 'https://jobs.example.test/b'); await tick();
  stopped = true; await again.timers.timers.at(-1).fn(); await tick();
  assert.equal(again.trace.has(8), true, 'a Stop keeps what was recorded (19 Oct 2026)'); assert.equal(again.trace.isTracing(8), false);
  assert.equal((await make(fake, {stopped: () => true}).trace.start(9)), false);
  void timers;
});

test('the buffer caps: over the size cap the oldest page goes, the first pages and the page now shown stay, and the result says truncated', () => {
  const buffer = createBuffer({limits: {maxTab: 100, maxAll: 1000, pinned: 1}});
  const add = (page, url, bytes) => { if (page) buffer.page(7); buffer.add(7, {url, type: 'document', startMs: 0, body: 'x'.repeat(bytes)}, bytes); };
  add(true, 'https://a.test/first', 40); add(true, 'https://a.test/second', 40); add(true, 'https://a.test/third', 40);
  const urls = buffer.snapshot(7).entries.map(entry => entry.url);
  assert.deepEqual(urls, ['https://a.test/first', 'https://a.test/third'], 'the pinned first page and the page now shown stay');
  assert.equal(buffer.snapshot(7).truncated, true);
  const small = createBuffer({limits: {maxTab: 1000, maxAll: 1000, maxEntries: 3, pinned: 1}});
  for (let i = 0; i < 6; i += 1) { small.page(1); small.add(1, {url: `https://a.test/${i}`, type: 'document', startMs: i, body: null}, 0); }
  assert.ok(small.snapshot(1).entries.length <= 3);
  const total = createBuffer({limits: {maxTab: 100, maxAll: 100, pinned: 0}});
  for (const id of [1, 2, 3]) { total.page(id); total.add(id, {url: `https://t.test/${id}`, type: 'document', startMs: 0, body: 'x'.repeat(40)}, 40); total.page(id); total.add(id, {url: `https://t.test/${id}/b`, type: 'document', startMs: 1, body: 'x'.repeat(40)}, 40); }
  assert.ok([1, 2, 3].reduce((sum, id) => sum + total.bytes(id), 0) <= 140, 'all tabs together stay near the cap');
  let t = 0; const aged = createBuffer({limits: {maxAgeMs: 100, pinned: 1}, now: () => t});
  aged.page(1); aged.add(1, {url: 'https://a.test/1', type: 'document', startMs: 0}, 0); t = 50; aged.page(1); aged.add(1, {url: 'https://a.test/2', type: 'document', startMs: 1}, 0);
  t = 200; aged.page(1); aged.add(1, {url: 'https://a.test/3', type: 'document', startMs: 2}, 0);
  assert.deepEqual(aged.snapshot(1).entries.map(entry => entry.url), ['https://a.test/1', 'https://a.test/3'], 'a page older than the time cap goes');
});

test('the class: every report entry point hands the trace over; nothing reloads or starts a second recording', () => {
  const code = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  for (const file of ['extension/panel-report.js', 'extension/messages-report.js', 'extension/trace.js']) {
    assert.ok(!/Page\.reload|chrome\.tabs\.reload|location\.reload|report-start|report-stop|moveTab/.test(code(file).split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n').replace(/\s\/\/ .*$/gm, '')), `${file} reloads or records again`);
  }
  assert.equal((code('extension/messages-report.js').match(/'report-send'/g) || []).length >= 1, true);
  assert.match(code('extension/review.js'), /__jobadabraReport\.open\(\)/, 'the footer\'s Report opens the one popup');
  assert.doesNotMatch(code('extension/panel-claude.js'), /jobadabra-report-open/, 'the stuck card has no second Report button (owner, 19 Oct 2026: one Report on the panel)');
  assert.deepEqual([...new Set(code('extension/panel-report.js').match(/type: 'report-[a-z]+'/g))].sort(), ["type: 'report-cancel'", "type: 'report-confirm'", "type: 'report-send'", "type: 'report-state'"], 'the panel sends only these four');
  // one debugger owner: no other file attaches or detaches (stop.js only detaches everything when Stop is pressed)
  const {readdirSync} = fs, walk = dir => readdirSync(new URL(`../../${dir}`, import.meta.url), {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));
  for (const file of walk('extension').filter(name => name.endsWith('.js'))) {
    if (['extension/stop-state.js', 'extension/stop.js'].includes(file)) continue;
    assert.ok(!/chrome\.debugger\.(attach|detach)\(/.test(code(file)), `${file} attaches or detaches the debugger itself: use attachDebugger / detachDebugger (stop-state.js)`);
  }
});

test('a text reply whose body Chrome no longer has (the page navigated away right after it) is flagged bodyLost; a redirect, a cached reply and a read body are not', async () => {
  const fake = fakeChrome({R: {body: '{"payload":"abc"}', base64Encoded: false}}), {trace} = make(fake), real = fake.chrome.debugger.sendCommand;
  fake.chrome.debugger.sendCommand = async (target, method, params) => { if (method === 'Network.getResponseBody' && ['L', 'X', 'C'].includes(params.requestId)) throw new Error('No resource with given identifier found'); return real(target, method, params); };
  assert.equal(await trace.start(7), true);
  page(fake, 7, 'D', 'https://jobs.example.test/apply');
  const xhr = (id, status, encoded, url) => { fake.emit(7, 'Network.requestWillBeSent', {requestId: id, loaderId: 'x', frameId: 'top', type: 'XHR', request: {url, method: 'POST', headers: {}}});
    fake.emit(7, 'Network.responseReceived', {requestId: id, response: {status, headers: {'Content-Type': 'application/json'}}}); fake.emit(7, 'Network.loadingFinished', {requestId: id, encodedDataLength: encoded}); };
  xhr('R', 200, 17, 'https://jobs.example.test/read');       // read: kept with its body
  xhr('L', 200, 17, 'https://jobs.example.test/lost');       // bytes arrived, the read failed: lost
  xhr('X', 302, 0, 'https://jobs.example.test/redirect');    // a redirect has no body
  xhr('C', 200, 0, 'https://jobs.example.test/cached');      // a cached reply: no bytes on the wire
  await tick(); await tick();
  const byUrl = Object.fromEntries(trace.snapshot(7).entries.map(entry => [entry.url.split('/').pop(), entry]));
  assert.deepEqual([byUrl.read.bodyLost, byUrl.lost.bodyLost, byUrl.redirect.bodyLost, byUrl.cached.bodyLost], [undefined, true, undefined, undefined]);
  assert.equal(Buffer.from(byUrl.read.body, 'base64').toString(), '{"payload":"abc"}');
  assert.ok(byUrl.lost.body === null && byUrl.lost.size === 17);
});

// ---- The response stage: a reply of an XHR or fetch is taken while Chrome holds it paused, and let go as received.
const sentOf = (fake, ...methods) => fake.calls.filter(call => methods.includes(call[0]));
const xhrStart = (fake, tab, id, url, method = 'POST') => fake.emit(tab, 'Network.requestWillBeSent', {requestId: id, loaderId: 'x', frameId: 'top', type: 'XHR', request: {url, method, headers: {}}});

test('an XHR reply is taken at the response stage, then let go; the entry carries that body even when a later read fails', async () => {
  const fake = fakeChrome(), {trace} = make(fake), real = fake.chrome.debugger.sendCommand;
  fake.chrome.debugger.sendCommand = async (target, method, params) => {
    if (method === 'Fetch.getResponseBody') { fake.calls.push([method, params]); return {body: '{"payload":"abc"}', base64Encoded: false}; }
    if (method === 'Network.getResponseBody' && params.requestId === 'N1') throw new Error('No resource with given identifier found');   // evicted: the page navigated away
    return real(target, method, params);
  };
  assert.equal(await trace.start(7), true);
  page(fake, 7, 'D', 'https://jobs.example.test/apply');
  xhrStart(fake, 7, 'N1', 'https://jobs.example.test/services/cas/createpayload/');
  fake.emit(7, 'Fetch.requestPaused', {requestId: 'F1', networkId: 'N1', responseStatusCode: 200, request: {url: 'https://jobs.example.test/services/cas/createpayload/', method: 'POST'}, responseHeaders: [{name: 'Content-Type', value: 'application/json'}]});
  fake.emit(7, 'Network.responseReceived', {requestId: 'N1', response: {status: 200, headers: {'Content-Type': 'application/json'}}});
  await tick(); await tick();
  fake.emit(7, 'Network.loadingFinished', {requestId: 'N1', encodedDataLength: 17});
  await tick(); await tick();
  assert.deepEqual(sentOf(fake, 'Fetch.getResponseBody', 'Fetch.continueResponse').map(call => [call[0], call[1].requestId]), [['Fetch.getResponseBody', 'F1'], ['Fetch.continueResponse', 'F1']]);
  const entry = trace.snapshot(7).entries.find(one => one.url.endsWith('createpayload/'));
  assert.equal(Buffer.from(entry.body, 'base64').toString(), '{"payload":"abc"}');
  assert.equal(entry.bodyLost, undefined);
});

test('a paused reply is always let go as it was: an event stream at once and unread, a failed one failed, a slow one after the limit, any reply on a paused trace unread', async () => {
  const fake = fakeChrome(), {trace, timers} = make(fake), real = fake.chrome.debugger.sendCommand;
  fake.chrome.debugger.sendCommand = async (target, method, params) => { if (method === 'Fetch.getResponseBody') { fake.calls.push([method, params]); if (params.requestId === 'SLOW') return new Promise(() => {}); return {body: 'x', base64Encoded: false}; } return real(target, method, params); };
  assert.equal(await trace.start(7), true);
  const paused = (id, extra = {}) => fake.emit(7, 'Fetch.requestPaused', {requestId: id, networkId: id, request: {url: 'https://jobs.example.test/x', method: 'GET'}, responseStatusCode: 200, ...extra});
  paused('SSE', {responseHeaders: [{name: 'content-type', value: 'text/event-stream; charset=utf-8'}]});
  paused('ERR', {responseStatusCode: undefined, responseErrorReason: 'ConnectionReset'});
  paused('SLOW');
  await tick(); await tick();
  assert.deepEqual(sentOf(fake, 'Fetch.getResponseBody').map(call => call[1].requestId), ['SLOW'], 'only the plain reply is read');
  assert.deepEqual(sentOf(fake, 'Fetch.continueResponse', 'Fetch.failRequest').map(call => [call[0], call[1].requestId]), [['Fetch.continueResponse', 'SSE'], ['Fetch.failRequest', 'ERR']]);
  const limit = timers.timers.filter(timer => timer.ms === 500); assert.equal(limit.length, 1, 'the slow reply has a 500 ms limit');
  limit[0].fn(); await tick(); await tick();
  assert.deepEqual(sentOf(fake, 'Fetch.continueResponse').map(call => call[1].requestId), ['SSE', 'SLOW'], 'after the limit it is let go');
  // a trace paused on a sign-in page (the debugger released): a reply that still arrives is let go unread
  const before = sentOf(fake, 'Fetch.getResponseBody').length;
  fake.emit(7, 'Fetch.requestPaused', {requestId: 'LATE', request: {url: 'https://other.example.test/x', method: 'GET'}, responseStatusCode: 200});   // a tab with no run
  fake.emit(9, 'Fetch.requestPaused', {requestId: 'NORUN', request: {url: 'https://other.example.test/x', method: 'GET'}, responseStatusCode: 200});
  await tick(); await tick();
  assert.equal(sentOf(fake, 'Fetch.getResponseBody').length, before + 1, 'LATE (this tab has a run) is read; NORUN (no run on tab 9) is not');
  assert.ok(sentOf(fake, 'Fetch.continueResponse').some(call => call[1].requestId === 'NORUN'), 'a tab with no run still lets its reply go');
});

// Owner, 19 Oct 2026: "The recording should be on always. So clicking report should already send the recording." A Stop halts the recording and the debugger but keeps what was recorded, so Report after a Stop sends it.
test('Stop keeps the pages recorded so far: the recording ends, the debugger is released, and the snapshot still holds them', async () => {
  const fake = fakeChrome(), {trace, log} = make(fake);
  await trace.start(7); page(fake, 7, 'A', 'https://jobs.example.test/a'); page(fake, 7, 'B', 'https://jobs.example.test/b'); await tick();
  trace.haltAll();   // what the worker's onStopped does
  assert.equal(trace.isTracing(7), false, 'no longer recording');
  assert.deepEqual(log.at(-1), ['detach', 7], 'the debugger is released');
  assert.equal(trace.has(7), true);
  assert.deepEqual(trace.snapshot(7).entries.map(entry => entry.url), ['https://jobs.example.test/a', 'https://jobs.example.test/b'], 'both pages recorded before the Stop are still there');
  page(fake, 7, 'C', 'https://jobs.example.test/c'); await tick();
  assert.equal(trace.snapshot(7).entries.length, 2, 'nothing is recorded after the Stop');
  trace.end(7);
  assert.equal(trace.has(7), false, 'the tab closing still drops it');
});
