// A network record is scrubbed on disk before it is published (lib/record-scrub.mjs; the definitions are the product's report scrub, lib/report-scrub.js): the person's own values and any e-mail
// address leave every text body and the record's text files; a changed body gets its new hash; an unchanged one, a number, a script and a binary stay byte for byte; what the scrub cannot rewrite is
// caught by the gate. Also: a signed-in row records its hosts and replays with a FAKE account (lib/test-accounts.mjs replayAccounts), never the Keychain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {sha} from '../../lib/net-keep.js';
import {gateRecordDir, scrubRecordDir} from '../lib/record-scrub.mjs';
import {REPLAY_EMAIL, replayAccounts, signedInHosts} from '../lib/test-accounts.mjs';

const values = new Map([['Rosalind Quill', 'name'], ['+41 79 555 01 23', 'phone']]);
const ADDRESS = 'owner.name+jp@gmail.com';
function recordIn(bodies) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-record-scrub-'));
  fs.mkdirSync(path.join(dir, 'bodies'));
  const entries = bodies.map(({url, type, body}) => { const buffer = Buffer.from(body, 'latin1'), hash = sha(buffer); fs.writeFileSync(path.join(dir, 'bodies', hash), buffer); return {method: 'GET', url, type: 'fetch', status: 200, headers: {'content-type': type}, hash, size: buffer.length}; });
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({name: 'Row', url: 'https://site.example.test/job', entries}));
  fs.writeFileSync(path.join(dir, 'app.log'), `12:00 [extension] fill: typed {"host":"site.example.test"}\n12:01 profile ${ADDRESS}\n`);
  fs.writeFileSync(path.join(dir, 'model-memo.json'), JSON.stringify({abc: {content: [{text: 'no personal value here'}]}}));
  return dir;
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString('latin1');
const FIXTURE = () => [
  {url: 'https://site.example.test/profile', type: 'application/json', body: JSON.stringify({email: ADDRESS, name: 'Rosalind Quill', phone: '+41 79 555 01 23', other: 'kept@example.com'})},
  {url: 'https://site.example.test/page', type: 'text/html', body: `<p>Signed in as ${ADDRESS}</p>`},
  {url: 'https://site.example.test/ids', type: 'application/json', body: JSON.stringify({id: 1792155265346, at: 1792155265346, token: 'x'})},
  {url: 'https://site.example.test/app.min.js', type: 'application/javascript', body: 'const Quill = 1; export default Quill;'},
  {url: 'https://site.example.test/logo.png', type: 'image/png', body: PNG},
];
const filesOf = dir => fs.readdirSync(dir, {recursive: true}).map(name => path.join(dir, name)).filter(file => fs.statSync(file).isFile());

test('the scrub removes the person\'s values and any e-mail from text bodies and files, rehashes only what changed, and leaves numbers, scripts and binaries alone', () => {
  const dir = recordIn(FIXTURE());
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')).entries, hashes = before.map(entry => entry.hash);
  assert.ok(gateRecordDir(dir, values).length > 0, 'the gate sees the address before the scrub');
  const gone = scrubRecordDir(dir, values);
  assert.deepEqual([gone.bodies, gone.files], [2, 1]);   // profile + page, app.log (the memo holds nothing personal)
  assert.ok(gone.contacts >= 3 && gone.own >= 1 && gone.phones === 1, JSON.stringify(gone));
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')).entries;
  assert.notEqual(after[0].hash, hashes[0]); assert.notEqual(after[1].hash, hashes[1]);
  assert.deepEqual(after.slice(2).map(entry => entry.hash), hashes.slice(2), 'a number, a script and a binary keep their hash');
  for (const entry of after) { const body = fs.readFileSync(path.join(dir, 'bodies', entry.hash)); assert.equal(sha(body), entry.hash, 'the file is named by its content'); assert.equal(body.length, entry.size); }
  assert.ok(!fs.existsSync(path.join(dir, 'bodies', hashes[0])) && !fs.existsSync(path.join(dir, 'bodies', hashes[1])), 'a body no entry refers to is removed');
  const profile = JSON.parse(fs.readFileSync(path.join(dir, 'bodies', after[0].hash), 'utf8'));   // still valid JSON
  assert.deepEqual([profile.email, profile.other, profile.phone], ['test.candidate@example.com', 'kept@example.com', '(phone)']);
  for (const file of filesOf(dir)) { const text = fs.readFileSync(file).toString('latin1'); assert.ok(!text.includes(ADDRESS) && !/Rosalind Quill/.test(text), `${path.relative(dir, file)} holds no personal value`); }
  assert.deepEqual(gateRecordDir(dir, values), []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'bodies', after[2].hash), 'utf8')).id, 1792155265346, 'a long number is not a phone');
});

