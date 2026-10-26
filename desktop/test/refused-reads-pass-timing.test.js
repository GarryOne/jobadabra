// A refused-site pass never waits for an answer that already came or never comes (owner, 26 Oct 2026: "it hangs. its stuck": the panel sat on
// "0 of 1 · Airbase · Next" for 15 minutes). The extension reads the sites at once, while the pass's task may wait its turn behind Find jobs
// (one task at a time, lib/pipeline-queue.js): the Airbase page came back at 02:32, the pass only started at 02:43 and waited for it.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {queue, outcome, passRunning} from '../lib/refused-reads.js';

const storageWith = settings => { const kept = {...settings}; return {settings: () => kept, saveSettings: patch => Object.assign(kept, patch), kept}; };
const SITE = {url: 'https://jobs.coop.ch', name: 'Coop', kind: 'employer'};
const run = async (_storage, args) => ({stdout: JSON.stringify(args[1] === 'refused-queue' ? {ok: true, sites: [SITE]} : {ok: true, state: 'empty', name: 'Coop', jobs: 0})});
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

function laterTurn() {   // the task waits until go() is called: another task holds the lane
  const lines = [];
  let go, ended = null;
  const turn = new Promise(resolve => { go = resolve; });
  const work = (_s, _kind, _log, fn) => turn.then(() => fn(line => lines.push(line))).then(ok => { ended = ok; });
  return {lines, work, go: () => go(), ended: () => ended};
}

test('a page that comes back before the pass gets its turn is kept, and the pass ends as soon as its turn comes', {timeout: 3000}, async () => {
  const storage = storageWith({readRefusedSites: true}), lane = laterTurn();
  await queue(storage, {run, work: lane.work});
  await outcome(storage, {url: SITE.url, status: 200, html: '<html></html>', title: 't'}, {run});
  lane.go();
  await settle();
  assert.equal(lane.ended(), false, 'the task ended (no site read jobs), not still waiting');
  assert.ok(!passRunning());
  assert.ok(lane.lines.includes('  ▸ stopped · Coop · no jobs found'), lane.lines.join('|'));
});

test('a site the browser never answers for ends the pass with its reason, in seconds', {timeout: 3000}, async () => {
  const storage = storageWith({readRefusedSites: true}), lane = laterTurn();
  await queue(storage, {run, work: lane.work, siteMs: 30});
  lane.go();
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.ok(!passRunning(), 'the pass is over');
  assert.equal(lane.ended(), false);
  assert.ok(lane.lines.some(line => /^ {2}▸ stopped · Coop · no answer from your browser/.test(line)), lane.lines.join('|'));
  const late = await outcome(storage, {url: SITE.url, status: 200, html: '<html></html>', title: 't'}, {run});
  assert.equal(late.stop, true, 'the extension is told to read no further site');
});
