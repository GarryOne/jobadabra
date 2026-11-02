// lib/report-scrub.js: a "Report this form" record after the scrub holds none of a fake person's own values, and the last gate stops what the scrub missed (spec 2026-10-15-report-this-form.md §2, §7).
// The person here is invented (Rosalind Quill); nothing real is read.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {lastGate, personalHits, scrubRecord, scrubUrl} from '../lib/report-scrub.js';
import {EMAIL} from '../lib/live-capture.js';
import {ownerValuesOf} from '../lib/owner-values.js';

const TEXTS = ['full name: Rosalind Quill\nemail: rosalind.quill@mailbox.test\nphone: +41 79 555 01 23\nLocation: Port Vale, Atlantis\n'];
const values = ownerValuesOf(TEXTS);
const entry = (over = {}) => ({method: 'GET', url: 'https://jobs.example.test/apply?token=abc123def456ghi789&lang=en', type: 'document', mode: 'navigate', startMs: 0, waitMs: 5, bodyKey: 'txt:aaaa', status: 200, failed: false,
  headers: {'content-type': 'text/html', 'set-cookie': 'x=1'}, hadCookie: true, hash: '', size: 0, ...over});
const HTML = '<h1>Welcome back, Rosalind</h1><form><input name="first" value="Rosalind"><input name="mail" type="email" value="rosalind.quill@mailbox.test"><input type="submit" value="Send application">'
  + '<textarea name="why">I live in Port Vale and love QUILL things</textarea><select><option>A</option><option selected>Port Vale</option></select></form><p>Call +41 79 555 01 23 or hr@company.test</p>';
const JSON_REPLY = JSON.stringify({user: {name: 'Rosalind Quill', cv: 'Quill_Rosalind_CV.pdf', city: 'Port Vale'}});
const SCRIPT = 'const q = 1; const boot = {"mail":"rosalind.quill@mailbox.test","who":"Rosalind Quill"};';
const record = () => {
  const bodies = new Map([['h', Buffer.from(HTML)], ['j', Buffer.from(JSON_REPLY)], ['s', Buffer.from(SCRIPT)]]);
  return {bodies, entries: [entry({hash: 'h', size: HTML.length}),
    entry({url: 'https://jobs.example.test/api/me?email=rosalind.quill@mailbox.test', type: 'fetch', headers: {'content-type': 'application/json'}, hash: 'j', size: JSON_REPLY.length}),
    entry({url: 'https://jobs.example.test/app.js', type: 'script', headers: {'content-type': 'application/javascript'}, hash: 's', size: SCRIPT.length})]};
};
const everything = ({entries, bodies}) => JSON.stringify(entries) + [...bodies.values()].map(body => body.toString('utf8')).join('\n');

test('a fake person\'s name, e-mail, phone, city, CV file name and typed values are not in the scrubbed record', () => {
  const out = scrubRecord(record(), values), text = everything(out);
  for (const own of [/rosalind/i, /Quill/, /QUILL/, /mailbox\.test/i, /555 01 23/, /port vale/i, /atlantis/i, /token=abc/, /hr@company/]) assert.ok(!own.test(text), `left in the record: ${own}`);
  assert.deepEqual(lastGate(out, values), [], 'the gate finds nothing after a good scrub');
  assert.ok(out.stats.removed.typed >= 3 && out.stats.removed.own > 0 && out.stats.removed.contacts > 0 && out.stats.removed.urls > 0, JSON.stringify(out.stats.removed));
});

test('the page keeps its shape: a button\'s own wording, a script\'s identifiers, host and path, the query keys', () => {
  const out = scrubRecord(record(), values), page = out.bodies.get(out.entries[0].hash).toString('utf8'), script = out.bodies.get(out.entries[2].hash).toString('utf8');
  assert.match(page, /value="Send application"/);
  assert.match(page, /<select><option>A<\/option><option>/);
  assert.match(script, /const q = 1/, 'a script\'s code is left as it was');
  assert.equal(out.entries[0].url, 'https://jobs.example.test/apply?token=<v>&lang=<v>');
  assert.ok(out.entries.every(one => one.bodyKey === '' && !('set-cookie' in one.headers)), 'no body key, no cookie');
});

