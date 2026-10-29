// The fill waits for a still page, not a fixed second (extension/page-still.js, apply-latency change 5): it goes on after 0.5 s without a change, waits
// longer while the page keeps changing, never past the old fixed wait, and waits that full time when the page cannot be watched. consider() and
// formAfterPress() have no fixed one-second steps left; the late-form look (watchForFields) keeps its own.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

import {pageStill, stillInPage} from '../../extension/page-still.js';

// A fake page: document.documentElement and a MutationObserver whose callbacks the test fires.
function fakePage() {
  const observers = [];
  globalThis.document = {documentElement: {}};
  globalThis.MutationObserver = class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.off = true; } };
  return {change: () => observers.filter(item => !item.off).forEach(item => item.callback([]))};
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a quiet page goes on after the quiet time, not the fixed wait', async () => {
  fakePage();
  const result = await stillInPage(60, 1000);
  assert.equal(result.still, true);
  assert.ok(result.ms >= 55, `took ${result.ms} ms`);   // still: true = the quiet timer ended it, not the 1000 ms cap (no wall-clock ceiling: a loaded Mac took 507 ms, 12 Oct 2026)
});

test('a page that keeps changing is waited for, up to the old fixed wait and never longer', async t => {
  // On a fake clock (13 Oct 2026: on a loaded Mac the real 30 ms gaps between changes grew past the 60 ms quiet time and the page "settled" early).
  t.mock.timers.enable({apis: ['setTimeout', 'Date']});
  const page = fakePage();
  const pending = stillInPage(60, 400);
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(30); page.change(); }   // changes for 120 ms, then quiet
  t.mock.timers.tick(60);
  const settled = await pending;
  assert.deepEqual(settled, {still: true, ms: 180}, 'went on 60 ms after the last change, not while the page was still changing');
  const busy = fakePage();
  const capped = stillInPage(60, 200);
  for (let i = 0; i < 10; i++) { t.mock.timers.tick(20); busy.change(); }   // a change every 20 ms: never quiet
  const result = await capped;
  assert.deepEqual(result, {still: false, ms: 200}, 'the cap ended it at the old fixed wait');
});

test('a page that cannot be watched waits the full old time', async () => {
  const began = Date.now();
  const result = await pageStill(1, {quietMs: 50, maxMs: 150}, async () => { throw new Error('Frame with ID 0 is showing error page'); });
  assert.deepEqual(result, {still: false, ms: 150});
  assert.ok(Date.now() - began >= 145);
  assert.deepEqual(await pageStill(1, {quietMs: 50, maxMs: 150}, async () => [{result: {still: true, ms: 51}}]), {still: true, ms: 51});
});

test('consider() and formAfterPress() wait for a still page; the late-form look keeps its own steps', () => {
  const source = ['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8')).join('\n');
  const body = name => { const start = source.indexOf(`function ${name}(`); return source.slice(start, source.indexOf('\n}\n', start)); };
  for (const name of ['consider', 'formAfterPress', 'preparePage', 'readPage', 'afterFill']) {
    const fixed = body(name).match(/setTimeout\(resolve, (1000|1500|800)\)/g) || [];
    assert.deepEqual(fixed, [], `${name} still waits a fixed ${fixed.join(', ')}`);
  }
  assert.match(body('consider'), /pageStill\(/);
  assert.match(body('watchForFields'), /wait\(2000\)/, 'the late-form look is unchanged (a form born after the first look is still seen)');
});

test('after a press the wait ends early only once the page changed and went still (a quiet page may be waiting on the site)', async () => {
  fakePage();
  const quiet = await stillInPage(40, 250, true);
  assert.equal(quiet.still, false, 'nothing changed: the full old wait');
  assert.ok(quiet.ms >= 245);
  const page = fakePage();
  const pending = stillInPage(40, 1000, true);
  await wait(60); page.change();
  const changed = await pending;
  assert.equal(changed.still, true);
  assert.ok(changed.ms >= 95, `took ${changed.ms} ms`);   // still: true = ended by the quiet after the change, not the 1000 ms cap
});

test('the account step waits for a still page around its button, not fixed 0.8 s and 4 s', () => {
  const source = fs.readFileSync(new URL('../../extension/account-step.js', import.meta.url), 'utf8');
  assert.deepEqual(source.match(/setTimeout\(resolve, (800|4000)\)/g) || [], []);
  assert.match(source, /pageStill\(tab\.id, \{maxMs: 4000, afterChange: true\}\)/);
});
