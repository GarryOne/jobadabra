// A pull request runs the e2e STEPS its changed lines reach (PR 2 of the PR-checks plan; owner, 26 Oct 2026: "Or not even an entire e2e suite, but just few
// tests/scenarios/cases from that suite"): per-step coverage (lib/coverage.mjs) merged per suite, picked per changed line (lib/coverage-pick.mjs stepsCovering).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {cssDeltaEntries, pythonCoverage, pythonSteps, SETUP, takeSetup, takeStep, WHOLE} from '../lib/coverage.mjs';
import {hunksFromDiff, mergeMap, stepNamesFor, steplessSuites, stepsCovering, stillWhole} from '../lib/coverage-pick.mjs';

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

test('a line more than MAX_USERS suites ran is shared code (launch, the server): only the settings smoke runs it (#2118, #2119 ran 20 suites whole)', () => {
  const launch = {'desktop/lib/server.js': lines([40, 60])};
  const stepless = name => [name, {sha: 'S', files: launch}];
  const map = {suites: {...Object.fromEntries(['activity', 'apply', 'jobs', 'wander'].map(stepless)),
    settings: {sha: 'S', files: launch, steps: {'Export the profile': {}, [SETUP]: launch}}}};
  assert.deepEqual(stepNamesFor(stepsCovering(map, {S: {'desktop/lib/server.js': [[51, 51]]}})), {settings: [SETUP]}, 'its setup ran it: settings setup only');
  const inSteps = {suites: {...map.suites, settings: {sha: 'S', files: launch, steps: {'Export the profile': launch, [SETUP]: {}}}}};
  assert.deepEqual(stepNamesFor(stepsCovering(inSteps, {S: {'desktop/lib/server.js': [[51, 51]]}})), {settings: ['Export the profile']}, 'its steps ran it: those steps');
  const noSmoke = {suites: Object.fromEntries(['activity', 'apply', 'jobs', 'wander'].map(stepless))};
  assert.deepEqual(Object.keys(stepsCovering(noSmoke, {S: {'desktop/lib/server.js': [[51, 51]]}})), ['activity'], 'no smoke among them: one of them');
  const few = {suites: Object.fromEntries(['activity', 'apply', 'jobs'].map(stepless))};
  assert.deepEqual(Object.keys(stepsCovering(few, {S: {'desktop/lib/server.js': [[51, 51]]}})).sort(), ['activity', 'apply', 'jobs'], 'MAX_USERS or fewer: each of them, as before');
});

test('a line no suite ran, in a file more than MAX_USERS suites load: the settings smoke\'s setup proves it still loads (#2118\'s new import, #2119\'s unrun branch)', () => {
  const loaded = {'desktop/lib/app-notify.js': lines([10, 20])};
  const stepless = name => [name, {sha: 'S', files: loaded}];
  const map = {suites: {...Object.fromEntries(['activity', 'apply', 'jobs', 'wander'].map(stepless)), settings: {sha: 'S', files: loaded, steps: {[SETUP]: loaded}}}};
  assert.deepEqual(stepNamesFor(stepsCovering(map, {S: {'desktop/lib/app-notify.js': [[3, 3]]}})), {settings: [SETUP]});
  const few = {suites: {jobs: {sha: 'S', files: loaded, steps: {[SETUP]: loaded}}, settings: map.suites.settings}};
  assert.deepEqual(Object.values(stepsCovering(few, {S: {'desktop/lib/app-notify.js': [[3, 3]]}})).map(p => p.whole), [true, true], 'few loaders: each of them whole, as before');
});

