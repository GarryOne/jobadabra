// The per-site daily limit (lib/site-ledger.mjs): the 4th visit of a host is refused, a blocked host rests the day, the override works and is logged, a new day resets,
// and every file that sends a browser to a real site goes through guardLiveVisit (the class test: a new live path fails here until it does).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {BOT_CHECK_SURE, SiteLimitError, blockSignal, blockVerdict, guardLiveVisit, markBlocked, siteOf} from '../lib/site-ledger.mjs';

const E2E = fileURLToPath(new URL('..', import.meta.url));
const fresh = () => ({JOB_PILOTTO_SITE_LEDGER_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ledger-'))});
const day = (n = 0) => new Date(2026, 9, 12 + n, 10, 0, 0);
// One visit by "another process": the ledger counts a process once per host, so each call here is a new run.
let fakePid = 0;
const visit = (url, options) => { const real = process.pid; Object.defineProperty(process, 'pid', {value: 90000 + ++fakePid, configurable: true}); try { return guardLiveVisit(url, {log: () => {}, ...options}); } finally { Object.defineProperty(process, 'pid', {value: real, configurable: true}); } };

test('the 4th visit to a host is refused, naming the site, the count and the last time', () => {
  const env = fresh();
  for (let n = 0; n < 3; n++) assert.equal(visit('https://jobs.example.com/a', {env, now: day(), who: `s${n}`}).count, n + 1);
  assert.throws(() => visit('https://www.jobs.example.com/b?x=1', {env, now: day()}), error => error instanceof SiteLimitError && /jobs\.example\.com/.test(error.message) && /3 live visits today \(limit 3\), the last at 10:00 by s2/.test(error.message));
  assert.equal(visit('https://other.example.org/', {env, now: day()}).count, 1, 'another host has its own count');
});

test('the same process visiting a host again counts once; a peek records nothing', () => {
  const env = fresh();
  assert.equal(guardLiveVisit('https://a.example.com/', {env, now: day(), log: () => {}}).count, 1);
  assert.equal(guardLiveVisit('https://a.example.com/other', {env, now: day(), log: () => {}}).count, 1);
  assert.equal(visit('https://b.example.com/', {env, now: day(), record: false}).count, 0);
  assert.equal(visit('https://b.example.com/', {env, now: day()}).count, 1);
});

test('a blocked host is refused for the rest of the day, whoever asks, and again free the next day', () => {
  const env = fresh();
  visit('https://shop.example.com/job', {env, now: day()});
  markBlocked('https://shop.example.com/job', 'digest refused', {env, now: day()});
  assert.throws(() => visit('https://shop.example.com/other', {env, now: day()}), error => error.blocked === true && /block page.*until tomorrow/.test(error.message));
  assert.doesNotThrow(() => visit('https://shop.example.com/job', {env, now: day(1)}), 'a new day resets');
});

test('the override lets the named host through, both limit and block, and each use is logged', () => {
  const env = {...fresh(), JOB_PILOTTO_SITE_LIMIT_OVERRIDE: 'busy.example.com'};
  for (let n = 0; n < 5; n++) assert.doesNotThrow(() => visit('https://busy.example.com/', {env, now: day()}));
  markBlocked('https://busy.example.com/', 'bot check', {env, now: day()});
  assert.doesNotThrow(() => visit('https://busy.example.com/', {env, now: day()}));
  assert.throws(() => visit('https://not-named.example.com/', {env: {...env, JOB_PILOTTO_SITE_LIMIT: '1'}, now: day()}) && visit('https://not-named.example.com/', {env: {...env, JOB_PILOTTO_SITE_LIMIT: '1'}, now: day()}), SiteLimitError);
  const logged = fs.readFileSync(path.join(env.JOB_PILOTTO_SITE_LEDGER_DIR, 'override.log'), 'utf8').trim().split('\n');
  assert.ok(logged.length >= 3 && logged.every(line => /busy\.example\.com/.test(line) && /JOB_PILOTTO_SITE_LIMIT_OVERRIDE/.test(line)));
});

test('loopback, file and plain-http addresses are not real sites: never counted', () => {
  const env = fresh();
  for (const url of ['http://127.0.0.1:8080/x', 'https://localhost/x', 'file:///tmp/a.html', 'http://jobs.example.com/', 'not a url']) assert.equal(guardLiveVisit(url, {env, now: day()}), null);
  assert.equal(siteOf('https://WWW.Jobs.Example.com/a'), 'jobs.example.com');
});

test('block signals come from the digest outcome and bot checks only', () => {
  assert.equal(blockSignal('x digest: outcome=refused (block)'), 'digest refused');
  assert.equal(blockSignal('account judgment: needs_code'), 'bot check');
  assert.equal(blockSignal('digest: outcome=login_wall'), '');
});

// Owner, 12 Oct 2026: the CI run of Lever (run 38242323673) flagged a bot check at confidence 0.6 on a normal apply page, then filled 11 fields; the old rule rested the host.
const FLAG = confidence => `2026-10-12T11:26:30.350Z [extension] page kind: other {"shape":"jobs.lever.co/sonarsource/*/apply|ft8+","by":"ai","rung":null,"confidence":${confidence},"usd":0,"botCheck":true,"frames":2}`;
const FILLED = '2026-10-12T11:26:54.000Z [extension] fill: fields: 11 filled, 7 left {"fields":[]}';
test('a bot-check flag rests the host only when the AI is sure (>= 0.8) or the form did not fill; a contradicted flag is said and the host stays open', () => {
  assert.equal(BOT_CHECK_SURE, 0.8);
  assert.equal(blockSignal(`${FLAG(0.6)}\n${FILLED}`), '', 'flag 0.6, then 11 fields filled: not rested');
  assert.match(blockVerdict(`${FLAG(0.6)}\n${FILLED}`).contradicted, /^possible bot check \(contradicted\): flagged at confidence 0\.6, then the form filled 11 field\(s\)$/);
  assert.equal(blockSignal(`${FLAG(0.9)}\n${FILLED}`), 'bot check', 'a sure flag rests it even after a fill');
  assert.equal(blockSignal(FLAG(0.6)), 'bot check', 'flag 0.6 and nothing filled: rested');
  assert.equal(blockSignal(`${FLAG(0.6)}\n[extension] fill: fields: 0 filled, 5 left`), 'bot check', 'a form with nothing filled is no contradiction');
  assert.equal(blockSignal(`${FLAG(0.6)}\n[extension] fill: fields: 2 filled, 1 left on the account page`), 'bot check', 'an account page\'s fields are not the form');
  assert.equal(blockSignal(`${FILLED}\n[extension] account judgment form: needs_code {"botCheck":true}`), 'bot check', 'a code wall rests it: unchanged');
  assert.equal(blockSignal('[extension] account judgment form: needs_person {"botCheck":true}'), 'bot check', 'a flag with no confidence counts as sure');
  assert.equal(blockSignal(`live: ${blockVerdict(`${FLAG(0.6)}\n${FILLED}`).contradicted}`), '', 'the contradicted line itself never rests a host');
  assert.equal(blockSignal('live: the site blocked us (bot check): not visited again today'), 'bot check');
  assert.deepEqual(blockVerdict('Apply pressed on u'), {signal: '', contradicted: ''});
});

test('two writers at once lose no visit', async () => {
  const env = fresh();
  const {spawn} = await import('node:child_process');
  const code = `import {guardLiveVisit} from ${JSON.stringify(path.join(E2E, 'lib/site-ledger.mjs'))}; guardLiveVisit('https://race.example.com/', {env: process.env, now: new Date(2026, 9, 12, 10), log: () => {}});`;
  await Promise.all([...Array(3)].map(() => new Promise(resolve => spawn('node', ['--input-type=module', '-e', code], {env: {...process.env, ...env}}).on('close', resolve))));
  const ledger = JSON.parse(fs.readFileSync(path.join(env.JOB_PILOTTO_SITE_LEDGER_DIR, 'ledger.json'), 'utf8'));
  assert.equal(ledger['2026-10-12']['race.example.com'].visits.length, 3);
});

// The class: a file that navigates a browser to an address must guard it or be listed here as offline (a page of this repo, a recorded page, a chrome:// page).
const OFFLINE = new Set(['lib/page-replay.mjs', 'lib/replay-browser.mjs', 'lib/row-replay.mjs', 'lib/twin-refresh.mjs', 'suites/visitread.mjs', 'suites/visitsauto.mjs']);   // recorded pages, a local fixture server, a routed fake host, chrome://extensions
const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(item => item.name === 'node_modules' || item.name === 'test' || item.name === 'recorded' ? [] : item.isDirectory() ? walk(path.join(dir, item.name)) : item.name.endsWith('.mjs') ? [path.join(dir, item.name)] : []);
test('every file that sends a browser to a real site calls guardLiveVisit', () => {
  const live = ['lib/live-row.mjs', 'lib/apply-live.mjs', 'lib/spool-tabs.mjs', 'ladder-capture.mjs', 'record-sites.mjs'];
  for (const file of live) assert.match(fs.readFileSync(path.join(E2E, file), 'utf8'), /guardLiveVisit\(/, `${file} must call guardLiveVisit`);
  for (const file of walk(E2E)) {
    const rel = path.relative(E2E, file).split(path.sep).join('/');
    if (rel === 'lib/site-ledger.mjs' || OFFLINE.has(rel) || live.includes(rel)) continue;
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!/\.goto\(/.test(source) || /guardLiveVisit\(/.test(source), `${rel} navigates a browser: call guardLiveVisit(url) before it, or list it as offline in test/site-ledger.test.mjs`);
  }
});

// npm run live asks the ledger before it waits for the heavy lock: a host at its limit is refused at once (exit 3), nothing is counted, a fresh host passes.
test('live-check refuses a host at its limit before any lock, and counts nothing', async () => {
  const {spawnSync} = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-ledger-check-'));
  const env = {...process.env, JOB_PILOTTO_SITE_LEDGER_DIR: dir, JOB_PILOTTO_SITE_LIMIT: '1', JOB_PILOTTO_SITE_LIMIT_OVERRIDE: ''};
  const run = url => spawnSync('node', [path.join(E2E, 'live-check.mjs'), url], {env, encoding: 'utf8'});
  assert.equal(run('https://full.example.com/job').status, 0, 'nothing counted yet');
  assert.equal(run('https://full.example.com/job').status, 0, 'the check itself counts nothing');
  guardLiveVisit('https://full.example.com/job', {env, who: 'test', log: () => {}});
  const refused = run('https://full.example.com/job');
  assert.equal(refused.status, 3);
  assert.match(refused.stderr, /1 live visits today \(limit 1\)/);
  assert.equal(run('https://other.example.com/job').status, 0);
});

// 15 Oct 2026: no visit is kept back for another run: a by-hand CI recording may use all of a host's daily visits, and each visit says its kind; a Mac run names no kind.
test('a by-hand CI run may use all the day\'s visits; each visit says its kind', () => {
  const env = {...fresh(), JOB_PILOTTO_SITE_LIMIT: '2', JOB_PILOTTO_VISIT_KIND: 'hand'};
  assert.equal(visit('https://jobs.personio.example/1', {env, now: day()}).count, 1);
  assert.equal(visit('https://jobs.personio.example/2', {env, now: day()}).count, 2, 'the second visit is allowed');
  assert.throws(() => visit('https://jobs.personio.example/3', {env, now: day()}), /2 live visits today \(limit 2\)/, 'the third is refused');
  const ledger = JSON.parse(fs.readFileSync(path.join(env.JOB_PILOTTO_SITE_LEDGER_DIR, 'ledger.json'), 'utf8'));
  assert.deepEqual(Object.values(ledger)[0]['jobs.personio.example'].visits.map(item => item.kind), ['hand', 'hand']);
  const mac = {...fresh(), JOB_PILOTTO_SITE_LIMIT: '2'};   // no kind, as on the Mac
  assert.equal(visit('https://mac.example/1', {env: mac, now: day()}).count, 1);
  assert.equal(visit('https://mac.example/2', {env: mac, now: day()}).count, 2);
});