test('the last gate: a record the scrub did not clean is stopped, by kind only', () => {
  const hits = lastGate(record(), values);
  assert.ok(hits.length >= 4, JSON.stringify(hits));
  assert.ok(hits.some(hit => hit.kind === 'name') && hits.some(hit => hit.kind === 'email') && hits.some(hit => hit.kind === 'location'));
  assert.ok(!JSON.stringify(hits).match(/rosalind|quill|port vale/i), 'a hit names its kind, never the value');
});

test('scrubUrl: query values and fragment gone, e-mail and id-like path parts named', () => {
  assert.equal(scrubUrl('https://a.example.test/u/jane.doe@mail.test/x?a=1&b=2#frag'), 'https://a.example.test/u/<id>/x?a=<v>&b=<v>');
  assert.equal(scrubUrl('https://a.example.test/o/9f8e7d6c5b4a3b2c1d/apply'), 'https://a.example.test/o/<id>/apply');
  assert.equal(scrubUrl('/relative/path?x=1'), '/relative/path?x=<v>');
});

// Review of #798 (jobadabra-cc, 15 Oct 2026): the scrub fails closed.
const one = (type, body, over = {}) => ({bodies: new Map([['b', Buffer.isBuffer(body) ? body : Buffer.from(body)]]), entries: [entry({type: 'fetch', url: 'https://jobs.example.test/x', headers: type ? {'content-type': type} : {}, hash: 'b', size: 9, ...over})]});
const gone = out => out.entries.every(item => item.hash === '' && item.size === 0) && out.bodies.size === 0;

