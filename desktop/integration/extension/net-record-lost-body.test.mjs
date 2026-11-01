/* global document */
// A reply's body is read the moment its headers arrive (lib/net-record.mjs): a page that navigates away right after a reply (a form built from the answer and submitted: SuccessFactors' Apply,
// POST /services/cas/createpayload/, 16 Oct 2026) has lost the body by the time the request is reported finished, and the old late read recorded an empty 200 that the replay served as the answer.
// A body that cannot be read is flagged (bodyLost), and the publish guard refuses such a row. Guard for lib/net-record.mjs and lib/record-guard.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {lostBodies} from '../../e2e/lib/record-guard.mjs';
import {netRecorder} from '../../e2e/lib/net-record.mjs';

// A browser context stand-in: a reply's body can be read until the page navigates away (Chromium drops it then).
function stubContext() {
  const handlers = {}, state = {navigated: false};
  const context = {on: (event, fn) => { (handlers[event] ||= []).push(fn); }, emit: (event, arg) => (handlers[event] || []).forEach(fn => fn(arg))};
  const make = (url, text) => {
    const response = {status: () => 200, allHeaders: async () => ({'content-type': 'application/json'}), headers: () => ({'content-type': 'application/json'}),
      body: async () => { if (state.navigated) throw new Error('No resource with given identifier found'); return Buffer.from(text); }};
    const request = {url: () => url, method: () => 'POST', resourceType: () => 'xhr', response: async () => response, allHeaders: async () => ({'sec-fetch-mode': 'cors'}), headers: () => ({}), postDataBuffer: () => Buffer.from('{}'), failure: () => null};
    response.request = () => request;
    return {request, response};
  };
  return {context, state, make};
}

test('a reply whose page navigates away right after it is still recorded with its body (read when its headers arrive)', async () => {
  const {context, state, make} = stubContext(), recorder = netRecorder(context, {startedAt: Date.now()});
  const {request, response} = make('https://site.example.test/services/cas/createpayload/', '{"payload":"abc"}');
  context.emit('request', request);
  context.emit('response', response);   // the headers arrive: the body is asked for now
  state.navigated = true;               // the page submits its form and leaves
  context.emit('requestfinished', request);
  await recorder.flush();
  const {entries, bodies} = recorder.result();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].size, 17);
  assert.ok(entries[0].hash && bodies.get(entries[0].hash).toString() === '{"payload":"abc"}');
  assert.equal(entries[0].bodyLost, undefined);
});

test('a body that really cannot be read is flagged, never recorded as a clean empty reply', async () => {
  const {context, state, make} = stubContext(), recorder = netRecorder(context, {startedAt: Date.now()});
  state.navigated = true;   // gone before anyone asked
  const {request, response} = make('https://site.example.test/services/other/', 'x');
  context.emit('request', request);
  context.emit('response', response);
  context.emit('requestfinished', request);
  await recorder.flush();
  const [entry] = recorder.result().entries;
  assert.deepEqual([entry.status, entry.hash, entry.size, entry.bodyLost], [200, '', 0, true]);
});

test('a record with a lost body is named by the publish guard (host and path only), a clean one is not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-lost-body-'));
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({entries: [{url: 'https://site.example.test/a?x=1', bodyLost: true}, {url: 'https://site.example.test/b'}]}));
  assert.deepEqual(lostBodies(dir), ['site.example.test/a']);
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({entries: [{url: 'https://site.example.test/b'}]}));
  assert.deepEqual(lostBodies(dir), []);
  assert.deepEqual(lostBodies(path.join(dir, 'nothing')), []);
});

// ---- The response stage (Fetch domain): the body of an XHR/fetch reply is taken while the browser still holds the reply paused.
function stubCdpContext({bodyOf}) {
  const handlers = {}, sent = [];
  const cdp = {on: (event, fn) => { handlers[event] = fn; }, send: async (method, params = {}) => { sent.push([method, params.requestId]); if (method === 'Fetch.getResponseBody') { const body = bodyOf(params.requestId); if (body == null) throw new Error('Can only get response body on requests captured after headers received'); return {body, base64Encoded: false}; } return {}; }};
  const listeners = {}, page = {};
  const context = {pages: () => [page], newCDPSession: async () => cdp, on: (event, fn) => { (listeners[event] ||= []).push(fn); }, emit: (event, arg) => (listeners[event] || []).forEach(fn => fn(arg))};
  return {context, page, cdp, handlers, sent};
}

