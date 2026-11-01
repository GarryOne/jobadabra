/* global document */
// The form trace (extension/trace.js) on a REAL browser page: chrome.debugger is stood in for by a Playwright DevTools session, so the trace's own code reads the real protocol. A page that submits a form
// from an XHR answer and leaves (SuccessFactors' Apply, POST /services/cas/createpayload/) keeps that answer in the trace every time, and a reply that stays open (an event stream) never makes the
// page wait. 16 Oct 2026: a read at Network.loadingFinished lost the answer in 4 of 12 local runs; at the Fetch response stage 0 of 60. Guard for extension/trace.js holdReply.
import assert from 'node:assert/strict';
import http from 'node:http';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {createTrace} from '../../../../extension/trace.js';

const TAB = 7;
const FORM_PAGE = '<!doctype html><button id=go>Apply</button><script>document.getElementById("go").addEventListener("click", async () => { const r = await fetch("/payload", {method: "POST", body: "{}"}); const j = await r.json(); const f = document.createElement("form"); f.method = "POST"; f.action = "/next"; const i = document.createElement("input"); i.name = "p"; i.value = j.payload; f.append(i); document.body.append(f); f.submit(); });</script>';
const STREAM_PAGE = '<!doctype html><p id=t>wait</p><script>(async () => { const t0 = performance.now(); const r = await fetch("/stream"); document.getElementById("t").textContent = String(Math.round(performance.now() - t0)); })();</script>';

function server() {
  const instance = http.createServer((req, res) => {
    const send = (type, body, wait = 0) => setTimeout(() => { res.writeHead(200, {'content-type': type}); res.end(body); }, wait);
    req.resume();
    if (req.url === '/') return send('text/html', FORM_PAGE);
    if (req.url === '/stream-page') return send('text/html', STREAM_PAGE);
    if (req.url === '/payload') return send('application/json', '{"payload":"abc-123"}', 20);
    if (req.url === '/next') return send('text/html', '<p>next</p>', 20);
    if (req.url === '/stream') { res.writeHead(200, {'content-type': 'text/event-stream'}); res.write('data: hi\n\n'); return setTimeout(() => res.end(), 4000); }
    res.writeHead(404); res.end();
  });
  return new Promise(resolve => instance.listen(0, '127.0.0.1', () => resolve(instance)));
}

// chrome.debugger over one Playwright DevTools session; the events the trace listens to are forwarded as chrome.debugger.onEvent would.
async function traceOn(context, page) {
  const cdp = await context.newCDPSession(page), listeners = new Set();
  for (const method of ['Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed', 'Page.frameNavigated', 'Fetch.requestPaused']) cdp.on(method, params => listeners.forEach(fn => fn({tabId: TAB}, method, params)));
  const chrome = {debugger: {sendCommand: (target, method, params) => cdp.send(method, params), onEvent: {addListener: fn => listeners.add(fn)}}};
  const trace = createTrace({chrome, attach: async () => {}, detach: async () => {}, hasPassword: async () => false});
  assert.equal(await trace.start(TAB), true);
  return trace;
}

test('on a real page that submits a form from an XHR answer and leaves, the trace keeps the answer every time', async () => {
  const instance = await server(), bodies = [];
  let browser;
  try {
    browser = await chromium.launch({headless: true, args: ['--host-resolver-rules=MAP site.example.test 127.0.0.1']});
    for (let run = 0; run < 8; run += 1) {
      const context = await browser.newContext(), page = await context.newPage(), trace = await traceOn(context, page);
      await page.goto(`http://site.example.test:${instance.address().port}/`);
      await page.click('#go');
      await page.waitForURL('**/next').catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 400));
      const entry = trace.snapshot(TAB).entries?.find(one => one.url.endsWith('/payload'));
      bodies.push(entry?.body ? Buffer.from(entry.body, 'base64').toString() : `lost${entry?.bodyLost ? ' (flagged)' : ''}`);
      trace.endAll();   // the trace's watch timer must not keep the test process alive
      await context.close();
    }
  } finally { await browser?.close(); instance.close(); }
  assert.deepEqual(bodies, Array(8).fill('{"payload":"abc-123"}'), 'the XHR answer is in every trace');
});

test('a reply that stays open (an event stream) never makes the page wait for the trace', async () => {
  const instance = await server();
  let browser;
  try {
    browser = await chromium.launch({headless: true, args: ['--host-resolver-rules=MAP site.example.test 127.0.0.1']});
    const context = await browser.newContext(), page = await context.newPage();
    const trace = await traceOn(context, page);
    await page.goto(`http://site.example.test:${instance.address().port}/stream-page`);
    await page.waitForFunction(() => document.getElementById('t').textContent !== 'wait', null, {timeout: 8000});
    const headersMs = Number(await page.textContent('#t'));
    trace.endAll();
    assert.ok(headersMs < 1500, `the stream's headers reached the page in ${headersMs} ms (the stream itself lasts 4000 ms)`);
  } finally { await browser?.close(); instance.close(); }
});