test('1. a body whose type the scrub does not understand is dropped, the entry kept with size 0', () => {
  const cv = Buffer.from('%PDF-1.4 Rosalind Quill CV');
  const b64 = Buffer.from('Rosalind Quill, Port Vale, my CV. '.repeat(2)).toString('base64');
  for (const type of ['', 'application/octet-stream', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) {
    const out = scrubRecord(one(type, cv), values);
    assert.ok(gone(out), `kept a ${type || 'typeless'} body`);
    assert.equal(out.stats.removed.binary, 1);
    assert.equal(out.entries.length, 1);
  }
  const wrapped = scrubRecord(one('application/json', JSON.stringify({file: b64})), values);
  assert.deepEqual(lastGate(wrapped, values), [], 'base64 inside JSON is decoded, cleaned and written back (19 Oct 2026); the gate still searches it');
  assert.ok(lastGate(one('application/json', JSON.stringify({file: b64})), values).length > 0, 'the same blob uncleaned is refused');
  const fine = scrubRecord(one('font/woff2', Buffer.from([0, 1, 2, 3])), values);
  assert.equal(fine.entries[0].size, 4, 'a font stays');
});

test('2. encoded copies are replaced or refused: URL-encoded, + for a space, JSON-escaped, HTML entities', () => {
  const page = '<p>rosalind.quill&#64;mailbox.test and rosalind.quill%40mailbox.test and rosalind.quill\\u0040mailbox.test</p><a href="/x?n=Rosalind+Quill&amp;c=Port%20Vale">x</a>'
    + '<p>Rosalind &amp; co, Port&nbsp;Vale, call 41&nbsp;79&nbsp;555&nbsp;01&nbsp;23</p>';
  const out = scrubRecord(one('text/html', page), values), text = everything(out);
  assert.ok(!/rosalind|quill|mailbox|port.?vale|555/i.test(text), `left: ${text}`);
  assert.deepEqual(lastGate(out, values), []);
  const raw = one('font/woff2', 'x Quill%20Rosalind x rosalind.quill%40mailbox.test x &#82;osalind x Port+Vale');
  const kinds = lastGate(raw, values).map(hit => hit.kind);
  for (const kind of ['name', 'email', 'location']) assert.ok(kinds.includes(kind), `the gate missed ${kind} in an encoded form: ${kinds}`);
});

test('3. the gate searches every kept body, as UTF-8 and as latin1, whatever its type', () => {
  for (const type of ['', 'application/pdf', 'font/woff2', 'image/avif']) assert.ok(lastGate(one(type, Buffer.from('xx Rosalind xx', 'latin1')), values).length > 0, `a ${type || 'typeless'} body was not searched`);
  assert.ok(lastGate(one('font/woff2', Buffer.from('José Rosalind'.replace('José', 'Jos\xe9'), 'latin1')), values).length > 0);
});

test('4. a lone name word in code: standing as text it is replaced; as part of an identifier (x.quill, quill()) it is code, left alone and not a hit', () => {
  const as = 'const who = "Quill"; const list = ["a", Quill, "b"]; x.quill = 2; quill(); const a_quill = 1;';
  const out = scrubRecord(one('application/javascript', as), values), code = out.bodies.get(out.entries[0].hash).toString();
  assert.match(code, /who = "Candidate"/);
  assert.match(code, /x\.quill = 2; quill\(\); const a_quill = 1;/, 'identifiers keep their shape');
  assert.deepEqual(lastGate(out, values), [], 'what the scrub left is not the person');
  assert.deepEqual(lastGate(one('application/javascript', 'const who = "Quill";'), values).map(hit => hit.kind), ['name-in-code'], 'an unscrubbed lone word in text position still blocks');
});

test('5. a session token, CSRF token or credential in a body goes by its field name or JWT shape; the page keeps its shape', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlMTIz';
  const api = JSON.stringify({ok: true, accessToken: 'Zk39sd0QpL2mXv81aa', csrfToken: 'q8w7e6r5t4y3', title: 'Engineer', nested: {sessionId: 'S3SS10N-ID-99887766'}});
  const page = `<meta name="csrf-token" content="Xy12ab34Cd56Ef78"><form><input type="hidden" name="authenticity_token" value="AbCdEf123456789"></form><script>window.boot={"apiKey":"AKIAFAKEKEY0001","jobTitle":"Engineer"};fetch(u,{headers:{Authorization:"Bearer abcdef0123456789xyz"}});var j="${jwt}";</script>`;
  const form = 'lang=en&sessionid=0123456789abcdef&next=%2Fapply';
  const bodies = new Map([['a', Buffer.from(api)], ['p', Buffer.from(page)], ['f', Buffer.from(form)]]);
  const record = {bodies, entries: [entry({url: 'https://jobs.example.test/api/session', type: 'fetch', headers: {'content-type': 'application/json'}, hash: 'a', size: api.length}),
    entry({url: 'https://jobs.example.test/apply', hash: 'p', size: page.length}), entry({url: 'https://jobs.example.test/post', type: 'fetch', headers: {'content-type': 'application/x-www-form-urlencoded'}, hash: 'f', size: form.length})]};
  assert.ok(lastGate(record).some(hit => hit.kind === 'token'), 'the gate sees them before the scrub');
  const out = scrubRecord(record), text = everything(out);
  for (const secret of [/Zk39sd0QpL2mXv81aa/, /q8w7e6r5t4y3/, /S3SS10N-ID/, /Xy12ab34Cd56Ef78/, /AbCdEf123456789/, /AKIAFAKEKEY0001/, /abcdef0123456789xyz/, /eyJhbGci/, /0123456789abcdef/]) assert.ok(!secret.test(text), `left: ${secret}`);
  assert.match(text, /"title":"Engineer"/); assert.match(text, /"jobTitle":"Engineer"/); assert.match(text, /next=%2Fapply/);
  assert.ok(out.stats.removed.tokens >= 8, JSON.stringify(out.stats.removed));
  assert.deepEqual(lastGate(out), [], 'nothing is left for the gate');
});

