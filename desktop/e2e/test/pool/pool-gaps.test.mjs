// The gaps between a pool row's progress notes (lib/pool-gaps.mjs; spec 2026-10-12-one-next-move.md phase 2 box 2): the silent dead-end rule's T is read from them, so the
// parser must take exactly the extension's "progress: <kind>" lines, the time between them in any tab of the application, and the silence after the last note.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {askSpans, quietBetween, appLogName, detectorAt, doorLines, gapRows, gapSummary, progressOf, quantile, rowGaps, runEvents, silentFires} from '../../lib/pool-gaps.mjs';
import {PROGRESS_KINDS} from '../../../../extension/ladder/progress.js';

const line = (at, text) => `2026-10-13T00:00:${String(at).padStart(2, '0')}.000Z ${text}`;
const log = [
  line(0, '[extension] fill: page kind: posting {"by":"ai","host":"jobs.example","version":"0.9.256"}'),
  line(1, '[extension] fill: progress: navigated {"host":"jobs.example","version":"0.9.256"}'),
  line(3, '[extension] fill: pressed the Apply button {"host":"jobs.example","version":"0.9.256"}'),
  line(5, '[extension] fill: progress: navigated {"host":"apply.example","version":"0.9.256"}'),
  line(9, '[extension] fill: progress: required_down {"filled":3,"host":"jobs.example","sinceMs":4000,"version":"0.9.256"}'),
  line(12, '[extension] fill: progress: clicked {"sinceMs":3000}'),
  line(30, '[extension] fill: dead end: other {"ending":"unresolved","named":false}'),
  line(35, '[extension] fill: dead end: silent {"host":"apply.example","shadow":true,"ending":"unresolved","kind":"required_down","silentMs":26000}'),
  line(40, '[store] agent_runs.add {"exit":0}'),
].join('\n');

test('only the extension\'s progress lines of a listed kind count', () => {
  assert.deepEqual(progressOf(log), [
    {at: Date.parse('2026-10-13T00:00:01.000Z'), kind: 'navigated'},
    {at: Date.parse('2026-10-13T00:00:05.000Z'), kind: 'navigated'},
    {at: Date.parse('2026-10-13T00:00:09.000Z'), kind: 'required_down'}]);
  assert.deepEqual(progressOf(`${line(1, '[app] fill: progress: navigated {}')}\nnot a line`), [], 'another source, or no time, is not progress');
  assert.ok(['navigated', 'required_down'].every(kind => PROGRESS_KINDS.includes(kind)), 'the kinds the test writes are the extension\'s own');
});

test('a row is one application: its gaps (wall-clock between notes in any tab, so a new tab never leaves the posting tab "silent"), the slowest, the silence after the last note to the log\'s end, and the door\'s lines told apart by their shadow field', () => {
  assert.deepEqual(rowGaps(log), {events: 3, gaps: [{ms: 4000, quietMs: 4000, kind: 'navigated'}, {ms: 4000, quietMs: 4000, kind: 'required_down'}], maxGapMs: 4000, maxQuietMs: 4000, tailMs: 31000, deadEnd: true, silent: 1});
  assert.deepEqual(rowGaps(line(0, '[extension] fill: page kind: other {}')), {events: 0, gaps: [], maxGapMs: 0, maxQuietMs: 0, tailMs: null, deadEnd: false, silent: 0}, 'a build without progress notes is not measured');
  assert.deepEqual(doorLines(line(1, '[extension] fill: dead end: silent {"shadow":true}')), {stops: 0, seen: 1}, 'a shadow notice alone is no stop');
});

test('one row per row the run ran, with its ending; the summary: quantiles of every gap, the slowest on rows that reached the form, rows not measured', () => {
  const report = {day: '2026-10-13', thisRun: {ran: ['A', 'B', 'C']}, results: {A: {reached: 'form', ending: 'ready'}, B: {reached: 'account', ending: 'unresolved'}, C: {ending: 'held'}, Old: {ending: 'ready'}}};
  const slow = [line(0, '[extension] fill: progress: navigated {}'), line(20, '[extension] fill: progress: new_controls {"sinceMs":20000}')].join('\n');
  const rows = gapRows(report, {A: log, B: slow, Old: log});
  assert.deepEqual(rows.map(row => [row.row, row.ending, row.maxGapMs, row.measured]), [['A', 'ready', 4000, true], ['B', 'unresolved', 20000, true], ['C', 'held', 0, false]]);
  assert.deepEqual(gapSummary(rows), {measured: 2, notMeasured: 1, gaps: 3, p50: 4000, p90: 20000, p95: 20000, p99: 20000, max: 20000, quietMax: 20000, maxReady: 4000});
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([1000, 2000, 3000, 4000], 0.5), 3000);
});

test('a row\'s app log is found by the name record-sites.mjs writes it under', () => {
  assert.equal(appLogName('2026-10-13', 'arbeitnow.ch board -> employer'), '2026-10-13-arbeitnow-ch-board-employer.app.log');
  const smoke = fs.readFileSync(new URL('../../record-sites.mjs', import.meta.url), 'utf8');
  assert.match(smoke, /`\$\{day\}-\$\{shape\.replace\(\/\\W\+\/g, '-'\)\}\.app\.log`/, 'record-sites.mjs renamed its app log: change appLogName with it');
});

