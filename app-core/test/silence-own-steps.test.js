// The silent dead-end clock on a slow Mac: a fill whose own awaited reads are still running is working, not silent (extension/ladder/silence.js waiting(), extension/fill-span.js).
// Why (31 Oct 2026, a8; beta 41242762348 apply-2of3, app.log 21:37:37): on a starved Chrome the fill's pre-fill reads took 12 s (pageStill), 5 s and 19 s (labels), and "dead end: silent
// {silentMs: 30146}" was called 5 s after "filling" began, so a person on a slow Mac would have been handed a form the extension was still filling. Own awaits are waits, like asks to the app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {MAX_PAUSE_MS, SILENT_AFTER_MS, askEnded, askStarted, checkSilence, restartSilence, silenceTab, useSilence, waiting, waitingSpan} from '../../extension/ladder/silence.js';

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

test('an ask nested in a long own step keeps pausing after the step\'s own cap (Gitar on the PR): the ask started 85 s in, out for 120 s', async () => {
  silenceTab(4, 'https://jobs.example/4');
  now = 5000000;
  restartSilence(4, 'navigated', {now, host: 'jobs.example'});
  const begin = now;
  await waiting(4, async () => {
    now = begin + 85000;
    const ask = askStarted(4, now);
    now = begin + 205000;   // the ask stays out for 120 s; the step itself was capped at 90 s
    assert.equal(checkSilence(4, now), false, 'the ask is still out: not silent');
    askEnded(ask, now);
  }, clock);
  assert.equal(checkSilence(4, now + T - 1), false);
  assert.equal(checkSilence(4, now + T), true, 'the ask\'s whole 120 s was a wait, the step\'s capped 90 s overlapped it');
});

test('the fill\'s span for a tab is a wait for that tab only: waitingSpan names the step in the log, pauses its application, and another tab\'s clock keeps running', async () => {
  silenceTab(5, 'https://jobs.example/5'); silenceTab(6, 'https://jobs.example/6');
  now = 9000000;
  restartSilence(5, 'navigated', {now, host: 'a.example'});
  restartSilence(6, 'navigated', {now, host: 'b.example'});
  const named = [];
  const spanOf = async (name, run) => { named.push(name); now += 40000; return run(); };   // the log's span: the read takes 40 s
  const answer = await waitingSpan(spanOf, 5, 'consider 5 readPage', async () => { assert.equal(checkSilence(5, now), false, 'tab 5 is waiting'); return 'read'; }, clock);
  assert.equal(answer, 'read', 'the step\'s own answer comes back');
  assert.deepEqual(named, ['consider 5 readPage']);
  assert.equal(checkSilence(6, now), true, 'tab 6 did nothing for 40 s: its clock is not paused by tab 5\'s read');
});

test('wired: no span of the fill is left outside ownSpan(tab.id, ...), so a new span cannot forget the clock', () => {
  const read = file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8');
  for (const file of ['fill-flow.js', 'fill-flow-read.js']) {
    const bare = read(file).split('\n').filter(line => /(?<![\w.])span\(/.test(line) && !/^\s*(\/\/|import)/.test(line));
    assert.deepEqual(bare, [], `${file}: a span the clock does not know about`);
  }
});
