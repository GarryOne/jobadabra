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
import {sameLengthFake} from '../../lib/live-capture.js';
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
  assert.deepEqual([profile.email, profile.other, profile.phone], [sameLengthFake(ADDRESS), 'kept@example.com', '(phone)']);   // the fake keeps the address's length (live-capture.js sameLengthFake)
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
    {url: 'https://site.example.test/f', type: 'application/json', body: JSON.stringify({blob: Buffer.from(`{"next":"/x?m=${encodeURIComponent(fake)}","n":1}`).toString('base64')})},
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

// 27 Oct 2026: Starling Bank's and a Personio row's guard replays stopped at the posting while live reached the form (0 of 5-6 asks answered): the scrub's "%40 is an @" step ran over the whole
// site bundle (it held a real-looking address, so the body was rewritten) and turned the code's `e%400==0` (modulo 400) into `e@0==0`: the bundle no longer parsed, the page never booted. An
// encoded "@" is written plain only where it stands inside an address; code, styles and `name@2x.png` image names come back byte for byte, the address next to them still goes.
test('the scrub leaves a site bundle\'s %40 arithmetic and @2x file names alone while it removes the address beside them', () => {
  const code = 'const leap=e=>e%4==0&&e%100!=0||e%400==0,mail="support@bank.example-corp.com",ok=1;';
  const css = '.flag{background:url(images/flags@2x.9790563a0e331d13.webp)}';
  const player = 'const k=load("latest/wirewax-embedder-sdk@beta.umd.js");const m="hr@firm.example-corp.com";';
  const dir = recordIn([
    {url: 'https://cdn.site.example.test/careers.js', type: 'application/javascript', body: code},
    {url: 'https://cdn.site.example.test/app.css', type: 'text/css', body: css},
    {url: 'https://cdn.site.example.test/player.js', type: 'application/javascript', body: player},
    {url: 'https://site.example.test/ask', type: 'application/json', body: JSON.stringify({link: 'https://x.example.test/?to=real.person%40mail.example-corp.com&n=1'})},
  ]);
  const entries = () => JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')).entries, bodyOf = entry => fs.readFileSync(path.join(dir, 'bodies', entry.hash), 'utf8');
  scrubRecordDir(dir, values);
  const [js, style, script, json] = entries();
  assert.equal(bodyOf(js), code.replace('support@bank.example-corp.com', sameLengthFake('support@bank.example-corp.com')), 'only the address changed in the bundle');
  assert.equal(bodyOf(style), css, 'an image name with an @ is not an address');
  assert.equal(bodyOf(script), player.replace('hr@firm.example-corp.com', sameLengthFake('hr@firm.example-corp.com')), 'an npm tag on a script file is not an address');
  assert.ok(!bodyOf(json).includes('real.person') && !bodyOf(json).includes('real.person%40'), 'an encoded address is still removed');
  assert.deepEqual(gateRecordDir(dir, values), [], 'the gate is clear after the scrub');
});

// 27 Oct 2026: the same rows' Personio copy: a page body that held an employer's contact address also had every "&nbsp;" written as a space, so the posting text the AI was asked about no longer matched
// the kept answers (0 of 6). A non-breaking space is written plain only where it hides one of the person's own values (a name split by one); everywhere else the page is as the site sent it.
test('the scrub keeps a page\'s &nbsp; as sent, and still finds a name or phone split by one', () => {
  const page = '<p>Alles gut.&nbsp;</p><p>Mail: hr@firm.example-corp.com, z.&nbsp;B. Teams.</p>';
  const split = '<p>Hi Rosalind&nbsp;Quill, call +41&nbsp;79 555 01 23</p>';
  const dir = recordIn([{url: 'https://site.example.test/job', type: 'text/html', body: page}, {url: 'https://site.example.test/me', type: 'text/html', body: split}]);
  scrubRecordDir(dir, values);
  const [first, second] = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')).entries.map(entry => fs.readFileSync(path.join(dir, 'bodies', entry.hash), 'utf8'));
  assert.equal(first, page.replace('hr@firm.example-corp.com', sameLengthFake('hr@firm.example-corp.com')), 'only the address changed');
  assert.ok(!second.includes('Quill') && !second.includes('555 01 23'), 'a value hidden behind a non-breaking space still goes');
  assert.deepEqual(gateRecordDir(dir, values), []);
});

