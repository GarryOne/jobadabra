// Browser reads of refused sites start only from the person's press of "Find jobs using your browser" (owner, 26 Oct 2026: "shouldn't start automatically
// in the backgruond. It should be suggested to the user as an action button"; "I don't think we should have a switch at all"). A finished Find jobs run
// offers the button; every other path that used to start reads (a run, the extension's timer, app start, opening a job) reads nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {queue, passRunning, done} from '../lib/refused-reads.js';
import {offer} from '../lib/refused-offer.js';
import * as now from '../lib/refused-now.js';
import {startRefusedReads, ALARM, NOW_ALARM} from '../../extension/refused-read.js';
import {browserOffer, paletteEntry} from '../renderer/pages/browser-offer-rows.js';

const root = new URL('../../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const storageWith = settings => { const kept = {...settings}; return {settings: () => kept, saveSettings: patch => Object.assign(kept, patch), kept}; };
const SITES = [{url: 'https://jobs.coop.ch', name: 'Coop', kind: 'employer'}, {url: 'https://www.monsterboard.nl/v?q=a', name: 'Monsterboard', kind: 'board'}];
function engine() {
  const asked = [];
  return {asked, run: async (_storage, args) => { asked.push(args.join(' ')); return {stdout: JSON.stringify({ok: true, sites: SITES})}; },
    work: () => new Promise(() => {})};   // a pass's task: kept open, ended by done()
}

test('a Find jobs run that leaves refused sites offers the button and reads nothing; only the press starts the reads', async () => {
  now.take();
  const storage = storageWith({}), f = engine();
  assert.equal(await offer(storage, f.run), 2);
  assert.deepEqual(storage.kept.refusedOffer.names, ['Coop', 'Monsterboard'], 'the run offers the two sites');
  for (let look = 0; look < 3; look++) assert.deepEqual((await queue(storage, {run: f.run, work: f.work})).sites, [], 'the extension asks: nothing without a press');
  assert.deepEqual(f.asked, ['src.desktop refused-queue'], 'only the offer\'s count asked the engine');
  now.press();
  assert.deepEqual((await queue(storage, {run: f.run, work: f.work})).sites.map(site => site.name), ['Coop', 'Monsterboard']);
  assert.equal(storage.kept.refusedOffer, null, 'pressed: the offer is used up');
  assert.ok(passRunning());
  await done();
  assert.deepEqual((await queue(storage, {run: f.run, work: f.work})).sites, [], 'one press, one pass');
});

// Every path that started browser reads before 26 Oct 2026. A new path is added here with its check.
const PATHS = [
  ['after a Find jobs run (Check for new jobs, scheduled)', 'desktop/lib/pipeline-tasks.js'],
  ['opening a job from a refused site', 'desktop/lib/visits-handlers.js'],
  ['the extension: its timer, Chrome or app start', 'extension/refused-read.js'],
  ['the extension background', 'extension/background.js'],
];
test('the class: no path but the button arms the reads', () => {
  for (const [name, file] of PATHS) {
    const source = read(file);
    assert.doesNotMatch(source, /\b(press|readNow|readAllNow)\(/, `${name} (${file}) starts browser reads by itself`);
  }
  // The one mechanism: press() is called by the button's handler alone, anywhere in the app or the extension.
  const callers = [];
  const walk = dir => fs.readdirSync(new URL(dir, root), {withFileTypes: true}).forEach(entry => {
    const file = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) { if (!['node_modules', 'test', 'e2e', 'shared'].includes(entry.name)) walk(file); return; }
    if (/\.(m?js|cjs)$/.test(entry.name) && /\bnow\.press\(|\bpress\(\)/.test(read(file)) && /refused-now/.test(read(file))) callers.push(file);
  });
  ['desktop/lib', 'desktop/renderer', 'extension'].forEach(walk);
  assert.deepEqual(callers, ['desktop/lib/refused-reads-handlers.js']);
});

test('the extension sets no read timer and clears the hourly one older versions made', () => {
  const created = [], cleared = [];
  const chrome = {alarms: {create: name => created.push(name), clear: name => { cleared.push(name); return Promise.resolve(true); }, onAlarm: {addListener: () => {}}}};
  startRefusedReads({chrome});
  assert.deepEqual([created, cleared], [[NOW_ALARM], [ALARM]]);
});

test('no Settings switch: nothing reads it, and the rule and Settings say so', () => {
  assert.doesNotMatch(read('desktop/renderer/index.html'), /refused-read-tick|Read refused sites in my browser/);
  for (const file of ['desktop/lib/refused-reads.js', 'desktop/lib/refused-offer.js', 'desktop/lib/refused-reads-handlers.js', 'desktop/renderer/pages/check-rows.js', 'desktop/renderer/pages/incognito-rows.js']) {
    assert.doesNotMatch(read(file), /readRefusedSites/, `${file} still reads the removed switch`);
  }
  assert.match(read('CLAUDE.md'), /It starts only when the person presses "Find jobs using your browser"/);
  assert.doesNotMatch(read('CLAUDE.md'), /unless the user turned off Settings → "Read refused sites in my browser"/);
});

test('the card: only the newest finished Find jobs run offers it; ⌘K brings you to it', () => {
  const settings = {refusedOffer: {count: 5, names: ['Coop', 'Migros', 'Lidl'], at: '2026-10-26T10:00:00Z'}};
  const runs = [{id: 2, kind: 'search'}, {id: 1, kind: 'search'}, {id: 3, kind: 'mail'}];
  assert.match(browserOffer(runs[0], {runs, settings}).text, /^5 sites \(Coop, Migros, Lidl and 2 more\) refused Jobadabra/);
  assert.equal(browserOffer(runs[1], {runs, settings}), null, 'an older run');
  assert.equal(browserOffer({id: 4, kind: 'search', live: true}, {runs, settings}), null, 'still running');
  assert.equal(browserOffer(runs[2], {runs, settings}), null, 'another kind of run');
  assert.equal(browserOffer(runs[0], {runs, settings: {}}), null, 'nothing refused');
  assert.equal(browserOffer(runs[0], {runs, settings: {...settings, refusedNeedsAllow: true}}).allow, true, 'says the extension\'s one Allow');
  assert.deepEqual(paletteEntry({runs, settings}), {label: 'Find jobs using your browser', hint: 'Read the 5 sites that refused Jobadabra, in your browser', runId: 2});
  assert.equal(paletteEntry({runs, settings: {}}), null);
});