test('an XHR reply is recorded from the response stage even when every later read of it fails; a redirect and a request stage pass through', async () => {
  const stub = stubCdpContext({bodyOf: id => (id === 'R1' ? '{"payload":"abc"}' : null)}), recorder = netRecorder(stub.context, {startedAt: Date.now()});
  await new Promise(resolve => setImmediate(resolve));   // the page's DevTools session is attached
  assert.deepEqual(stub.sent.at(-1), ['Fetch.enable', undefined]);
  await stub.handlers['Fetch.requestPaused']({requestId: 'Q0', request: {method: 'POST', url: 'https://site.example.test/x'}});   // request stage: no status yet
  await stub.handlers['Fetch.requestPaused']({requestId: 'R0', responseStatusCode: 302, request: {method: 'GET', url: 'https://site.example.test/redirect'}});   // a redirect: no body to take
  await stub.handlers['Fetch.requestPaused']({requestId: 'R1', responseStatusCode: 200, request: {method: 'POST', url: 'https://site.example.test/services/cas/createpayload/'}});
  await stub.handlers['Fetch.requestPaused']({requestId: 'L1', responseStatusCode: 200, request: {method: 'GET', url: 'http://127.0.0.1:47111/ext/x'}});   // the app's own address: never read, let go as a reply
  await stub.handlers['Fetch.requestPaused']({requestId: 'S1', responseStatusCode: 200, request: {method: 'GET', url: 'https://site.example.test/events'}, responseHeaders: [{name: 'Content-Type', value: 'text/event-stream'}]});   // an event stream is let go at once, unread
  await stub.handlers['Fetch.requestPaused']({requestId: 'E1', responseErrorReason: 'ConnectionReset', request: {method: 'GET', url: 'https://site.example.test/gone'}});   // a failed reply stays failed
  const continued = stub.sent.filter(([method]) => method === 'Fetch.continueRequest' || method === 'Fetch.continueResponse').map(([method, id]) => `${method}:${id}`);
  assert.deepEqual(continued, ['Fetch.continueRequest:Q0', 'Fetch.continueResponse:R0', 'Fetch.continueResponse:R1', 'Fetch.continueResponse:L1', 'Fetch.continueResponse:S1'], 'every paused reply is let go as what it was');
  assert.ok(!stub.sent.some(([method, id]) => method === 'Fetch.getResponseBody' && id === 'S1'), 'an event stream is never read');
  assert.deepEqual(stub.sent.filter(([method]) => method === 'Fetch.failRequest').map(([, id]) => id), ['E1']);
  assert.ok(!stub.sent.some(([method, id]) => method === 'Fetch.getResponseBody' && id === 'L1'), 'a loopback reply is never read');
  // the page then navigates away: every later read of the body fails
  const response = {status: () => 200, allHeaders: async () => ({'content-type': 'application/json'}), headers: () => ({}), body: async () => { throw new Error('evicted'); }};
  const request = {url: () => 'https://site.example.test/services/cas/createpayload/', method: () => 'POST', resourceType: () => 'xhr', response: async () => response, allHeaders: async () => ({'sec-fetch-mode': 'cors'}), headers: () => ({}), postDataBuffer: () => Buffer.from('{}'), failure: () => null};
  response.request = () => request;
  stub.context.emit('request', request); stub.context.emit('response', response); stub.context.emit('requestfinished', request);
  await recorder.flush();
  const [entry] = recorder.result().entries;
  assert.deepEqual([entry.size, entry.bodyLost], [17, undefined]);
  assert.equal(recorder.result().bodies.get(entry.hash).toString(), '{"payload":"abc"}');
});

