// A pull request runs the e2e STEPS its changed lines reach (PR 2 of the PR-checks plan; owner, 26 Oct 2026: "Or not even an entire e2e suite, but just few
// tests/scenarios/cases from that suite"): per-step coverage (lib/coverage.mjs) merged per suite, picked per changed line (lib/coverage-pick.mjs stepsCovering).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cssDeltaEntries, SETUP} from '../lib/coverage.mjs';
import {hunksFromDiff, mergeMap, stepNamesFor, stepsCovering} from '../lib/coverage-pick.mjs';

const lines = (...ranges) => ({loaded: true, lines: ranges});
const MAP = {suites: {
  jobs: {sha: 'S', files: {'desktop/lib/pipeline-queue.js': lines([1, 200]), 'desktop/renderer/app.js': lines([1, 40])},
    steps: {'Find jobs shows each step': {'desktop/lib/pipeline-queue.js': lines([130, 160])}, 'Open a job': {'desktop/renderer/app.js': lines([20, 30])},
      [SETUP]: {'desktop/renderer/app.js': lines([1, 10]), 'desktop/lib/pipeline-queue.js': lines([1, 20])}}},
  settings: {sha: 'S', files: {'desktop/lib/pipeline-queue.js': lines([1, 20]), 'desktop/renderer/app.js': lines([1, 10])},
    steps: {'Export the profile': {'desktop/lib/export.js': lines([1, 9])}, [SETUP]: {'desktop/renderer/app.js': lines([1, 10]), 'desktop/lib/pipeline-queue.js': lines([1, 20])}}},
  activity: {sha: 'S', files: {'desktop/lib/pipeline-queue.js': lines([1, 20], [140, 150])},
    steps: {'Live updates keep each result': {'desktop/lib/pipeline-queue.js': lines([140, 150])}, [SETUP]: {'desktop/lib/pipeline-queue.js': lines([1, 20])}}},
}};

test('a changed line picks only the steps that ran it, in each suite', () => {
  const picked = stepsCovering(MAP, {S: {'desktop/lib/pipeline-queue.js': [[142, 143]]}});
  assert.deepEqual(Object.keys(picked).sort(), ['activity', 'jobs']);
  assert.deepEqual(picked.jobs.steps, ['Find jobs shows each step']);
  assert.deepEqual(picked.activity.steps, ['Live updates keep each result']);
  assert.deepEqual(stepNamesFor(picked), {jobs: ['Find jobs shows each step'], activity: ['Live updates keep each result']});
});

test('a line only launch ran: the setup of one suite (settings), not every suite', () => {
  const picked = stepsCovering(MAP, {S: {'desktop/renderer/app.js': [[5, 5]]}});
  assert.deepEqual(Object.keys(picked), ['settings']);
  assert.deepEqual(stepNamesFor(picked), {settings: [SETUP]});
  const withStep = stepsCovering(MAP, {S: {'desktop/renderer/app.js': [[5, 5], [25, 25]]}});
  assert.deepEqual(Object.keys(withStep), ['jobs'], 'a suite that runs anyway runs its setup');
});

test('a line no suite ran: every suite that loads the file, whole', () => {
  const picked = stepsCovering(MAP, {S: {'desktop/lib/pipeline-queue.js': [[300, 301]]}});
  assert.deepEqual(Object.keys(picked).sort(), ['activity', 'jobs', 'settings']);
  assert.deepEqual(stepNamesFor(picked), {});
});

test('a suite recorded before steps were runs whole by its lines', () => {
  const old = {suites: {cardstates: {sha: 'S', files: {'desktop/renderer/app.js': lines([1, 40])}}}};
  assert.deepEqual(stepsCovering(old, {S: {'desktop/renderer/app.js': [[25, 25]]}}), {cardstates: {steps: [], setup: false, whole: true, reason: 'runs desktop/renderer/app.js:25'}});
});

test("a hunk of comments only changes nothing (#1992's header comment picked 17 suites)", () => {
  const diff = ['diff --git a/desktop/lib/pipeline-lines.js b/desktop/lib/pipeline-lines.js', '--- a/desktop/lib/pipeline-lines.js', '+++ b/desktop/lib/pipeline-lines.js',
    '@@ -1,1 +1,1 @@', '-// Owns: reading the engine lines', '+// Owns: reading the engine lines, keepRunLine',
    '@@ -53,3 +53,2 @@', '-// A line that says', '-export const STATUS_LINE = /x/;', '+export {STATUS_LINE} from "../renderer/run-lines.js";',
    'diff --git a/desktop/renderer/x.css b/desktop/renderer/x.css', '--- a/desktop/renderer/x.css', '+++ b/desktop/renderer/x.css', '@@ -4,1 +4,1 @@', '-/* a */', '+/* b */'].join('\n');
  assert.deepEqual(hunksFromDiff(diff), {'desktop/lib/pipeline-lines.js': [[53, 55]]});
});

test('the map keeps each suite\'s steps; a newer run of a suite replaces them', () => {
  const run1 = [{suite: 'jobs', sha: 'A', files: {'f.js': lines([1, 2])}, steps: {'Open a job': {'f.js': lines([1, 2])}}}];
  const run2 = [{suite: 'jobs', sha: 'B', files: {'f.js': lines([5, 6])}, steps: {'Open a job': {'f.js': lines([5, 6])}}},
    {suite: 'jobs', sha: 'B', files: {'f.js': lines([8, 8])}, steps: {'Open a job': {'f.js': lines([8, 8])}}}];
  const map = mergeMap(mergeMap(null, run1, 't1'), run2, 't2');
  assert.deepEqual(map.suites.jobs.steps['Open a job']['f.js'].lines, [[5, 6], [8, 8]]);
  assert.equal(map.suites.jobs.sha, 'B');
});

test('CSS coverage delta → the used rules of each app sheet', () => {
  const sheets = {s1: {url: 'file:///r/desktop/renderer/menu.css', text: '.a{}\n.b{}\n'}, s2: {url: '', text: 'inline'}};
  const usage = [{styleSheetId: 's1', startOffset: 5, endOffset: 9, used: true}, {styleSheetId: 's1', startOffset: 0, endOffset: 4, used: false}, {styleSheetId: 's2', startOffset: 0, endOffset: 3, used: true}];
  assert.deepEqual(cssDeltaEntries(usage, sheets), [{url: 'file:///r/desktop/renderer/menu.css', text: '.a{}\n.b{}\n', ranges: [{start: 5, end: 9}]}]);
});