// The silent rule offline (phase 2 box 3): the extension's own rule over the same lines, so recall and false fires are measured on any CI pool run.
const T = 30000, at = s => `2026-10-13T00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000Z`;
const note = (s, kind = 'navigated') => `${at(s)} [extension] fill: progress: ${kind} {}`;
const judge = (s, answer, step) => `${at(s)} [extension] panel: application form ready?: ${answer} {"host":"x.example","step":"${step}"}`;
const door = s => `${at(s)} [extension] fill: dead end: no-form {"ending":"handed","named":true}`;
const other = s => `${at(s)} [extension] fill: pressed the Apply button {}`;

test('the run\'s events: notes restart, the door\'s stop and a page handed to the person end; a shadow notice, a middle step or a block end nothing', () => {
  const log = [note(0), judge(5, 'ready', 'middle'), judge(6, 'blocked', 'final'), `${at(7)} [extension] fill: dead end: silent {"shadow":true}`, judge(8, 'needs_person', 'final'), door(9), judge(10, 'ready', 'final')].join('\n');
  assert.deepEqual(runEvents(log).map(event => event.type === 'end' ? event.why : event.kind), ['navigated', 'handed', 'door', 'handed']);
});

test('fires once per silence of T after the last note while the run has not ended; activity without progress is silence; an ended run never fires', () => {
  assert.deepEqual(silentFires([note(0), other(10), other(40), note(50, 'required_down'), other(85)].join('\n'), T), {fires: [{afterMs: 30000, kind: 'navigated'}, {afterMs: 80000, kind: 'required_down'}], openTailMs: null});
  assert.deepEqual(silentFires([note(0), door(5), other(90)].join('\n'), T), {fires: [], openTailMs: null}, 'the door spoke: silence is expected');
  assert.deepEqual(silentFires([note(0), judge(5, 'ready', 'final'), other(90)].join('\n'), T), {fires: [], openTailMs: null}, 'handed to the person');
  assert.deepEqual(silentFires([note(0), other(22)].join('\n'), T), {fires: [], openTailMs: 22000}, 'cut before T: the open silence is kept (censored)');
});

test('the detector on the pool\'s ground truth: recall on rows stopped before the form (the door or the silent rule), false fires on rows that reached it; holds are not outcomes', () => {
  const report = {thisRun: {ran: ['door', 'silent', 'quiet', 'missed', 'form ok', 'form stall', 'held', 'old']}, results: {
    door: {reached: 'posting', ending: 'handed'}, silent: {reached: 'posting', ending: 'unresolved'}, quiet: {reached: 'account', ending: 'unresolved'}, missed: {reached: 'posting', ending: 'unresolved'},
    'form ok': {reached: 'form', ending: 'ready'}, 'form stall': {reached: 'ready', ending: 'ready'}, held: {reached: 'account', ending: 'held'}, old: {reached: 'posting', ending: 'unresolved'}}};
  const logs = {door: [note(0), door(3), other(60)].join('\n'), silent: [note(0), other(20), other(45)].join('\n'), quiet: [note(0), other(25)].join('\n'), missed: [note(0), other(5)].join('\n'),
    'form ok': [note(0), note(20, 'required_down'), judge(25, 'ready', 'final'), other(70)].join('\n'), 'form stall': [note(0), other(40)].join('\n'), held: [note(0), other(90)].join('\n'), old: 'no notes'};
  assert.deepEqual(detectorAt(report, logs, T, 20000), {T, stopped: 4, detected: 2, silentOnly: 1, missed: ['quiet', 'missed'], censored: 1, reached: 2, falseFires: ['form stall']});
});

test('the form judge still writes the line the offline rule reads (a rename fails here, never silently)', () => {
  const ready = fs.readFileSync(new URL('../../../../extension/form-ready.js', import.meta.url), 'utf8');
  assert.match(ready, /decide\('panel', `application form ready\?: \$\{answer\.answer\}`, \{host, step: answer\.step \|\| ''/);
});

test('asks to the app are a wait: the spans the log shows are taken out of a gap and of the silence, and a fire comes T of quiet later', () => {
  const answered = `${at(40)} [fill] Claude answered 7 of 15 question(s) {"fields":15,"ms":29000}`;   // asked at 11 s, answered at 40 s
  const spans = askSpans([note(0), answered, `${at(45)} [extension] fill: page kind: form {"ms":1500}`, `${at(50)} [fill] no ms here {}`].join('\n'));
  assert.deepEqual(spans, [[Date.parse(at(11)), Date.parse(at(40))], [Date.parse(at(45)) - 1500, Date.parse(at(45))]]);
  assert.equal(quietBetween(spans, Date.parse(at(0)), Date.parse(at(50))), 50000 - 29000 - 1500);
  const slow = [note(0), answered, note(52, 'required_down')].join('\n');
  assert.equal(rowGaps(slow).gaps[0].ms, 52000);
  assert.equal(rowGaps(slow).gaps[0].quietMs, 23000, 'the gap a normal run spent mostly waiting on the AI is 23 s of quiet');
  assert.deepEqual(silentFires(slow, T).fires, [], 'the wall-time rule would fire at 30 s; with the ask taken out it does not');
  assert.equal(silentFires(slow, T, {asks: false}).fires.length, 1);
  assert.deepEqual(silentFires([note(0), answered, other(90)].join('\n'), T).fires, [{afterMs: 59000, kind: 'navigated'}], '30 s of quiet + the 29 s ask');
});