test('on a real page that submits a form from an XHR answer and leaves, the answer is recorded every time (a local server, a real browser)', async () => {
  const http = await import('node:http'), {chromium} = await import('playwright-core');
  const page = '<!doctype html><button id=go>Apply</button><script>document.getElementById("go").addEventListener("click", async () => { const r = await fetch("/payload", {method: "POST", body: "{}"}); const j = await r.json(); const f = document.createElement("form"); f.method = "POST"; f.action = "/next"; const i = document.createElement("input"); i.name = "p"; i.value = j.payload; f.append(i); document.body.append(f); f.submit(); });</script>';
  const server = http.createServer((req, res) => {
    const send = (type, body, wait = 0) => setTimeout(() => { res.writeHead(200, {'content-type': type}); res.end(body); }, wait);
    req.resume();
    if (req.url === '/') return send('text/html', page);
    if (req.url === '/payload') return send('application/json', '{"payload":"abc-123"}', 20);
    if (req.url === '/next') return send('text/html', '<p>next</p>', 20);
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const sizes = [];
  let browser;
  try {
    browser = await chromium.launch({headless: true, args: ['--host-resolver-rules=MAP site.example.test 127.0.0.1']});
    for (let run = 0; run < 8; run += 1) {
      const context = await browser.newContext(), recorder = netRecorder(context, {startedAt: Date.now()}), tab = await context.newPage();
      await recorder.ready();   // the recorder's DevTools session on the page is attached before the page does anything (a busy machine attaches it late)
      await tab.goto(`http://site.example.test:${server.address().port}/`);
      await tab.click('#go');
      await tab.waitForURL('**/next').catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 300));
      await recorder.settle(3000); await recorder.flush();
      sizes.push(recorder.result().entries.find(entry => entry.url.endsWith('/payload'))?.size);
      await context.close();
    }
  } finally { await browser?.close(); server.close(); }
  assert.deepEqual(sizes, Array(8).fill(21), 'the XHR answer is in every recording');
});

test('a reply that stays open (an event stream) never makes the page wait for the recorder', async () => {
  const http = await import('node:http'), {chromium} = await import('playwright-core');
  const page = '<!doctype html><p id=t>wait</p><script>(async () => { const t0 = performance.now(); await fetch("/stream"); document.getElementById("t").textContent = String(Math.round(performance.now() - t0)); })();</script>';
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.url === '/') { res.writeHead(200, {'content-type': 'text/html'}); return res.end(page); }
    if (req.url === '/stream') { res.writeHead(200, {'content-type': 'text/event-stream'}); res.write('data: hi\n\n'); return setTimeout(() => res.end(), 4000); }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless: true, args: ['--host-resolver-rules=MAP site.example.test 127.0.0.1']});
    const context = await browser.newContext(), recorder = netRecorder(context, {startedAt: Date.now()}), tab = await context.newPage();
    await recorder.ready();
    await tab.goto(`http://site.example.test:${server.address().port}/`);
    await tab.waitForFunction(() => document.getElementById('t').textContent !== 'wait', null, {timeout: 8000});
    const headersMs = Number(await tab.textContent('#t'));
    assert.ok(headersMs < 1000, `the stream's headers reached the page in ${headersMs} ms (the stream lasts 4000 ms)`);
  } finally { await browser?.close(); server.close(); }
});

test('a lost redirect, font or picture body is not an empty answer; a lost XHR, script or page body still is', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-lost-body-'));
  const lost = (type, status) => ({url: `https://site.example.test/${type}-${status}`, type, status, bodyLost: true});
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({entries: [lost('stylesheet', 302), lost('script', 301), lost('font', 200), lost('image', 200), lost('media', 200)]}));
  assert.deepEqual(lostBodies(dir), []);
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({entries: [lost('xhr', 200), lost('fetch', 200), lost('script', 200), lost('document', 200), lost('stylesheet', 200)]}));
  assert.equal(lostBodies(dir).length, 5);
});

test('a lost HEAD reply or a fetch the page aborted is not an empty answer; the same fetch lost without an abort still is', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-lost-body-'));
  const entry = extra => ({url: 'https://site.example.test/x', type: 'fetch', status: 200, bodyLost: true, ...extra});
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({entries: [entry({method: 'HEAD'}), entry({method: 'POST', error: 'net::ERR_ABORTED'}), entry({method: 'GET', type: 'xhr', error: 'net::ERR_ABORTED'})]}));
  assert.deepEqual(lostBodies(dir), []);
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({entries: [entry({method: 'POST'}), entry({method: 'GET', type: 'script', error: 'net::ERR_ABORTED'}), entry({method: 'GET', error: 'net::ERR_FAILED'})]}));
  assert.equal(lostBodies(dir).length, 3);
});

// 17 Oct 2026 (owner: "4xx pages count as no answer"): a refused PAGE (403 widget frame) is nothing to lose; a refused API call with a body (422) still is, and so is a page that answered 200.
test('a lost 4xx page body is no empty answer; a lost 4xx fetch or xhr body, or a 200 page, still is', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-lost-body-'));
  const lost = (type, status) => ({url: `https://site.example.test/${type}-${status}`, type, status, bodyLost: true});
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({entries: [lost('document', 403), lost('document', 404), lost('document', 429)]}));
  assert.deepEqual(lostBodies(dir), []);
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({entries: [lost('xhr', 422), lost('fetch', 403), lost('document', 200), lost('document', 500)]}));
  assert.equal(lostBodies(dir).length, 4);
});