// 27 Oct 2026: a Personio row's guard replay stopped at the posting because the scrub rewrote an "address" inside a base64 run of random bytes (a challenge answer, 38% printable). Bytes that are not text are
// never rewritten, and the gate does not read them as an address either; a name inside a base64 JSON token still goes.
test('the scrub leaves a base64 run of random bytes alone and still cleans a base64 token that holds text', () => {
  const noise = Buffer.from(Array.from({length: 600}, (_, i) => (i * 37 + 11) % 256 | 0x80)); noise.write('abcdef Zq@Xd.yt ghijkl', 300, 'latin1');   // an address with 6 text-like bytes either side, random bytes beyond
  const run = noise.toString('base64'), token = Buffer.from(JSON.stringify({who: ADDRESS, note: 'a person'})).toString('base64');
  const dir = recordIn([{url: 'https://site.example.test/orchestrate', type: 'text/plain', body: `window.x="${run}"`}, {url: 'https://site.example.test/t', type: 'application/json', body: JSON.stringify({token})}]);
  scrubRecordDir(dir, values);
  const [first, second] = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')).entries.map(entry => fs.readFileSync(path.join(dir, 'bodies', entry.hash), 'utf8'));
  assert.equal(first, `window.x="${run}"`, 'random bytes come back byte for byte');
  assert.ok(!Buffer.from(JSON.parse(second).token, 'base64').toString().includes(ADDRESS), 'an address inside a base64 text token goes');
  assert.deepEqual(gateRecordDir(dir, values), []);
});

// 27 Oct 2026: the Personio posting is a Next.js page whose server-components text chunks carry their byte length ("e20:T48e," then exactly 0x48e bytes). The scrub's 25-character fake in place of a 21-character
// address made every later chunk start in the wrong place, React failed to hydrate (error 412) and the posting rendered blank: the replay stopped there. A fake keeps the length of the address it replaces
// (as far as the example domain allows), and the AI's kept answers, keyed by the page text, still match: the key folds every such fake back to the standard one.
test('a scrubbed address keeps its length, and the memo key of the real page equals the key of the scrubbed page', async () => {
  const {normalise} = await import('../../lib/ai/model-memo.js');
  const addresses = ['karriere@pjmueller.de', 'hr@firm.example-corp.com', 'jobs.team.recruiting@some-long-company-name.co.uk', 'a@bc.de'];
  const page = list => `<p>${list.join(' | ')}</p>`;
  const dir = recordIn([{url: 'https://site.example.test/job', type: 'text/html', body: page(addresses)}]);
  scrubRecordDir(dir, values);
  const [entry] = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')).entries, scrubbed = fs.readFileSync(path.join(dir, 'bodies', entry.hash), 'utf8');
  const found = scrubbed.match(/[\w.+-]+@example\.com/g) || [];
  assert.equal(found.length, 4);
  assert.deepEqual(addresses.slice(0, 3).map(item => item.length), found.slice(0, 3).map(item => item.length), 'each fake is as long as its address');
  assert.equal(found[3], 'test.candidate@example.com', 'an address too short for the example domain gets the standard fake');
  assert.equal(normalise(JSON.stringify({text: page(addresses)})), normalise(JSON.stringify({text: scrubbed})), 'the memo key does not move');
  assert.deepEqual(gateRecordDir(dir, values), []);
});

