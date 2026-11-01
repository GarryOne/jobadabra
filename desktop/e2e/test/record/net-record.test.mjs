// The network recorder's keep rules (lib/net-record.mjs): what a record may hold (never cookies, request headers or request bodies), beacons dropped,
// images blanked to their size, request bodies kept only as a key. Pure: no browser.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {seedRandom, sequence} from '../../lib/seeded-random.mjs';
import {repairUnlabeledText} from '../../../lib/net-keep.js';
import {bodyKey, cookiesOf, echo, headerText, keepRecord, netRecorder, normUrl, prefetchedCode, recordable} from '../../lib/net-record.mjs';

const png = (width, height) => { const buf = Buffer.alloc(33); buf.writeUInt32BE(0x89504e47, 0); buf.writeUInt32BE(width, 16); buf.writeUInt32BE(height, 20); return buf; };
const entry = (over = {}) => ({method: 'GET', url: 'https://jobs.example.test/apply', type: 'document', mode: 'navigate', startMs: 0, waitMs: 10, bodyKey: '', status: 200, failed: false, headers: {'content-type': 'text/html'}, hadCookie: false, hash: 'h1', size: 3, ...over});

test('a record keeps only the allowed response headers, never cookies; a beacon is dropped; an image becomes an empty SVG of its size', () => {
  const bodies = new Map([['h1', Buffer.from('abc')], ['img', png(120, 40)], ['b', Buffer.from('1')]]);
  const {entries, bodies: kept, stats} = keepRecord({bodies, entries: [
    entry(),
    entry({url: 'https://cdn.example.test/logo.png', type: 'image', hash: 'img', size: 33, headers: {'content-type': 'image/png'}}),
    entry({url: 'https://track.other.test/collect', type: 'ping', mode: 'no-cors', hash: 'b', size: 1}),
  ]});
  assert.equal(stats.dropped.beacon, 1);
  assert.equal(entries.find(one => one.type === 'ping').hash, '', 'a dropped beacon keeps no body');
  const image = entries.find(one => one.type === 'image');
  assert.equal(image.headers['content-type'], 'image/svg+xml');
  assert.match(kept.get(image.hash).toString(), /width="120" height="40"/);
  for (const one of entries) assert.ok(Object.keys(one.headers).every(name => /^(content-type|location|access-control-.*)$/i.test(name)), JSON.stringify(one.headers));
});

test('a request body is kept only as a key: a file part by its hash, text parts normalised, never the bytes', () => {
  const body = Buffer.from('--B\r\nContent-Disposition: form-data; name="key"\r\n\r\nstash/1791920360939-cnuf6fdhlre\r\n--B\r\nContent-Disposition: form-data; name="file"; filename="cv.pdf"\r\n\r\n%PDF-1.4 secret\r\n--B--\r\n');
  const key = bodyKey(body, 'multipart/form-data; boundary=B');
  assert.match(key, /^multi:key=.*&file=file:[0-9a-f]{16}$/);
  assert.ok(!key.includes('secret') && !key.includes('%PDF'), key);
  assert.equal(bodyKey(Buffer.from(''), 'text/plain'), '');
});

test('the app on this computer is never recorded; per-run values in an address are normalised', () => {
  assert.equal(recordable('http://127.0.0.1:4100/extension/me'), false);
  assert.equal(recordable('https://jobs.example.test/'), true);
  assert.equal(normUrl('https://a.test/x?session=ab12cd34ef&lang=en'), normUrl('https://a.test/x?lang=en&session=zz99yy88xx'));
});

test('an image of a format whose size is unknown is kept whole; a WebP is blanked at its own size', () => {
  const webp = Buffer.alloc(40); webp.write('RIFF', 0, 'latin1'); webp.write('WEBP', 8, 'latin1'); webp.write('VP8X', 12, 'latin1'); webp.writeUIntLE(319, 24, 3); webp.writeUIntLE(39, 27, 3);
  const avif = Buffer.from('\0\0\0 ftypavif-made-up-bytes');
  const {entries, bodies} = keepRecord({bodies: new Map([['w', webp], ['a', avif]]), entries: [
    entry({url: 'https://cdn.example.test/flags.webp', type: 'image', hash: 'w', size: 40}),
    entry({url: 'https://cdn.example.test/logo.png', type: 'image', hash: 'a', size: avif.length, headers: {'content-type': 'image/avif'}}),
  ]});
  assert.match(bodies.get(entries[0].hash).toString(), /width="320" height="40"/);
  assert.deepEqual(bodies.get(entries[1].hash), avif, 'an unmeasured image keeps its own bytes (a 1 px stand-in shrank a form by 40 px)');
  assert.equal(entries[1].headers['content-type'], 'image/avif');
});