// #1016: the key list held a bare "sid", a substring of residenceCountry / president / considered, so the person's own answers became <token>.
test('a field name that merely contains "sid" is not a credential; a real sid, PHPSESSID or session key still is', () => {
  const body = JSON.stringify({residenceCountry: 'Portugal', president: 'Rosa Alvarez', considered: 'Yes please', secretary: 'Maria Costa', possessionOf: 'a car and a house', sid: 's:AbCdEf0123456789xyz', PHPSESSID: 'abcdef0123456789abcdef', 'connect.sid': 's%3AAbCdEf0123456789xyz'});
  const record = {bodies: new Map([['a', Buffer.from(body)]]), entries: [entry({url: 'https://jobs.example.test/api/me', type: 'fetch', headers: {'content-type': 'application/json'}, hash: 'a', size: body.length})]};
  const text = everything(scrubRecord(record));
  for (const kept of ['Portugal', 'Rosa Alvarez', 'Yes please', 'Maria Costa', 'a car and a house']) assert.ok(text.includes(kept), `lost: ${kept}`);
  for (const gone of ['AbCdEf0123456789xyz', 'abcdef0123456789abcdef']) assert.ok(!text.includes(gone), `left: ${gone}`);
});

test('a package version in a CDN address (name@1.142.5) is not an e-mail, a real address still is', () => {
  const cdn = 'https://cdn.example.test/npm/@scope/theme@1.142.5/fonts/72-Regular.woff2';
  assert.deepEqual(personalHits(cdn, {values: new Map()}), []);
  for (const mail of ['rosalind.quill@mailbox.test', 'a@b.co', 'x+y@mail.example.test']) assert.equal(mail.match(EMAIL)?.[0], mail);
  assert.equal(cdn.match(EMAIL), null);
});

// 17 Oct 2026: after fonts were no longer read as addresses, the refill's gate still stopped Recruitee on a 1.1 MB captcha script: a long base64 run in it (an embedded binary) decodes to bytes that spell
// "x@hZ.B". An address found only in the bytes of a decoded run counts when the text around it is text; one inside decoded text (JSON, a PDF's plain parts) still counts.
test('an address read out of the garbage bytes of a decoded base64 run is not a hit; one inside decoded text is', () => {
  const garbage = Buffer.from([0x9c, 0x01, 0xfe, 0x80, ...Buffer.from('xq@hZ.B'), 0x03, 0xff, 0xaa, 0x00, 0x91, 0xe2, 0x07, ...Array(30).fill(0xd4)]).toString('base64');
  assert.deepEqual(personalHits(`var data = "${garbage}";`, {code: true}), [], 'binary noise is not a person');
  const text = Buffer.from(JSON.stringify({applicant: 'someone.real@gmail.com', pad: 'x'.repeat(40)})).toString('base64');
  assert.deepEqual(personalHits(`var data = "${text}";`, {code: true}), ['email'], 'an address inside decoded text still stops the record');
});

// 17 Oct 2026, the full refill: five rows were refused at the publish gate for "email in url": a request to an address checker carries the offline runs' fake applicant,
// ada.tester@example.test. The example domains (RFC 2606, with example.test) are never a person's; a real provider's address still stops the record.
test('an address on a reserved example or test domain is no person; a real one is', () => {
  for (const fake of ['https://checker.example/address/validate?address=ada.tester%40example.test', 'mail ada.tester@example.test now', 'a@example.org'])
    assert.deepEqual(personalHits(fake, {values: new Map()}), [], fake);
  for (const real of ['https://checker.example/address/validate?address=igor.someone%40gmail.com', 'mail someone@company.ch now', 'rosalind.quill@mailbox.test'])
    assert.deepEqual(personalHits(real, {values: new Map()}), ['email'], real);
});

// A filled form is full of the person's own values (19 Oct 2026: the owner's Report on a Greenhouse form answered "could not remove everything personal"). Whatever the gate looks for, the scrub must have replaced.
const ACCENTED = ownerValuesOf(['full name: Zoë Brontë\nemail: zoe.bronte@mailbox.test\nphone: +41 79 555 01 23\nLocation: Chișinău, Moldova\n']);
const FILLED_HTML = '<form><label>Full name</label><input name="n" value="Zoë Brontë"><p>Hello Zoë, from Chișinău (Moldova)</p><select><option selected>Male</option></select>'
  + '<input type="checkbox" checked> By checking this box I consent <textarea name="why">Brontë here: reach me on 0795550123</textarea></form>';