test('what the scrub cannot rewrite is caught by the gate: an address in a URL keeps the row off the release (base64 in a body is rewritten, see below)', () => {
  const dir = recordIn([{url: 'https://site.example.test/state', type: 'application/json', body: JSON.stringify({blob: Buffer.from(`mail ${ADDRESS} end`).toString('base64')})},
    {url: 'https://site.example.test/q?next=owner.name%2Bjp%40gmail.com', type: 'text/html', body: '<p>x</p>'}]);
  scrubRecordDir(dir, values);
  const hits = gateRecordDir(dir, values);
  assert.deepEqual(hits.map(hit => `${hit.kind} in ${hit.in}`), ['email in url']);
});

// Why (27 Oct 2026, owner): the scrub left one address in a recorded Personio page (44 others went) and the publish gate refused the row. The gate reads every decoded form; the scrub only undid ONE layer of "@" encoding.
// A FAKE address in each kind of encoding the gate searches: the scrub must leave the gate nothing, whatever the layers.
test('an address encoded more than once, or inside base64, is scrubbed as well as a plain one', () => {
  const fake = 'jane.fake@acme-test.de', twice = encodeURIComponent(encodeURIComponent(fake));
  const bodies = [
    {url: 'https://site.example.test/a', type: 'text/html', body: `<a href="x?m=${twice}">mail</a>`},
    {url: 'https://site.example.test/b', type: 'text/html', body: '<p>jane.fake&amp;#64;acme-test.de</p>'},
    {url: 'https://site.example.test/c', type: 'application/json', body: JSON.stringify({m: 'jane.fake@acme-test.de'}).replace('@', '\\u0040')},
    {url: 'https://site.example.test/d', type: 'application/json', body: JSON.stringify({blob: Buffer.from(`{"email":"${fake}","n":1}`).toString('base64')})},
    {url: 'https://site.example.test/e', type: 'application/json', body: JSON.stringify({blob: Buffer.from(`{"email":"${fake}"}`).toString('base64url')})},
  ];
  for (const one of bodies) {
    const dir = recordIn([one]), inBody = () => gateRecordDir(dir, values).filter(hit => hit.in === 'body');
    assert.equal(inBody().length, 1, `${one.url}: the gate sees it before`);
    scrubRecordDir(dir, values);
    assert.deepEqual(inBody(), [], `${one.url}: nothing left after`);
  }
});

test('a record with nothing personal is not touched at all', () => {
  const dir = recordIn([{url: 'https://site.example.test/a', type: 'text/html', body: '<p>hello</p>'}]);
  fs.writeFileSync(path.join(dir, 'app.log'), 'nothing here\n');
  const before = fs.readFileSync(path.join(dir, 'record.json'), 'utf8');
  assert.deepEqual(scrubRecordDir(dir, values), {bodies: 0, files: 0, own: 0, contacts: 0, phones: 0});
  assert.equal(fs.readFileSync(path.join(dir, 'record.json'), 'utf8'), before);
});

