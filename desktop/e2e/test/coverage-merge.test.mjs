// The map fed by runs of some steps only (an after-merge run): the steps it ran replace theirs, the others keep theirs, moved to its commit by the git diff.
import test from 'node:test';
import assert from 'node:assert/strict';
import {lineMoves, mergeMap, shiftRanges} from '../lib/coverage-pick.mjs';
import {saveCoverage, SETUP, WHOLE} from '../lib/coverage.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const lines = (...ranges) => ({loaded: true, lines: ranges});
const diff = (...rows) => ['diff --git a/f.js b/f.js', '--- a/f.js', '+++ b/f.js', ...rows].join('\n');

test('a line moves by the hunks above it; a changed line becomes the new lines; a deleted one goes', () => {
  // 2 lines inserted after line 3; lines 10-11 changed into 10-12 (new 12-14); line 20 deleted (new: after 22)
  const moves = lineMoves(diff('@@ -3,0 +4,2 @@', '+a', '+b', '@@ -10,2 +12,3 @@', '-x', '-y', '+x', '+y', '+z', '@@ -20,1 +22,0 @@', '-gone'));
  assert.deepEqual(moves, {'f.js': [[3, 0, 4, 2], [10, 2, 12, 3], [20, 1, 22, 0]]});
  assert.deepEqual(shiftRanges([[1, 3]], moves['f.js']), [[1, 3]], 'above the insertion: unmoved');
  assert.deepEqual(shiftRanges([[4, 5]], moves['f.js']), [[6, 7]], 'below it: +2');
  assert.deepEqual(shiftRanges([[2, 5]], moves['f.js']), [[2, 3], [6, 7]], 'across it: split, the inserted lines not claimed');
  assert.deepEqual(shiftRanges([[9, 11]], moves['f.js']), [[11, 14]], 'into a changed hunk: its new lines');
  assert.deepEqual(shiftRanges([[19, 21]], moves['f.js']), [[22, 23]], 'around a deleted line: it goes, the rest move');
  assert.deepEqual(shiftRanges([[30, 30]], moves['f.js']), [[32, 32]], 'far below: +2 +1 -1');
});

test('a "-- " line removed (SQL, Lua) is a line, not a file header; a deleted file is gone', () => {
  const text = ['diff --git a/q.sql b/q.sql', '--- a/q.sql', '+++ b/q.sql', '@@ -2,1 +2,1 @@', '--- old note', '+-- new note',
    'diff --git a/gone.js b/gone.js', 'deleted file mode 100644', '--- a/gone.js', '+++ /dev/null', '@@ -1,3 +0,0 @@', '-a', '-b', '-c'].join('\n');
  assert.deepEqual(lineMoves(text), {'q.sql': [[2, 1, 2, 1]], 'gone.js': false});
});

const OLD = {suites: {jobs: {sha: 'A', at: 't0', files: {'f.js': lines([1, 30])},
  steps: {[SETUP]: {'f.js': lines([1, 2])}, 'Open a job': {'f.js': lines([4, 5])}, 'Save a job': {'f.js': lines([20, 30])}, [WHOLE]: {'m.py': lines([1, 1])}}}}};

test('a run of some steps refreshes those steps and moves the others to its commit', () => {
  const asked = [];
  const run = [{suite: 'jobs', sha: 'B', partial: true, files: {'f.js': lines([6, 8])}, steps: {[SETUP]: {'f.js': lines([1, 2])}, 'Open a job': {'f.js': lines([6, 8])}}}];
  const map = mergeMap(OLD, run, 't1', {diff: (from, to, files) => { asked.push([from, to, files]); return diff('@@ -3,0 +4,2 @@', '+a', '+b'); }});
  assert.deepEqual(asked, [['A', 'B', ['f.js']]]);
  const entry = map.suites.jobs;
  assert.equal(entry.sha, 'B');
  assert.equal(entry.at, 't1');
  assert.deepEqual(entry.steps['Open a job']['f.js'].lines, [[6, 8]], 'the step it ran: replaced');
  assert.deepEqual(entry.steps['Save a job']['f.js'].lines, [[22, 32]], 'a step it did not run: kept, moved by the 2 inserted lines');
  assert.deepEqual(entry.steps[SETUP]['f.js'].lines, [[1, 2]]);
  assert.deepEqual(entry.steps[WHOLE], {'m.py': lines([1, 1])}, 'import-time lines: kept (a union)');
  assert.deepEqual(entry.files['f.js'].lines, [[1, 3], [6, 32]]);
});

test('a full run still replaces the entry; a partial one with no diff, no old steps or no old entry leaves the map as it was', () => {
  const full = [{suite: 'jobs', sha: 'B', files: {'f.js': lines([1, 1])}, steps: {'Open a job': {'f.js': lines([1, 1])}}}];
  assert.deepEqual(mergeMap(OLD, full, 't1', {diff: () => { throw new Error('a full run needs no diff'); }}).suites.jobs.steps, {'Open a job': {'f.js': lines([1, 1])}});
  const partial = full.map(file => ({...file, partial: true}));
  assert.equal(mergeMap(OLD, partial, 't1', {diff: () => null}).suites.jobs, OLD.suites.jobs, 'no diff (an unknown commit): kept');
  assert.equal(mergeMap(OLD, partial, 't1').suites.jobs, OLD.suites.jobs, 'no diff reader: kept');
  const noSteps = {suites: {jobs: {sha: 'A', at: 't0', files: {'f.js': lines([1, 9])}}}};
  assert.equal(mergeMap(noSteps, partial, 't1', {diff: () => ''}).suites.jobs, noSteps.suites.jobs, 'a map from before steps: kept, whole-suite picking');
  assert.equal(mergeMap({suites: {}}, partial, 't1', {diff: () => ''}).suites.jobs, undefined, 'never recorded: a partial run does not make it look recorded');
  const mixed = [...partial, {suite: 'jobs', sha: 'B', files: {'g.js': lines([2, 2])}, steps: {'Save a job': {'g.js': lines([2, 2])}}}];
  assert.deepEqual(Object.keys(mergeMap(OLD, mixed, 't1').suites.jobs.steps), ['Open a job', 'Save a job'], 'one full file of the suite (the whole second try): replaced');
  const same = mergeMap(OLD, [{...partial[0], sha: 'A'}], 't1', {diff: () => { throw new Error('same commit: no diff'); }}).suites.jobs;
  assert.deepEqual(same.steps['Save a job'], OLD.suites.jobs.steps['Save a job']);
});

const bare = () => ({number: 1, steps: {}, window: null, main: false});

test('a coverage file says when its run was some steps only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-partial-'));
  return Promise.all([
    [{E2E_SUITE: 'a', E2E_STEP_NAMES: '["Open a job"]'}, true], [{E2E_SUITE: 'b', E2E_STEPS: 'open'}, true],
    [{E2E_SUITE: 'c', E2E_STEP_NAMES: 'null'}, false], [{E2E_SUITE: 'd'}, false],
  ].map(async ([env, partial]) => {
    const file = await saveCoverage(bare(), dir, {...env, E2E_PY_COVERAGE_DIR: ''});
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).partial, partial, JSON.stringify(env));
  }));
});