test('a recorded reply that echoes the page\'s time+random upload key gets the key this replay sent, plain and URL-encoded', () => {
  const reply = Buffer.from('<Location>https://store.test/stash%2Fr%2F1791920360939-cnuf6fdhlre-07ea</Location><Key>stash/r/1791920360939-cnuf6fdhlre-07ea</Key>');
  const out = echo(reply, ['stash/r/1791920362778-zzp4hhc0ymk-07ea', 'UTF8']).toString();
  assert.match(out, /<Key>stash\/r\/1791920362778-zzp4hhc0ymk-07ea<\/Key>/);
  assert.match(out, /stash%2Fr%2F1791920362778-zzp4hhc0ymk-07ea/);
  assert.equal(echo(reply, ['short-1']), reply, 'a short or plain value is never swapped');
});

test('the page draws the same random numbers from the same seed, in [0, 1); no seed sets nothing', async () => {
  const a = sequence(1791920352178 % 4294967296), b = sequence(1791920352178 % 4294967296), draws = Array.from({length: 5}, a);
  assert.deepEqual(draws, Array.from({length: 5}, b));
  assert.ok(draws.every(x => x >= 0 && x < 1) && new Set(draws).size === 5);
  let added = null;
  assert.equal(await seedRandom({addInitScript: async (fn, arg) => { added = arg; }}, 1791920352178), true);
  assert.equal(added, 1791920352178 % 4294967296);
  assert.equal(await seedRandom({addInitScript: async () => { throw new Error('never'); }}, undefined), false);
});

test('a request reported failed after its reply came keeps that reply (an upload the page stopped reading); one with no reply is failed', async () => {
  const {EventEmitter} = await import('node:events');
  const context = new EventEmitter(), rec = netRecorder(context, {startedAt: 0});
  const request = (url, response) => ({url: () => url, method: () => 'POST', resourceType: () => 'fetch', postDataBuffer: () => null, allHeaders: async () => ({}), headers: () => ({}),
    response: async () => response, failure: () => ({errorText: 'net::ERR_ABORTED'})});
  const reply = {status: () => 204, body: async () => { throw new Error('no body'); }, allHeaders: async () => ({'access-control-allow-origin': '*'}), headers: () => ({})};
  for (const req of [request('https://files.example.test/', reply), request('https://files.example.test/none', null)]) { context.emit('request', req); context.emit('requestfailed', req); }
  await rec.flush();
  const [kept, lost] = rec.result().entries.sort((a, b) => a.url.localeCompare(b.url));
  assert.equal(kept.status, 204);
  assert.equal(kept.failed, false, 'a reply that came is replayed as that reply');
  assert.equal(kept.error, 'net::ERR_ABORTED');
  assert.equal(lost.failed, true);
  assert.equal(lost.status, 0);
});

test('a third-party prefetch of code is kept (the page runs it from the prefetch cache); a real ping is still dropped', () => {
  const doc = {method: 'GET', url: 'https://apply.jobs.test/j/1', type: 'document', mode: 'navigate', status: 200, size: 3, hash: 'd', headers: {'content-type': 'text/html'}};
  const chunk = {method: 'GET', url: 'https://cdn.other.test/releases/job.abc.chunk.js', type: 'other', mode: 'no-cors', status: 200, size: 9, hash: 'c', headers: {'content-type': 'application/javascript'}};
  const ping = {method: 'POST', url: 'https://bat.bing.test/action', type: 'ping', mode: 'no-cors', status: 204, size: 0, hash: '', headers: {}};
  const gif = {method: 'GET', url: 'https://ads.other.test/conv;id=1', type: 'fetch', mode: 'no-cors', status: 200, size: 43, hash: 'g', headers: {'content-type': 'image/gif'}};
  assert.equal(prefetchedCode(chunk), true);
  assert.equal(prefetchedCode({...chunk, headers: {}, url: 'https://cdn.other.test/x.css?v=2'}), true, 'by its file name when no content type was kept');
  assert.equal(prefetchedCode(ping), false);
  assert.equal(prefetchedCode(gif), false);
  const {entries} = keepRecord({entries: [doc, chunk, ping, gif], bodies: new Map([['d', Buffer.from('<p>')], ['c', Buffer.from('let a = 1;')], ['g', Buffer.from('GIF89a')]])});
  const by = Object.fromEntries(entries.map(entry => [entry.url, entry.dropped || 'kept']));
  assert.equal(by[chunk.url], 'kept', 'Starling, 14 Oct 2026: 25 Workable chunks dropped, then 404 on the replay');
  assert.equal(by[ping.url], 'beacon');
  assert.equal(by[gif.url], 'beacon');
});