const FILLED_JSON = JSON.stringify({countries: ['Germany', 'Moldova', 'Romania'], cities: ['Chișinău', 'Cluj'], applicant: {first: 'Zoë', last: 'Brontë', gender: 'Male'}});
const FILLED_SCRIPT = 'var bronte = 1; const countries = ["Germany","Moldova","Romania"]; const label = \'Chisinau\'; function f() { return bronte; }';
const filled = () => {
  const bodies = new Map([['h', Buffer.from(FILLED_HTML)], ['j', Buffer.from(FILLED_JSON)], ['s', Buffer.from(FILLED_SCRIPT)]]);
  return {bodies, entries: [entry({hash: 'h', size: 1}), entry({url: 'https://jobs.example.test/api/c', type: 'fetch', headers: {'content-type': 'application/json'}, hash: 'j', size: 1}),
    entry({url: 'https://jobs.example.test/app.js', type: 'script', headers: {'content-type': 'application/javascript'}, hash: 's', size: 1})]};
};

test('a filled form with accents, a country list and demographic answers goes through the gate with every personal value replaced', () => {
  const out = scrubRecord(filled(), ACCENTED), text = everything(out);
  for (const own of [/zo[eë]/i, /bront/i, /chi[sș]in/i, /moldova/i, /555 ?01 ?23|0795550123/, /mailbox/]) assert.ok(!own.test(text), `left in the record: ${own} in ${[...out.bodies.values()].map(b => b.toString()).join(' || ')}`);
  assert.match(text, /Male/, 'a demographic answer is the form\'s own option, not the person');
  assert.match(text, /Germany/);
  assert.deepEqual(lastGate(out, ACCENTED), [], 'the gate finds nothing after the scrub');
});

test('a value the scrub cannot clean is refused with its kind and where it sits', () => {
  const kept = {bodies: new Map([['p', Buffer.from('{"note":"' + 'zoe.bronte' + '\\u0040mailbox.test"}')], ['n', Buffer.from(Buffer.from('Hello Brontë, said the page, in plain text here').toString('base64'))]]),
    entries: [entry({url: 'https://jobs.example.test/x', type: 'fetch', headers: {'content-type': 'application/json'}, hash: 'p', size: 1}), entry({url: 'https://jobs.example.test/y', type: 'fetch', headers: {'content-type': 'application/json'}, hash: 'n', size: 1})]};
  const hits = lastGate(kept, ACCENTED);
  assert.deepEqual(hits.map(hit => `${hit.kind}:${hit.in}`).sort(), ['email:body', 'name:body'], 'a value that stayed (encoded where the scrub did not look) is refused with its kind and where');
});

