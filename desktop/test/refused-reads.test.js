// Refused sites read in the person's browser (owner, 19 Oct 2026; only after the press since 26 Oct 2026, test/refused-reads-button.test.js): the engine's queue goes to the extension, each page it
// fetched goes to the engine, and the pass is one Recent activity task with a line per site. A bot check or refusal in Chrome is a stop line, never "done".
import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';
import {siteTest} from './site-private.js';
import {queue, outcome, done, passRunning, takeOpenSwitch, takeShowCheck} from '../lib/refused-reads.js';
import * as now from '../lib/refused-now.js';

beforeEach(() => now.press());   // every pass here follows the person's press (test/refused-reads-button.test.js covers without one)

const storageWith = settings => { const kept = {...settings}; return {settings: () => kept, saveSettings: patch => Object.assign(kept, patch), kept}; };
const SITES = [{url: 'https://jobs.coop.ch', name: 'Coop', kind: 'employer'}, {url: 'https://www.monsterboard.nl/v?q=a', name: 'Monsterboard', kind: 'board'}];

function fakes() {
  const calls = [], lines = [];
  const run = async (_storage, args) => {
    calls.push(args.slice(0, 2).join(' '));
    if (args[1] === 'refused-queue') return {stdout: JSON.stringify({ok: true, sites: SITES})};
    if (args[1] === 'refused-outcome') {
      const url = process.env.__LAST_URL;
      return {stdout: JSON.stringify(url.includes('coop') ? {ok: true, state: 'read', name: 'Coop', jobs: 4, fits: 2} : {ok: true, state: 'stopped', why: 'HTTP 429', name: 'Monsterboard'})};
    }
    return {stdout: ''};
  };
  let finished;
  const work = (_s, kind, _log, fn) => { calls.push(`work ${kind}`); return finished = fn(line => lines.push(line)).then(ok => { calls.push(`task ended ${ok}`); }); };
  return {calls, lines, run, work, ended: () => finished};
}

test('on: one pass is one task with a line per site, and the engine keeps what each page brought', async () => {
  const f = fakes(), storage = storageWith({});
  const answer = await queue(storage, {run: f.run, work: f.work, scoreArgs: () => ['src.desktop', 'score']});
  assert.deepEqual(answer.sites.map(site => site.name), ['Coop', 'Monsterboard']);
  assert.ok(passRunning());
  assert.equal((await queue(storage, {run: f.run, work: f.work})).sites.length, 0, 'a pass is already running: nothing handed out twice');
  for (const [url, status] of [['https://jobs.coop.ch', 200], ['https://www.monsterboard.nl/v?q=a', 429]]) {
    process.env.__LAST_URL = url;
    await outcome(storage, {url, status, html: status === 200 ? '<html></html>' : '', title: 't'}, {run: f.run});
  }
  await f.ended();
  assert.ok(!passRunning());
  assert.deepEqual(f.lines.filter(line => line.startsWith('  ▸')), ['  ▸ next · Coop · https://jobs.coop.ch', '  ▸ next · Monsterboard · https://www.monsterboard.nl/v?q=a',
    '  ▸ done · Coop · 4 jobs read', '  ▸ stopped · Monsterboard · HTTP 429']);
  assert.ok(f.lines.some(line => /^Read 1 of 2 sites/.test(line)));
  assert.equal(f.calls.filter(call => call === 'work visits').length, 1);
});

test('without the extension permission nothing is handed out and Settings is told to ask for it', async () => {
  const f = fakes(), storage = storageWith({});
  const answer = await queue(storage, {allowed: false, run: f.run, work: f.work});
  assert.deepEqual([answer.on, answer.sites, storage.kept.refusedNeedsAllow, f.calls], [true, [], true, []]);
  await queue(storage, {allowed: true, run: async () => ({stdout: JSON.stringify({ok: true, sites: []})}), work: f.work});
  assert.equal(storage.kept.refusedNeedsAllow, false);
});

test('the extension ending a pass early closes the task with what it has', async () => {
  const f = fakes(), storage = storageWith({});
  await queue(storage, {run: f.run, work: f.work});
  await done();
  await f.ended();
  assert.ok(!passRunning());
});

siteTest('Privacy names the feature and says it starts only from the button', async () => {   // the page lives in jobadabra-web
  const fs = await import('node:fs');
  assert.match(fs.readFileSync(new URL('../../web/public/privacy.html', import.meta.url), 'utf8'), /Find jobs using your browser \(only when you press it\)/);
});

test('Settings is told when the private-window step cannot run (no Allow in Incognito) and when it can', async () => {
  const f = fakes(), storage = storageWith({});
  await queue(storage, {run: f.run, work: f.work, incognito: false, scoreArgs: () => ['src.desktop', 'score']});
  assert.equal(storage.kept.refusedNeedsIncognito, true);
  await done();
  await queue(storage, {run: f.run, work: f.work, incognito: true, scoreArgs: () => ['src.desktop', 'score']});
  assert.equal(storage.kept.refusedNeedsIncognito, false);
  await done();
});