// 27 Oct 2026: in Personio's page data an address follows an escaped ">" (`>privacy@host`) and a new line (`\nmail@host`); the address pattern took the escape's letters ("u003e", "n") as the start of the
// address, so the scrub removed the ">" and the markup after it: React could not hydrate (error 412) and the posting rendered blank. A backslash starts an escape; the escape is not part of the address.
test('the scrub keeps the escape in front of an address (\\u003e, \\x3e, \\n) and replaces only the address', () => {
  const page = 'x="\\u003ca href=\\"mailto:privacy@firm.example-corp.com\\"\\u003eprivacy@firm.example-corp.com\\u003c/a\\u003e\\nhr@firm.example-corp.com\\x3cb\\x3e"';
  const dir = recordIn([{url: 'https://site.example.test/job', type: 'text/html', body: `<script>${page}</script>`}]);
  scrubRecordDir(dir, values);
  const [entry] = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')).entries, out = fs.readFileSync(path.join(dir, 'bodies', entry.hash), 'utf8');
  assert.equal(out, `<script>${page.replaceAll('privacy@firm.example-corp.com', sameLengthFake('privacy@firm.example-corp.com')).replace('hr@firm.example-corp.com', sameLengthFake('hr@firm.example-corp.com'))}</script>`);
  assert.deepEqual(gateRecordDir(dir, values), []);
});

// 27 Oct 2026 (6e's check on #2254's privacy path): the narrowing above only removes FALSE hits. Every spelling of a real address still goes, even with the code that must stay (a %400 sum, an @2x name,
// a random-bytes run) in the same body, and the gate is clear afterwards.
test('every spelling of a real address is still scrubbed when the body also holds code the scrub must leave alone', () => {
  const real = 'jane.fake@acme-test.de', code = 'const k=e%400==0;img="a@2x.png";';
  const spellings = {plain: real, percent: real.replace('@', '%40'), 'percent twice': real.replace('@', '%2540'), 'entity decimal': real.replace('@', '&#64;'), 'entity hex': real.replace('@', '&#x40;'),
    'entity named': real.replace('@', '&commat;'), 'js escape': real.replace('@', '\\u0040'), 'hex escape': real.replace('@', '\\x40'), 'after an escape': `\\u003e${real}`, 'after a newline': `\\n${real}`};
  for (const [name, spelling] of Object.entries(spellings)) {
    const body = `${code}x="${spelling}";`, dir = recordIn([{url: 'https://site.example.test/app.js', type: 'application/javascript', body}]);
    if (name !== 'entity named') assert.ok(gateRecordDir(dir, values).some(hit => hit.in === 'body'), `${name}: the gate sees it before`);   // the gate does not decode &commat; (the scrub does)
    scrubRecordDir(dir, values);
    const [entry] = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')).entries, out = fs.readFileSync(path.join(dir, 'bodies', entry.hash), 'utf8');
    assert.ok(out.startsWith(code), `${name}: the code beside it is untouched`);
    assert.ok(!/jane\.fake/.test(out), `${name}: the address is gone`);
    assert.deepEqual(gateRecordDir(dir, values), [], `${name}: nothing left after`);
  }
  const split = recordIn([{url: 'https://site.example.test/p', type: 'text/html', body: '<p>Rosalind&nbsp;Quill</p>'}]);
  scrubRecordDir(split, values);
  assert.deepEqual(gateRecordDir(split, values), [], 'a name split by a non-breaking space is still found');
});

// 27 Oct 2026 (gitar review on #2272): the person's OWN address in a recorded page also keeps its length, and a real placeholder like test@example.com is no scrub fake (memo keys must not move for it).
test('the person\'s own e-mail keeps its length too, and a real example placeholder is not folded by the memo key', async () => {
  const {normalise} = await import('../../lib/ai/model-memo.js');
  const own = 'owner.name+jp@gmail.com', page = `<p>Signed in as ${own}; placeholder test@example.com, t@example.com</p>`;
  const dir = recordIn([{url: 'https://site.example.test/me', type: 'text/html', body: page}]);
  scrubRecordDir(dir, new Map([...values, [own, 'email']]));
  const [entry] = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')).entries, out = fs.readFileSync(path.join(dir, 'bodies', entry.hash), 'utf8');
  assert.equal(out.length, page.length, 'the page is exactly as long as before');
  assert.ok(!out.includes('owner.name') && out.includes('placeholder test@example.com, t@example.com'), 'the own address is gone, the placeholders stay');
  assert.equal(normalise(JSON.stringify({text: page})), normalise(JSON.stringify({text: out})), 'the memo key does not move');
  assert.ok(normalise('a test@example.com b').includes('test@example.com') && normalise('x t@example.com').includes(' t@example.com'), 'a real example address is kept by the key');
});
