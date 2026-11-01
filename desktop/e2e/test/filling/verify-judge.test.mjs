// Verdicts of "Confirmed offline" (lib/verify-judge.mjs): a fix is confirmed only by two agreeing on-recording replays whose control holds; everything else says "Needs a recording". Pure: no browser.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildOf, compare, judgeFixed, judgeRegression} from '../../lib/verify-judge.mjs';
import {slotsLeftOf} from '../../lib/upload-slots.mjs';

const form = (filled, left) => ({reached: 'form', filled, left});
const rec = (outcome, liveOutcome, {hit = 4, asks = 4, extra = 0, notRecorded = 0} = {}) => ({outcome, liveOutcome, live: {asks}, network: {hit, extra, notRecorded}});
const stuck = {reached: 'account', filled: null, left: null};
const control = rec(stuck, stuck);
const fixed = {recordedAt: '2026-10-12T10:00:00Z', landedAt: '2026-10-13T10:00:00Z', control};

test('compare: a later step, more filled or fewer left is further; a missing side is null', () => {
  assert.equal(compare(form(5, 5), stuck), 1);
  assert.equal(compare(form(5, 5), form(5, 5)), 0);
  assert.equal(compare(form(4, 6), form(5, 5)), -1);
  assert.equal(compare(null, stuck), null);
});

test('a fix is confirmed by two agreeing on-recording replays that go further than live', () => {
  const run = rec(form(8, 2), stuck);
  assert.equal(judgeFixed({...fixed, runs: [run, run]}).verdict, 'confirmed');
});

test('every other case says live or not better, never confirmed', () => {
  const run = rec(form(8, 2), stuck), same = rec(stuck, stuck), post = rec({reached: 'posting'}, stuck), cases = {
    'one replay': [[run], 'live'],
    'two replays disagree': [[run, rec(form(3, 7), stuck)], 'live'],
    'the build asks what the recording lacks': [[run, rec(form(8, 2), stuck, {extra: 1})], 'live'],
    'a site request not recorded': [[run, rec(form(8, 2), stuck, {notRecorded: 1})], 'live'],
    'ends where live did': [[same, same], 'notbetter'],
    'goes less far': [[post, post], 'notbetter']};
  for (const [name, [runs, verdict]] of Object.entries(cases)) assert.equal(judgeFixed({...fixed, runs}).verdict, verdict, name);
  assert.equal(judgeFixed({...fixed, runs: [run, run], control: rec(form(8, 2), stuck)}).verdict, 'live', 'the control replays to another outcome than live');
  assert.equal(judgeFixed({...fixed, runs: [run, run], control: null}).verdict, 'live', 'no control');
  assert.equal(judgeFixed({...fixed, runs: [run, run], recordedAt: '2026-10-14T00:00:00Z'}).verdict, 'live', 'recorded after the fix, no replay on the build before it');
  assert.equal(judgeFixed({...fixed, runs: [run, run], recordedAt: null}).verdict, 'live', 'no recording');
});

test('a regression: the older build going further on the same recording is ours; the same stop is the site; off the recording is live', () => {
  const further = rec(form(8, 2), stuck), also = rec(stuck, stuck);
  assert.equal(judgeRegression({control, runs: [further, further]}).verdict, 'ours');
  assert.equal(judgeRegression({control, runs: [also, also]}).verdict, 'site');
  assert.equal(judgeRegression({control, runs: [further, rec(form(8, 2), stuck, {hit: 3, extra: 1})]}).verdict, 'live');
  assert.equal(judgeRegression({control: null, runs: [further, further]}).verdict, 'live');
});

test('a recording builds from its stamped version, else from the time it was made', () => {
  const versions = [{version: '0.9.10', hash: 'aaa', at: '2026-10-10T00:00:00Z'}, {version: '0.9.11', hash: 'ccc', at: '2026-10-12T00:00:00Z'}];
  const commits = [{hash: 'aaa', at: '2026-10-10T00:00:00Z'}, {hash: 'bbb', at: '2026-10-11T00:00:00Z'}, {hash: 'ccc', at: '2026-10-12T00:00:00Z'}, {hash: 'ddd', at: '2026-10-13T00:00:00Z'}];
  const startMs = Date.parse('2026-10-11T12:00:00Z');
  assert.deepEqual(buildOf({log: 'x "version":"0.9.10" y', startMs, versions, commits}), {commit: 'bbb', by: 'version'});
  assert.deepEqual(buildOf({log: 'no stamp', startMs, versions, commits}), {commit: 'bbb', by: 'time'});
  assert.equal(buildOf({log: '', startMs: Date.parse('2026-01-01'), versions, commits}), null);
});