test('a redirect sent as raw UTF-8 is handed back as the browser read it, not double-encoded (Breitling, 14 Oct 2026)', () => {
  // The recorder reads header bytes as Latin-1: "Genève" arrives as "GenÃ¨ve"; the live browser followed /Genève/ (%C3%A8).
  assert.equal(headerText('/job/Geneva-Universal-GenÃ¨ve-Grand-Vendeur/1432-en_GB/'), '/job/Geneva-Universal-Genève-Grand-Vendeur/1432-en_GB/');
  assert.equal(new URL(headerText('/job/GenÃ¨ve/'), 'https://careers.example.com/').pathname, '/job/Gen%C3%A8ve/');
  assert.equal(headerText('/job/plain-ascii/?a=1'), '/job/plain-ascii/?a=1', 'ASCII untouched');
  assert.equal(headerText('/café'), '/café', 'a lone Latin-1 byte that is not UTF-8 is kept as it was');
  assert.equal(headerText('/already/Genève'), '/already/Genève', 'a real character above Latin-1 is never re-read');
  assert.equal(headerText(undefined), '');
});

test('settle waits for a request still in flight, so a press the site answers late is recorded; a never-answered one is counted, not waited for forever', async () => {
  const {EventEmitter} = await import('node:events');
  const context = new EventEmitter(), rec = netRecorder(context, {startedAt: 0});
  const request = url => ({url: () => url, method: () => 'POST', resourceType: () => 'fetch', postDataBuffer: () => null, allHeaders: async () => ({}), headers: () => ({}),
    response: async () => ({status: () => 200, body: async () => Buffer.from('{}'), allHeaders: async () => ({'content-type': 'application/json'}), headers: () => ({})}), failure: () => null});
  const slow = request('https://jobs.example.test/api/apply'), stuck = request('https://jobs.example.test/api/never');
  context.emit('request', slow); setTimeout(() => context.emit('requestfinished', slow), 60);
  const settled = await rec.settle(1000, {pollMs: 10});
  await rec.flush();
  assert.equal(settled.unfinished, 0);
  assert.ok(settled.waitedMs >= 50, 'it waited for the late answer');
  assert.ok(rec.result().entries.some(one => one.url.endsWith('/api/apply')), 'the late answer is in the record');
  context.emit('request', stuck);
  const capped = await rec.settle(80, {pollMs: 10});
  assert.equal(capped.unfinished, 1);
  assert.deepEqual(capped.kinds, {fetch: 1}, 'the open request by its resource type, never its address');
  assert.ok(!JSON.stringify(capped).includes('/api/never'));
  assert.ok(capped.waitedMs < 400, 'capped');
  assert.equal((await rec.settle(0)).unfinished, 1);
});

// A fake context: the replay's one route handler, driven with fake requests (no browser).
async function replayOf(entries, bodies = new Map()) {
  const {netReplay} = await import('../../lib/net-record.mjs');
  let handler = null;
  const context = {routeWebSocket: async () => {}, route: async (_pattern, fn) => { handler = fn; }};
  const {counts} = await netReplay(context, {entries, bodies}, {});
  const serve = async (url, type = 'script') => {
    const done = {};
    await handler({request: () => ({url: () => url, method: () => 'GET', allHeaders: async () => ({}), headers: () => ({}), postDataBuffer: () => null, resourceType: () => type, isNavigationRequest: () => false}),
      fulfill: async reply => { done.reply = reply; }, continue: async () => { done.continued = true; }, abort: async () => { done.aborted = true; }});
    return done;
  };
  return {counts, serve};
}
const reply = (url, status, headers = {}, hash = '', type = 'script') => ({method: 'GET', url, status, headers, hash, type, bodyKey: '', waitMs: 0, startMs: 0});