test('the suites with no step data are named (the 26 Oct map: 19 of 20 were, and every pick was whole without a word)', () => {
  const map = {suites: {jobs: {sha: '9892af1aaaa', at: '2026-10-26T02:29:00Z', files: {}}, settings: {sha: 'd96bc13', files: {}, steps: {}}}};
  assert.deepEqual(steplessSuites(map), [{suite: 'jobs', sha: '9892af1', at: '2026-10-26T02:29'}]);
  assert.deepEqual(steplessSuites({}), []);
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

// Python (owner's yes, 26 Oct 2026: scoring PRs ran the whole quality suite, 10-22 min): lib/pycov/sitecustomize.py records the src/ lines each engine process ran.
const PY = {suites: {quality: {sha: 'S', files: {'src/ai/score.py': lines([1, 120])},
  steps: {'a Jobs check scores them': {'src/ai/score.py': lines([40, 60])}, [WHOLE]: {'src/ai/score.py': lines([1, 12], [30, 30])}}}}};

test('Python: a function line picks its steps; a line run at import runs the suite whole; a comment changes nothing', () => {
  assert.deepEqual(stepNamesFor(stepsCovering(PY, {S: {'src/ai/score.py': [[45, 46]]}})), {quality: ['a Jobs check scores them']});
  const atImport = stepsCovering(PY, {S: {'src/ai/score.py': [[30, 30]]}});
  assert.equal(atImport.quality.whole, true);
  assert.deepEqual(stepNamesFor(atImport), {});
  assert.deepEqual(hunksFromDiff('diff --git a/src/ai/score.py b/src/ai/score.py\n--- a/src/ai/score.py\n+++ b/src/ai/score.py\n@@ -45 +45 @@\n-    # old\n+    # new\n'), {});
  assert.deepEqual(Object.keys(hunksFromDiff('--- a/desktop/x.css\n+++ b/desktop/x.css\n@@ -4 +4 @@\n-#menu { color: red }\n+#menu { color: blue }\n')), ['desktop/x.css'], 'a CSS rule on an id is code');
});

test('Python records join the step map: one step -> that step; across steps or at import -> the whole suite', () => {
  const steps = pythonSteps({}, [
    {start: 'Score', end: 'Score', files: {'src/a.py': {body: [[10, 12]], load: [[1, 3]]}}},
    {start: 'Score', end: 'Open a job', files: {'src/b.py': {body: [[5, 6]], load: []}}},
    {start: SETUP, end: SETUP, files: {'src/c.py': {body: [[7, 7]], load: []}}},
    {start: '', end: '', files: {'src/d.py': {body: [[8, 8]], load: []}}}]);
  assert.deepEqual(steps.Score, {'src/a.py': lines([10, 12])});
  assert.deepEqual(steps[WHOLE], {'src/a.py': lines([1, 3]), 'src/b.py': lines([5, 6])});
  assert.deepEqual(steps[SETUP], {'src/c.py': lines([7, 7]), 'src/d.py': lines([8, 8])});
});

test('the step a Python process sees: the running step\'s name, setup between steps; nothing without coverage', async () => {
  const env = {E2E_COVERAGE: '1', PYTHONPATH: '/elsewhere'};
  const dir = pythonCoverage(env);
  assert.equal(env.E2E_PY_COVERAGE_DIR, dir);
  const [hook, rest] = env.PYTHONPATH.split(path.delimiter);
  assert.ok(fs.existsSync(path.join(hook, 'sitecustomize.py')));
  assert.equal(rest, '/elsewhere');
  assert.equal(pythonCoverage(env), dir, 'once per suite process');
  const step = () => fs.readFileSync(path.join(dir, 'step'), 'utf8');
  assert.equal(step(), SETUP);
  await takeSetup(null, 'Score the jobs', env); assert.equal(step(), 'Score the jobs');
  await takeStep(null, 'Score the jobs', env); assert.equal(step(), SETUP);
  const off = {};
  assert.equal(pythonCoverage(off), '');
  assert.deepEqual(off, {});
});

test('a file a suite watches runs it whole only until the step map has recorded that file for it', () => {
  const pointsAt = file => ({'src/ai/score.py': ['quality'], 'src/ai/new.py': ['quality'], 'desktop/e2e/suites/quality.mjs': ['quality']})[file] || [];
  assert.deepEqual(stillWhole(['src/ai/score.py'], pointsAt, PY), [], 'its lines decide');
  assert.deepEqual(stillWhole(['src/ai/score.py', 'src/ai/new.py'], pointsAt, PY), ['quality'], 'a file no run recorded');
  assert.deepEqual(stillWhole(['desktop/e2e/suites/quality.mjs'], pointsAt, PY), ['quality'], 'its own file');
  assert.deepEqual(stillWhole(['src/ai/score.py'], pointsAt, {}), ['quality'], 'no map yet: as before');
});