test('a recording after the fix: confirmed when main goes further than the build before the fix on it; same or off the recording is not', () => {
  const late = {...fixed, recordedAt: '2026-10-14T10:00:00Z'}, run = rec(form(8, 2), form(8, 2)), old = rec(stuck, form(8, 2));
  assert.equal(judgeFixed({...late, runs: [run, run], before: old}).verdict, 'confirmed');
  assert.equal(judgeFixed({...late, runs: [run, run], before: rec(form(8, 2), form(8, 2))}).verdict, 'notbetter');
  assert.equal(judgeFixed({...late, runs: [run, run], before: rec(stuck, form(8, 2), {extra: 1})}).verdict, 'live', 'the older build asks what the recording lacks');
  assert.equal(judgeFixed({...late, runs: [run, run], before: old, control: rec(stuck, form(8, 2))}).verdict, 'live', 'the control fails');
});

test('an optional upload slot the page lists is not a left field: listing two more of them is not "goes less far"', () => {
  // Valora (15 Oct 2026): the fixed build lists "Weitere Dokumente" and "Maximal 50 MB" (type file, required false, "upload: no file for this question") as left: 9 filled, 6 left against 9 filled, 4 left.
  const before = {reached: 'form', filled: 9, left: 4, slotsLeft: 0}, after = {reached: 'form', filled: 9, left: 6, slotsLeft: 2};
  assert.equal(compare(after, before), 0);
  assert.equal(compare({...after, left: 7}, before), -1, 'a real extra left field still counts');
  assert.equal(compare({reached: 'form', filled: 9, left: 6}, before), -1, 'an outcome with no slot count (an older record) is read as before');
});

test('slotsLeftOf counts only left, optional file fields', () => {
  const fields = [{outcome: 'left', type: 'file', required: false}, {outcome: 'left', type: 'file', required: null}, {outcome: 'left', type: 'file', required: true}, {outcome: 'filled', type: 'file', required: false}, {outcome: 'left', type: 'text', required: false}];
  assert.equal(slotsLeftOf(fields), 2);
  assert.equal(slotsLeftOf(undefined), 0);
});

test('holds offline: the control and today\'s build match live, the build before the fix asks what the recording lacks', () => {
  const late = {...fixed, recordedAt: '2026-10-14T10:00:00Z'}, now = rec(form(8, 2), form(8, 2)), ctl = rec(form(8, 2), form(8, 2));
  const asksMore = rec(stuck, form(8, 2), {extra: 1});
  assert.equal(judgeFixed({...late, control: ctl, runs: [now, now], before: asksMore}).verdict, 'holds');
  assert.equal(judgeFixed({...late, control: ctl, runs: [now, now], before: rec(stuck, form(8, 2), {notRecorded: 1})}).verdict, 'holds', 'a site fetch the recording lacks counts the same');
  assert.match(judgeFixed({...late, control: ctl, runs: [now, now], before: asksMore}).why, /changes what the AI is asked/);
  // never holds:
  assert.equal(judgeFixed({...late, control: ctl, runs: [now, now], before: null}).verdict, 'live', 'the before replay failed altogether');
  assert.equal(judgeFixed({...late, control: ctl, runs: [now, now], before: {outcome: null, network: {hit: 0, extra: 0, notRecorded: 0}}}).verdict, 'live', 'the before replay gave no outcome');
  assert.equal(judgeFixed({...late, control: rec(stuck, form(8, 2)), runs: [now, now], before: asksMore}).verdict, 'live', 'the control does not match live');
  assert.equal(judgeFixed({...late, control: ctl, runs: [rec(form(3, 7), form(8, 2)), now], before: asksMore}).verdict, 'live', 'two replays of today\'s build disagree');
  assert.equal(judgeFixed({...late, control: ctl, runs: [rec(stuck, form(8, 2)), rec(stuck, form(8, 2))], before: asksMore}).verdict, 'live', 'today\'s build does not match live');
  assert.equal(judgeFixed({...late, control: ctl, runs: [now, now], before: rec(stuck, form(8, 2))}).verdict, 'confirmed', 'a before that replays on the recording is still Confirmed offline');
});
