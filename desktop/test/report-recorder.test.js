// lib/report-form.js (spec 2026-10-15-report-this-form.md §1, §7): what the extension hands over is scrubbed, searched again, held in memory and filtered by the hosts the person drops; and the
// collector (extension/trace.js since 16 Oct 2026) never reads a request body, a cookie or a request header beyond the fetch mode.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {createHold, finalize, prepare} from '../lib/report-form.js';
import {ownerValuesOf} from '../lib/owner-values.js';

test('the collector never reads a request body, a cookie or a request header beyond the fetch mode', () => {
  const code = fs.readFileSync(new URL('../../extension/trace.js', import.meta.url), 'utf8').split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n').replace(/\s\/\/ .*$/gm, '');
  assert.ok(!/postData|requestHeaders|getCookies|getAllCookies|getRequestPostData|\bcookie\b|authorization/i.test(code), 'a forbidden read in the collector');
  assert.deepEqual(code.match(/params\.request\.headers/g), ['params.request.headers'], 'one read of the request\'s headers ...');
  assert.ok(code.includes('fetchMode(params.request.headers)'), '... and it goes to the fetch mode only');
});


test('prepare: scrubbed, searched again, held in memory with a readable preview; dropped hosts leave; a hit blocks', async () => {
  const values = ownerValuesOf(['full name: Rosalind Quill\nemail: rosalind.quill@mailbox.test\n']);
  const page = '<h1>Hi Rosalind</h1><input name=a value="Rosalind"><p>x</p>';
  const wire = {entries: [
    {method: 'GET', url: 'https://jobs.example.test/apply?t=abc', type: 'document', mode: 'navigate', startMs: 0, waitMs: 5, bodyKey: '', status: 200, failed: false, headers: {'content-type': 'text/html'}, hadCookie: false, body: Buffer.from(page).toString('base64'), size: 9},
    {method: 'GET', url: 'https://cdn.example.test/w.js', type: 'script', mode: 'no-cors', startMs: 9, waitMs: 5, bodyKey: '', status: 200, failed: false, headers: {'content-type': 'application/javascript'}, hadCookie: false, body: Buffer.from('var a=1').toString('base64'), size: 7},
    {method: 'GET', url: 'http://127.0.0.1:5000/own', type: 'fetch', mode: '', startMs: 9, waitMs: 5, bodyKey: '', status: 200, failed: false, headers: {}, hadCookie: false, body: null, size: 0}], truncated: false};
  const ok = prepare(wire, values);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.preview.hosts.map(one => one.host).sort(), ['cdn.example.test', 'jobs.example.test'], 'the app\'s own address is not part of a record');
  assert.ok(ok.preview.removed.typed >= 1 && ok.preview.removed.own >= 1, JSON.stringify(ok.preview.removed));
  assert.ok(!JSON.stringify([...ok.held.bodies.values()].map(String)).match(/Rosalind/));
  const less = finalize(ok.held, ['cdn.example.test'], values);
  assert.equal(less.ok, true); assert.deepEqual(less.record.entries.map(entry => new URL(entry.url).host), ['jobs.example.test']);
  const leaky = prepare({entries: [{...wire.entries[1], headers: {'content-type': 'application/json'}, body: Buffer.from(JSON.stringify({blob: Buffer.from('Hello Quill, this is plain text for you to read here').toString('base64')})).toString('base64')}]}, values);   // a name inside a base64 run
  assert.equal(leaky.ok, true, 'a name inside a base64 run is cleaned in its decoded form and written back (19 Oct 2026)');
  assert.ok(!leaky.held.bodies.size || ![...leaky.held.bodies.values()].some(body => Buffer.from(body.toString().match(/[A-Za-z0-9+/=]{40,}/)?.[0] || '', 'base64').toString().includes('Quill')));
  const clean = prepare({entries: [{...wire.entries[1], body: Buffer.from('const n = "Quill";').toString('base64')}]}, values);
  assert.equal(clean.ok, true, 'a name standing as text in a script is replaced by the scrub, so it no longer blocks the report');
  const hold = createHold({now: () => 0 }), id = hold.put(ok.held);
  assert.equal(hold.size(), 1); assert.ok(hold.take(id)); assert.equal(hold.take(id), null, 'taken once');
  let t = 0; const old = createHold({now: () => t}); old.put(ok.held); t = 16 * 60e3; assert.equal(old.size(), 0, 'gone after 15 minutes');
});

// 16 Oct 2026: a session-bound page (mid-flow) cannot be reloaded alone; the report starts at the job's posting and records the chain across the redirects, in the record format

// The one narrow exception to "never a request header" (owner, 16 Oct 2026, relayed by the coordinator). Question: "Report recording: to keep answers SuccessFactors' Apply sends (lost today),
// the extension must pause each XHR/fetch reply until it's saved. Allow it, with a test proving it reads only the reply's id, status and content type (never request headers, cookies or post data),
// reads nothing on sign-in pages, and holds no reply over 500 ms (live streams not at all)?" Answer: "Yes, with that test". Fetch interception hands the code the paused REQUEST with its headers,
// cookies and post data, so what may be read from it is an allow-list, checked here on the source; the behaviour (nothing read on a sign-in page, a stream let go unread, the 500 ms limit) is tested in
// trace.test.js and, on a real browser, e2e/test/replay/trace-real-browser.test.mjs.
test('the reply hold (Fetch interception) reads only the reply\'s id, status and content type, never the paused request', () => {
  const code = fs.readFileSync(new URL('../../extension/trace.js', import.meta.url), 'utf8').split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n').replace(/\s\/\/ .*$/gm, '');
  const start = code.indexOf('async function holdReply('), end = code.indexOf('async function onFinished(');
  assert.ok(start > 0 && end > start, 'the hold is one function, holdReply');
  const hold = code.slice(start, end);
  const fields = [...new Set([...hold.matchAll(/\bparams\.(\w+)/g)].map(found => found[1]))].sort();
  assert.deepEqual(fields, ['networkId', 'requestId', 'responseErrorReason', 'responseHeaders', 'responseStatusCode'], 'the only fields of the paused event the hold reads');
  assert.ok(!/params\.request\b|\.request\.(headers|postData|url|method)/.test(hold), 'the paused request itself is never read');
  const headers = [...hold.matchAll(/responseHeaders[^;]*/g)].map(found => found[0]);
  assert.ok(headers.length === 1 && /content-type/i.test(headers[0]) && !/set-cookie|authorization|cookie/i.test(headers[0]), 'of the reply\'s headers only the content type is looked at');
  assert.match(code, /const INTERCEPT = \{patterns: \[\{resourceType: 'XHR', requestStage: 'Response'\}, \{resourceType: 'Fetch', requestStage: 'Response'\}\]\};/, 'only XHR and fetch replies, only at the response stage');
  assert.equal(code.match(/Fetch\.enable/g).length, 2, 'enabled in start and resume only');
  assert.ok(Number(code.match(/const HOLD_MS = (\d+);/)?.[1]) <= 500, 'no reply is held longer than 500 ms');
  assert.ok(/run\.paused/.test(hold) && /event-stream/.test(hold), 'nothing is read on a paused (sign-in) trace, and an event stream is not held');
});