test('a signed-in row names its hosts, and replays with a fake account for exactly those hosts (never the Keychain)', () => {
  const log = '12:00 [extension] fill: account page: fill-press {"host":"login.example.test","mode":"sign-in","step":"sign_in"}\n12:00 [extension] fill: password filled from the Keychain {"boxes":1,"host":"login.example.test","version":"1"}\n12:01 [extension] fill: typed {"host":"other.example.test"}\n12:02 [extension] fill: password filled from the Keychain {"boxes":1,"host":"login.example.test"}\n'
    + '12:03 [extension] fill: account page: fill {"host":"signup.example.test","mode":"sign-up","step":""}\n12:03 [extension] fill: password filled from the Keychain {"boxes":2,"host":"signup.example.test"}';   // a sign-UP fills a password too: not a sign-in
  assert.deepEqual(signedInHosts(log), ['login.example.test']);
  assert.deepEqual(signedInHosts(''), []);
  const named = replayAccounts({testAccountHosts: ['a.example.test']}, log), derived = replayAccounts({}, log), none = replayAccounts({testAccountHosts: []}, log);
  assert.deepEqual(Object.keys(named), ['a.example.test']);   // the record's own list wins over the log
  assert.deepEqual(Object.keys(derived), ['login.example.test']);   // an older record: from its app log
  assert.deepEqual(none, {});   // a row that did not sign in gets no account, as live
  assert.equal(named['a.example.test'].email, REPLAY_EMAIL);
  assert.notEqual(replayAccounts({testAccountHosts: ['a.example.test']}, '')['a.example.test'].password, named['a.example.test'].password, 'the password is random per run');
});

test('the replay sets its fake accounts before the row runs, the recorder names the signed-in hosts, and the publish scrubs the staged copy before its guard replays it', () => {
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const replay = read('replay-net.mjs'), live = read('lib/live-row.mjs'), publish = read('records-publish.mjs');
  assert.ok(replay.indexOf('JP_TEST_ACCOUNTS = JSON.stringify(replayAccounts(record, liveLog))') > 0 && replay.indexOf('JP_TEST_ACCOUNTS =') < replay.indexOf('await runLiveRow'));
  assert.match(live, /testAccountHosts: signedInHosts\(app\.logText\(\)\)/);
  assert.ok(publish.indexOf('scrubRecordDir(into, values)') > 0 && publish.indexOf('scrubRecordDir(into, values)') < publish.indexOf('replayOf(stage, row.name)'));
  assert.match(publish, /leaks\.has\(row\.name\)/);
});

// 17 Oct 2026: the refill's publish refused every Lever and Recruitee record, "a person's value is left after the scrub (email in body)": the hit was in a font file (Lato-Regular.ttf, served as
// application/octet-stream), whose random bytes spell "x@hZ.B". A binary the site serves as a font, an image or any media (by its type or its first bytes) has no e-mail address in it to find; a body that
// is text with a real address in it, whatever type it is served as, still stops the row.
test('the gate does not read an e-mail address out of the bytes of a font or an image, and still finds one in a body that is text', () => {
  const noise = 'xx@hZ.B\u0001\u0002 more@nS.mdU';
  const font = (type, head) => ({url: 'https://cdn.site.example.test/f.ttf', type, body: head + noise});
  const clean = recordIn([font('application/octet-stream', '\u0000\u0001\u0000\u0000\u0000\u0010'), font('font/ttf', 'abcd'), font('application/octet-stream', 'wOF2\u0000'), {url: 'https://s.example.test/a.png', type: 'application/octet-stream', body: PNG + noise}]);
  assert.deepEqual(gateRecordDir(clean).filter(hit => hit.in === 'body'), [], 'binary files are not read as addresses');
  const leaky = recordIn([{url: 'https://site.example.test/blob', type: 'application/octet-stream', body: `{"who":"${ADDRESS}"}`}]);
  assert.ok(gateRecordDir(leaky).some(hit => hit.in === 'body'), 'an address in a text body served as octet-stream still stops the row');
});