// 19 Oct 2026: after the bare-% fix the owner's Report on a Doctolib form answered "Still found: a phone number, a sign-in token". The gate decodes forms the scrub never rewrote (a base64 run, a URL-encoded
// body, a long number in a URL path). One loop over every place and form the gate looks in × every shape it flags: after scrubRecord, lastGate is clear. A new place or form without the scrub's twin fails here.
const SHAPES = {
  email: 'someone.real@gmail.com', ownEmail: 'rosalind.quill@mailbox.test', phone: '+41 79 555 01 23', longNumber: '123456789012', jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlMTIz',
  bearer: 'Bearer abcdef0123456789xyz', secretPair: 'sessionid=0123456789abcdef', quotedSecret: '"accessToken":"Zk39sd0QpL2mXv81aa"', name: 'Rosalind Quill', place: 'Port Vale',
};
const PLACES = {   // payload -> [{url, type, body}]; a body is text or a Buffer
  'url path': s => ({url: `https://jobs.example.test/jobs/${encodeURIComponent(s).replace(/%40/g, '@')}/apply`, type: 'text/html', body: '<p>ok</p>'}),
  'url path (segment inside a word)': s => ({url: `https://jobs.example.test/p/${encodeURIComponent(s.replace(/\s+/g, '-'))}-x/apply`, type: 'text/html', body: '<p>ok</p>'}),
  'url query key': s => ({url: `https://jobs.example.test/apply?${encodeURIComponent(s)}=1`, type: 'text/html', body: '<p>ok</p>'}),
  'body plain': s => ({url: 'https://jobs.example.test/a', type: 'text/html', body: `<p>${s}</p>`}),
  'body JSON-quoted': s => ({url: 'https://jobs.example.test/a', type: 'application/json', body: JSON.stringify({v: s})}),
  'body URL-encoded': s => ({url: 'https://jobs.example.test/a', type: 'application/x-www-form-urlencoded', body: `lang=en&a=${encodeURIComponent(s)}`}),
  'body URL-encoded inside JSON': s => ({url: 'https://jobs.example.test/a', type: 'application/json', body: JSON.stringify({q: `x=1&a=${encodeURIComponent(s)}&y=2`})}),
  'body base64 in JSON': s => ({url: 'https://jobs.example.test/a', type: 'application/json', body: JSON.stringify({blob: Buffer.from(`   ${s}   `.padEnd(60)).toString('base64')})}),
  'body base64 in a script': s => ({url: 'https://jobs.example.test/a.js', type: 'application/javascript', body: `var d = "${Buffer.from(`   ${s}   `.padEnd(60)).toString('base64')}";`}),
  'body latin1 bytes': s => ({url: 'https://jobs.example.test/a', type: 'text/html', body: Buffer.from(`<p>caf\xe9 ${s}</p>`, 'latin1')}),
};
test('whatever shape the gate flags, in whatever place or decoded form it looks, the scrub leaves the gate clear', () => {
  const missed = [];
  for (const [shape, payload] of Object.entries(SHAPES)) for (const [place, make] of Object.entries(PLACES)) {
    const made = make(payload), body = Buffer.isBuffer(made.body) ? made.body : Buffer.from(made.body);
    const out = scrubRecord({bodies: new Map([['b', body]]), entries: [entry({url: made.url, type: 'fetch', headers: {'content-type': made.type}, hash: 'b', size: body.length})]}, values);
    const hits = lastGate(out, values);
    if (hits.length) missed.push(`${shape} @ ${place}: ${hits.map(hit => `${hit.kind}/${hit.in}`).join(',')}`);
  }
  assert.deepEqual(missed, []);
});

test('a part that cannot be cleaned is left out and counted; a refusal names where and the kind of content, never a value', () => {
  const body = Buffer.from(JSON.stringify({blob: Buffer.from('xx +41 79 555 01 23 '.padEnd(60)).toString('base64')}));
  const out = scrubRecord({bodies: new Map([['b', body]]), entries: [entry({url: 'https://jobs.example.test/a', type: 'fetch', headers: {'content-type': 'application/json'}, hash: 'b', size: body.length})]}, values);
  assert.deepEqual(lastGate(out, values), []);
  const raw = lastGate(one('application/json', 'call +41 79 555 01 23'), values);
  assert.deepEqual(raw.map(hit => `${hit.kind}:${hit.in}:${hit.type}`), ['phone:body:application/json']);
  assert.ok(!JSON.stringify(raw).includes('555'));
});

test('a kept body the scrub cannot rewrite (a font spelling a long number) is left out, counted as unclean, and the preview says so', () => {
  const out = scrubRecord(one('font/woff2', Buffer.from('xx 123456789012 xx')), values);
  assert.ok(gone(out)); assert.equal(out.stats.removed.unclean, 1); assert.deepEqual(lastGate(out, values), []);
  assert.match(fs.readFileSync(new URL('../../extension/panel-report.js', import.meta.url), 'utf8'), /One page part could not be cleaned, so it was left out/);
});
