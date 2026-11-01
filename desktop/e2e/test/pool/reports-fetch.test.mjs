// reports-fetch.mjs (spec 2026-10-15-report-this-form.md §5, §7): a report an install uploaded comes back as a pool record the offline loop reads like any other (newestPerRow finds it, its bodies are
// there), only with the owner's private key; a report another key sealed is skipped; each fetched one is marked. The test makes its own key pair.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {bundleOf, encryptBundle} from '../../../lib/report-upload.js';
import {sha} from '../../../lib/net-keep.js';
import {fetchReports} from '../../reports-fetch.mjs';
import {newestPerRow} from '../../replay-records.mjs';

const pair = () => crypto.generateKeyPairSync('rsa', {modulusLength: 2048, publicKeyEncoding: {type: 'spki', format: 'pem'}, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}});
const mine = pair(), other = pair();
const html = Buffer.from('<form><input name="a"></form>'), hash = sha(html);
const record = () => ({entries: [{method: 'GET', url: 'https://jobs.example.test/apply', type: 'document', hash, size: html.length, headers: {'content-type': 'text/html'}, status: 200, startMs: 0, waitMs: 1, bodyKey: '', failed: false, hadCookie: false, mode: ''}], bodies: new Map([[hash, html]]), stats: {requests: 1}});
const sealed = pem => encryptBundle(bundleOf(record(), 1000), pem);

function site(reports) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url.replace('https://site.test', '')}`);
    if (url.endsWith('/api/report-form')) return Response.json({ok: true, reports: reports.map(({id}) => ({id, requests: 1, bytes: 10}))});
    const id = url.split('/').pop().split('?')[0], one = reports.find(report => report.id === id);
    if (url.includes('?status=fetched')) return Response.json({ok: true});
    return new Response(one.body, {headers: {'X-Report-Key': one.wrapped}});
  };
  return {fetcher, calls};
}

test('a report comes back as a pool record the loop reads, is marked fetched, and one sealed for another key is skipped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-reports-')), good = sealed(mine.publicKey), bad = sealed(other.publicKey), said = [];
  const {fetcher, calls} = site([{id: 'r1', body: good.body, wrapped: good.wrapped}, {id: 'r2', body: bad.body, wrapped: bad.wrapped}]);
  const done = await fetchReports({dir, fetcher, site: 'https://site.test', adminKey: 'owner', privatePem: mine.privateKey, say: line => said.push(line)});
  assert.equal(done.length, 1);
  assert.deepEqual(calls.filter(call => call.startsWith('POST')), ['POST /api/report-form/r1?status=fetched'], 'only the opened one is marked');
  const rows = newestPerRow(dir, new Map());
  assert.equal(rows.length, 1); assert.match(rows[0].name, /^reported-[0-9a-f]{6}-example\.test$/); assert.equal(rows[0].record.source, 'person');
  assert.equal(fs.readFileSync(path.join(rows[0].dir, 'bodies', hash), 'utf8'), html.toString());
  assert.ok(said.some(line => /r2: could not be opened/.test(line)));
  fs.rmSync(dir, {recursive: true, force: true});
});

test('--dry fetches nothing and marks nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-reports-')), {fetcher, calls} = site([{id: 'r1', body: Buffer.alloc(40), wrapped: 'x'}]);
  assert.deepEqual(await fetchReports({dir, dry: true, fetcher, site: 'https://site.test', adminKey: 'owner', privatePem: mine.privateKey, say: () => {}}), []);
  assert.deepEqual(calls, ['GET /api/report-form']);
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('a fetched report replays offline like a pool record: the page the live visit asked for is served from it, query values and all', async () => {
  const {scrubRecord} = await import('../../../lib/report-scrub.js'), {netReplay} = await import('../../lib/net-record.mjs');
  const page = Buffer.from('<form><input name="first"></form>'), live = {method: 'GET', url: 'https://jobs.example.test/apply?token=abc123def456ghi789&lang=en', type: 'document', mode: 'navigate', startMs: 0, waitMs: 0, bodyKey: '', status: 200,
    failed: false, headers: {'content-type': 'text/html'}, hadCookie: false, hash: sha(page), size: page.length};
  const scrubbed = scrubRecord({entries: [live], bodies: new Map([[sha(page), page]])}), sealedBundle = encryptBundle(bundleOf(scrubbed, 1000), mine.publicKey);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-reports-')), {fetcher} = site([{id: 'r1', body: sealedBundle.body, wrapped: sealedBundle.wrapped}]);
  await fetchReports({dir, fetcher, site: 'https://site.test', adminKey: 'owner', privatePem: mine.privateKey, say: () => {}});
  const [row] = newestPerRow(dir, new Map()), bodies = new Map(fs.readdirSync(path.join(row.dir, 'bodies')).map(name => [name, fs.readFileSync(path.join(row.dir, 'bodies', name))]));
  assert.equal(row.record.entries[0].url, 'https://jobs.example.test/apply?token=<v>&lang=<v>', 'the scrubbed address is what the record holds');
  let handler = null;
  await netReplay({routeWebSocket: async () => {}, route: async (_pattern, fn) => { handler = fn; }}, {entries: row.record.entries, bodies}, {});
  const served = {};
  await handler({request: () => ({url: () => 'https://jobs.example.test/apply?token=zzz999yyy888xxx777&lang=en', method: () => 'GET', allHeaders: async () => ({}), headers: () => ({}), postDataBuffer: () => null, resourceType: () => 'document', isNavigationRequest: () => true}),
    fulfill: async reply => { served.reply = reply; }, continue: async () => {}, abort: async () => {}});
  assert.equal(served.reply.status, 200); assert.equal(served.reply.body.toString(), page.toString());
  fs.rmSync(dir, {recursive: true, force: true});
});

test('a trace that crossed a sign-in page replays from the first page after it; the pages before it stay in the record, never replayed', async () => {
  const {segmented} = await import('../../reports-fetch.mjs');
  const entry = (url, seg) => ({method: 'GET', url, type: 'document', status: 200, headers: {}, hash: '', seg});
  const record = segmented({name: 'reported-x', entries: [entry('https://a.test/posting', 0), entry('https://a.test/sso', 0), entry('https://a.test/form', 1), entry('https://a.test/step2', 1)]});
  assert.deepEqual(record.entries.map(one => one.url), ['https://a.test/form', 'https://a.test/step2']);
  assert.deepEqual(record.earlier.map(one => one.url), ['https://a.test/posting', 'https://a.test/sso']);
  assert.ok(record.entries.every(one => !('seg' in one)), 'the replayer reads the same shape as any record');
  assert.equal(segmented({entries: [entry('https://a.test/p', 0)]}).earlier, undefined, 'no gap: the whole journey replays');
});
