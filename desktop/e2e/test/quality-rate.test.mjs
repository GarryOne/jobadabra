// How steady the AI is, as a rate over the last 90 score pairs of the night's live quality runs (owner, 27 Oct 2026: "Code gate + AI rate"; bars "Below 80% of
// last 90", "Above 2% of last 90"). It replaces the per-run "2 of 9" allowance, which turned main red on one wobbly night (29 runs: 85.4% of pairs within 8).
// The same bars and window are drawn on /admin/operations/e2e (jobadabra-web admin/e2e-quality.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {BARS, MIN_PAIRS, addNight, nightOf, rateOf, rateVerdict, readHistory, writeHistory} from '../lib/quality-rate.mjs';

const night = (runId, pairs, within8, over20 = 0) => ({runId, day: '2026-10-27', pairs, within8, over20});

test('a night counts its pairs: within 8, over 20, a job scored once is not a pair', () => {
  assert.deepEqual(nightOf({a: 95, b: 85, c: 65, d: 30}, {a: 92, b: 75, c: 40, e: 50}, {runId: 7, day: '2026-10-27'}), {runId: 7, day: '2026-10-27', pairs: 3, within8: 1, over20: 1});
});

test('the rate covers the newest nights holding the last 90 pairs, against the owner\'s bars', () => {
  assert.deepEqual([BARS.pairs, BARS.agree, BARS.jumps], [90, 0.8, 0.02]);
  const nights = Array.from({length: 12}, (_, i) => night(100 - i, 9, i < 10 ? 8 : 0));   // newest first; the two oldest would drag the rate down
  const rate = rateOf(nights);
  assert.deepEqual([rate.nights, rate.pairs, rate.within8], [10, 90, 80]);
  assert.ok(rateVerdict(rate).ok);
  assert.ok(!rateVerdict(rateOf([night(1, 90, 71)])).ok, '71 of 90 (79%) is under the bar');
  assert.ok(rateVerdict(rateOf([night(1, 90, 72)])).ok, '72 of 90 (80%) holds it');
  const jumps = rateVerdict(rateOf([night(1, 90, 90, 2)]));
  assert.ok(!jumps.ok);
  assert.match(jumps.problems.join(), /2 of 90 pairs .*more than 20 points/);
});

test('a short history is reported, not judged: one wobbly night never turns main red by itself', () => {
  assert.equal(MIN_PAIRS, 45);
  const short = rateVerdict(rateOf([night(1, 9, 5, 1)]));
  assert.deepEqual([short.ok, short.judged], [true, false]);
  assert.ok(!rateVerdict(rateOf(Array.from({length: 5}, (_, i) => night(9 - i, 9, 5)))).ok, '45 pairs at 56% are judged, and red');
});

test('a run adds its night once: the retry of a red rate measures the same history and is red again', () => {
  const history = addNight([night(1, 9, 9)], night(2, 9, 3));
  assert.deepEqual(history.map(item => item.runId), [2, 1]);
  assert.deepEqual(addNight(history, night(2, 9, 9)).map(item => [item.runId, item.within8]), [[2, 3], [1, 9]], 'the same run again keeps its first night');
  assert.equal(addNight(Array.from({length: 80}, (_, i) => night(200 - i, 9, 9)), night(300, 9, 9)).length, 60, 'at most 60 nights kept');
});

test('the history file: missing or broken reads as empty; written back as JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-rate-')), file = path.join(dir, 'sub', 'history.json');
  assert.deepEqual(readHistory(file), []);
  assert.deepEqual(readHistory(''), []);
  writeHistory(file, [night(1, 9, 9)]);
  assert.deepEqual(readHistory(file), [night(1, 9, 9)]);
  fs.writeFileSync(file, '{broken');
  assert.deepEqual(readHistory(file), []);
  fs.writeFileSync(file, JSON.stringify([night(1, 9, 9), {runId: 'x'}, night(2, 9, 10)]));
  assert.deepEqual(readHistory(file), [night(1, 9, 9)], 'a night that does not add up is dropped');
  fs.rmSync(dir, {recursive: true, force: true});
});