test('a captcha met in the real tab goes to the engine flagged, and the site line offers it to the person', async () => {
  const sent = [], lines = [];
  const run = async (_s, args) => {
    if (args[1] === 'refused-queue') return {stdout: JSON.stringify({ok: true, sites: [SITES[0]]})};
    sent.push(JSON.parse(await import('node:fs').then(fs => fs.readFileSync(args[2], 'utf8'))));
    return {stdout: JSON.stringify({ok: true, state: 'stopped', why: 'needs a quick check from you', needs_check: true, name: 'Coop'})};
  };
  const storage = storageWith({});
  await queue(storage, {run, work: (_s, _k, _l, fn) => fn(line => lines.push(line)), scoreArgs: () => ['x']});
  await outcome(storage, {url: 'https://jobs.coop.ch', status: 200, html: '<html></html>', step: 'tab', captcha: true}, {run});
  assert.deepEqual([sent[0].step, sent[0].captcha], ['tab', true]);
  assert.ok(lines.includes('  ▸ stopped · Coop · needs a quick check from you'), lines.join('|'));
  await done();
});

test('sites stopped for want of Allow in Incognito are counted by host, cleared once it is on, and Open Chrome\'s switch is handed out once', async () => {
  const f = fakes(), storage = storageWith({});
  await queue(storage, {run: f.run, work: f.work, incognito: false, scoreArgs: () => ['src.desktop', 'score']});
  process.env.__LAST_URL = 'https://jobs.coop.ch';
  for (const url of ['https://jobs.coop.ch/a', 'https://jobs.coop.ch/b']) await outcome(storage, {url, status: 403, html: '', tabSkipped: 'incognito'}, {run: f.run});
  assert.deepEqual(storage.kept.refusedIncognitoWaiting, ['jobs.coop.ch'], 'one host once');
  await outcome(storage, {url: 'https://jobs.coop.ch', status: 403, html: ''}, {run: f.run});
  await done();
  await queue(storage, {run: f.run, work: f.work, incognito: true, scoreArgs: () => ['src.desktop', 'score']});
  assert.deepEqual(storage.kept.refusedIncognitoWaiting, []);
  await done();
  assert.equal(takeOpenSwitch(storage), false);
  storage.saveSettings({refusedOpenSwitch: true});
  assert.deepEqual([takeOpenSwitch(storage), takeOpenSwitch(storage)], [true, false]);
});

test('a captcha held in the extension is listed for Focus, ends when the site is read, and "Show the check" is handed out once', async () => {
  const answers = [{ok: true, state: 'stopped', why: 'needs a quick check from you', needs_check: true, name: 'Coop'}, {ok: true, state: 'read', name: 'Coop', jobs: 3, fits: 0}];
  const run = async () => ({stdout: JSON.stringify(answers.shift())});
  const storage = storageWith({});
  await outcome(storage, {url: 'https://jobs.coop.ch', status: 200, html: '<html></html>', step: 'tab', captcha: true}, {run});
  assert.deepEqual(storage.kept.refusedCheckWaiting.map(entry => entry.host), ['jobs.coop.ch']);
  await outcome(storage, {url: 'https://jobs.coop.ch', status: 200, html: '<html><body>jobs</body></html>', step: 'tab'}, {run});
  assert.deepEqual(storage.kept.refusedCheckWaiting, [], 'read after the person solved it: nothing waits');
  assert.equal(takeShowCheck(storage), false);
  storage.saveSettings({refusedShowCheck: true});
  assert.deepEqual([takeShowCheck(storage), takeShowCheck(storage)], [true, false]);
});

// Owner, 25 Oct 2026: Stop on the run left every site "Next" and the run "Running": the pass ended only when the extension said so.
test('Stop ends the pass at once and the extension is told to read no further site', async () => {
  const f = fakes(), storage = storageWith({}), controller = new AbortController();
  const work = (_s, kind, _log, fn) => { f.calls.push(`work ${kind}`); return fn(line => f.lines.push(line), controller.signal).then(ok => { f.calls.push(`task ended ${ok}`); }); };
  await queue(storage, {run: f.run, work, scoreArgs: () => ['src.desktop', 'score']});
  assert.ok(passRunning());
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(!passRunning(), 'the pass is over, not waiting for the extension');
  assert.ok(f.calls.includes('task ended false'));
  process.env.__LAST_URL = 'https://jobs.coop.ch';
  const answer = await outcome(storage, {url: 'https://jobs.coop.ch', status: 200, html: '<html></html>', title: 't'}, {run: f.run});
  assert.equal(answer.stop, true, 'the page in flight is kept; the next report says stop');
  assert.ok(!f.calls.includes('src.desktop score'));
});
