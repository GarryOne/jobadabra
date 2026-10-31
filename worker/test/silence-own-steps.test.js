// The silent dead-end clock on a slow Mac: a fill whose own awaited reads are still running is working, not silent (extension/ladder/silence.js waiting(), extension/fill-span.js).
// Why (31 Oct 2026, a8; beta 41242762348 apply-2of3, app.log 21:37:37): on a starved Chrome the fill's pre-fill reads took 12 s (pageStill), 5 s and 19 s (labels), and "dead end: silent
// {silentMs: 30146}" was called 5 s after "filling" began, so a person on a slow Mac would have been handed a form the extension was still filling. Own awaits are waits, like asks to the app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {MAX_PAUSE_MS, SILENT_AFTER_MS, checkSilence, restartSilence, silenceTab, useSilence, waiting} from '../../extension/ladder/silence.js';

const T = SILENT_AFTER_MS, fired = [];
useSilence({notice: (host, evidence) => fired.push({host, evidence}), timer: () => 1, cancel: () => {}});
let now = 0;
const clock = () => now;

test('positive control: the same 35 s of reads with nothing bracketing them (the fill before this fix) IS called silent, so the scenario below plays the symptom', () => {
  silenceTab(3, 'https://jobs.example/3');
  restartSilence(3, 'navigated', {now: 0, host: 'jobs.example'});
  assert.equal(checkSilence(3, 35000), true);
  fired.length = 0;
});

test('a slow Mac: three own reads of 40 s each are never silence, and the notice comes T of real quiet after the last one', async () => {
  silenceTab(1, 'https://jobs.example/1');
  restartSilence(1, 'navigated', {now: 0, host: 'jobs.example'});
  for (let read = 1; read <= 3; read++) {
    await waiting(1, async () => {
      now += 35000;
      assert.equal(checkSilence(1, now), false, `read ${read} is 35 s in: still working, not silent`);
      now += 5000;
    }, clock);
  }
  assert.equal(now, 120000);
  assert.deepEqual(fired, [], 'no notice while the reads ran');
  assert.equal(checkSilence(1, now + T - 1), false);
  assert.equal(checkSilence(1, now + T), true, 'after the last read the quiet starts counting');
  assert.equal(fired[0].evidence.silentMs, T, 'the notice names the quiet time, not the wall time');
});

test('a read that never answers is still a stall: the pause stops counting after MAX_PAUSE_MS', () => {
  silenceTab(2, 'https://jobs.example/2');
  restartSilence(2, 'navigated', {now: 1000000, host: 'jobs.example'});
  waiting(2, () => new Promise(() => {}), clock).catch(() => {});   // never settles
  now = 1000000;
  assert.equal(checkSilence(2, 1000000 + MAX_PAUSE_MS + T - 1), false);
  assert.equal(checkSilence(2, 1000000 + MAX_PAUSE_MS + T), true);
});

test('wired: every awaited step of the fill that the log spans goes through ownSpan(tab.id, ...), so a new span cannot forget the clock', () => {
  const read = file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8');
  for (const file of ['fill-flow.js', 'fill-flow-read.js']) {
    const bare = read(file).split('\n').filter(line => /(?<![\w.])span\(/.test(line) && !/^\s*(\/\/|import)/.test(line));
    assert.deepEqual(bare, [], `${file}: a span the clock does not know about`);
  }
  assert.match(read('fill-span.js'), /waiting\(tabId, \(\) => span\(name, run\)\)/);
});