test('a recorded redirect of a script, a fetch and a font is followed inside the record: the original request gets the final reply, its CORS headers included (Workday, 14 Oct 2026)', async () => {
  const bodies = new Map([['aaa', Buffer.from('window.ran=1')], ['bbb', Buffer.from('{"lang":"en"}')]]);
  const {counts, serve} = await replayOf([
    reply('https://cdn.example.test/app.js', 307, {location: '/v2/app.js'}),
    reply('https://cdn.example.test/v2/app.js', 200, {'content-type': 'text/javascript'}, 'aaa'),
    reply('https://api.example.test/lang.json', 307, {location: 'https://static.example.test/v2/lang.json'}, '', 'fetch'),
    reply('https://static.example.test/v2/lang.json', 200, {'content-type': 'application/json', 'access-control-allow-origin': '*'}, 'bbb', 'fetch'),
  ], bodies);
  const script = await serve('https://cdn.example.test/app.js');
  assert.deepEqual([script.reply.status, script.reply.body.toString()], [200, 'window.ran=1'], 'a relative Location, resolved against the request');
  const fetched = await serve('https://api.example.test/lang.json', 'fetch');
  assert.equal(fetched.reply.status, 200);
  assert.equal(fetched.reply.headers['access-control-allow-origin'], '*', 'the cross-origin target\'s CORS header is on the reply');
  assert.deepEqual(counts.notRecorded, []);
  assert.equal(counts.redirects, 2);
});

test('a redirect whose target is not in the record, or that loops, is counted as not recorded and answered 404', async () => {
  const {counts, serve} = await replayOf([
    reply('https://cdn.example.test/gone.js', 307, {location: '/v9/gone.js'}),
    reply('https://cdn.example.test/loop.js', 307, {location: '/loop.js'}),
  ]);
  assert.equal((await serve('https://cdn.example.test/gone.js')).reply.status, 404);
  assert.equal((await serve('https://cdn.example.test/loop.js')).reply.status, 404);
  assert.equal(counts.notRecorded.length, 2);
  assert.match(counts.notRecorded[0], /redirect target of script/);
});

// What Chrome's inspector hands the recorder for a text reply with no charset in its Content-Type: the bytes read as windows-1252, then re-encoded as UTF-8
// (Aldi's server-action reply, 15 Oct 2026: the page title became "dÃ©tail â€“" on the replay, live it read "détail –").
const asRecorded = real => Buffer.from(new TextDecoder('windows-1252').decode(real), 'utf8');
const REAL = Buffer.from('{"title":"Apprenti(e) du commerce de détail (CFC ou AFP) – ALDI SUISSE ✓ ü"}', 'utf8');

test('an unlabeled text reply the inspector double-encoded gets its real bytes back; labeled, genuine Latin-1, binary and clean replies are left alone, and a second repair changes nothing', () => {
  const stored = asRecorded(REAL);
  assert.ok(stored.toString().includes('dÃ©tail'), 'the fixture is the double-encoded shape');
  for (const type of ['text/x-component', 'application/json', 'text/html', 'application/javascript', '', undefined, null]) {   // '' / undefined: a reply served with no Content-Type at all
    const fixed = repairUnlabeledText(stored, type);
    assert.deepEqual(fixed, REAL, String(type));
    assert.deepEqual(repairUnlabeledText(fixed, type), REAL, `${type}: idempotent`);
  }
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xc3, 0xa9, 0xff, 0xfe]);
  assert.equal(repairUnlabeledText(png, ''), png, 'a binary body with no type is never rewritten');
  assert.equal(repairUnlabeledText(stored, 'text/x-component; charset=utf-8'), stored, 'a labeled reply was decoded right: left alone');
  assert.equal(repairUnlabeledText(stored, 'image/png'), stored, 'binary types are never touched');
  const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]);   // "café" as one byte each: not the image of valid UTF-8
  assert.equal(repairUnlabeledText(latin1, 'text/plain'), latin1, 'a genuinely Latin-1 reply stays as it is');
  const ascii = Buffer.from('{"a":1}');
  assert.equal(repairUnlabeledText(ascii, 'application/json'), ascii);
  assert.equal(repairUnlabeledText(null, 'text/plain'), null);
});

test('the recorder stores the real bytes of an unlabeled text reply; the replay hands the same bytes back even from an older record, and counts the repair', async () => {
  const {EventEmitter} = await import('node:events');
  const context = new EventEmitter(), rec = netRecorder(context, {startedAt: 0});
  const request = {url: () => 'https://conv.example.test/application/1', method: () => 'POST', resourceType: () => 'fetch', postDataBuffer: () => null, allHeaders: async () => ({}), headers: () => ({}),
    response: async () => ({status: () => 200, body: async () => asRecorded(REAL), allHeaders: async () => ({'content-type': 'text/x-component'}), headers: () => ({})}), failure: () => null};
  context.emit('request', request); context.emit('requestfinished', request);
  await rec.flush();
  const {entries, bodies} = rec.result();
  assert.deepEqual(bodies.get(entries[0].hash), REAL, 'recorded right');
  assert.equal(entries[0].size, REAL.length);
  // the same reply served with no Content-Type header at all (a UTF-8 page without a charset header or a type)
  const bare = netRecorder(context, {startedAt: 0});
  const noType = {...request, url: () => 'https://conv.example.test/application/2', response: async () => ({status: () => 200, body: async () => asRecorded(REAL), allHeaders: async () => ({}), headers: () => ({})})};
  context.emit('request', noType); context.emit('requestfinished', noType);
  await bare.flush();
  const second = bare.result();
  assert.deepEqual(second.bodies.get(second.entries.find(one => one.url.endsWith('/2')).hash), REAL, 'recorded right with no Content-Type');
  // an older record (published before the repair) holds the double-encoded bytes; the replay serves the real ones
  const old = {method: 'GET', url: 'https://conv.example.test/application/1', status: 200, headers: {'content-type': 'text/x-component'}, hash: 'old', type: 'fetch', bodyKey: '', waitMs: 0, startMs: 0};
  const {counts, serve} = await replayOf([old], new Map([['old', asRecorded(REAL)]]));
  const served = await serve('https://conv.example.test/application/1', 'fetch');
  assert.deepEqual(served.reply.body, REAL);
  assert.equal(counts.repaired, 1, 'the replay counts the replies it repaired');
});

// Cookies (owner decision, 15 Oct 2026): a record keeps the first-party cookies a page script can read (an A/B flag), never an HttpOnly one (a login, a session).
test('a non-HttpOnly first-party cookie is kept; an HttpOnly one, a third-party domain, a person\'s value, a deleted one and an over-long one never are', () => {
  const header = ['ab_experiments=CHI-2258=off; Path=/; Secure', 'sid=SECRET; Path=/; HttpOnly', 'track=1; Domain=.ads.other.test; Path=/', 'who=ada.owner@gmail.com; Path=/',
    'gone=x; Path=/; Max-Age=0', `long=${'a'.repeat(2000)}; Path=/`, 'site=yes; Domain=.jobs.example.test; Path=/en'].join('\n');
  const kept = cookiesOf(header, 'https://www.jobs.example.test/vacancy', new Map([['ada.owner@gmail.com', 'email']]));
  assert.deepEqual(kept.map(one => one.name), ['ab_experiments', 'site']);
  assert.deepEqual(kept[0], {name: 'ab_experiments', value: 'CHI-2258=off', path: '/', secure: true});
  assert.equal(kept[1].domain, 'jobs.example.test');
  assert.ok(!JSON.stringify(kept).includes('SECRET'), 'an HttpOnly value never reaches the record');
});

test('keepRecord keeps a first-party entry\'s cookies and drops a third party\'s', () => {
  const cookies = [{name: 'ab', value: '1', path: '/', secure: false}];
  const {entries} = keepRecord({bodies: new Map(), entries: [entry({cookies, hash: ''}), entry({url: 'https://cdn.other.test/x.js', type: 'script', cookies, hash: ''})]});
  assert.deepEqual(entries.find(one => one.type === 'document').cookies, cookies);
  assert.equal(entries.find(one => one.type === 'script').cookies, undefined);
});

test('the replay sets a recorded cookie in the browser when it serves the reply that set it', async () => {
  const {netReplay} = await import('../../lib/net-record.mjs');
  let handler = null; const set = [];
  const context = {routeWebSocket: async () => {}, route: async (_p, fn) => { handler = fn; }, addCookies: async list => { set.push(...list); }};
  await netReplay(context, {entries: [{...reply('https://www.jobs.example.test/vacancy', 200, {'content-type': 'text/html'}, '', 'document'), cookies: [{name: 'ab', value: 'off', path: '/', secure: true}]}], bodies: new Map()}, {});
  await handler({request: () => ({url: () => 'https://www.jobs.example.test/vacancy', method: () => 'GET', allHeaders: async () => ({}), headers: () => ({}), postDataBuffer: () => null, resourceType: () => 'document', isNavigationRequest: () => false}),
    fulfill: async () => {}, continue: async () => {}, abort: async () => {}});
  assert.deepEqual(set, [{name: 'ab', value: 'off', domain: 'www.jobs.example.test', path: '/', secure: true}]);
});
