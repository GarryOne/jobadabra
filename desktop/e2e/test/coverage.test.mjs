// The code → suite map (gate G1b, 26 Oct 2026): V8/CSS coverage → repo lines (lib/coverage.mjs), merged per suite and picked by a PR's changed lines (lib/coverage-pick.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addEntries, cssLines, jsLines, lineOf, lineStarts, mergeRanges, repoPath} from '../lib/coverage.mjs';
import {hunksFromDiff, mapShas, mergeMap, suitesCovering} from '../lib/coverage-pick.mjs';
import {planPrSuites} from '../lib/pr-suites.mjs';

const ROOT = '/r';
const SRC = ['function a() {', '  return 1;', '}', 'function b() {', '  if (x) {', '    y();', '  }', '}', 'top();'].join('\n');
const at = (line, col = 0) => lineStarts(SRC)[line - 1] + col;

test('repo paths: only the app\'s own files', () => {
  assert.equal(repoPath('file:///r/desktop/renderer/app.js?v=2', ROOT), 'desktop/renderer/app.js');
  assert.equal(repoPath('/r/desktop/lib/server.js', ROOT), 'desktop/lib/server.js');
  for (const url of ['file:///r/desktop/node_modules/x/i.js', 'file:///r/desktop/e2e/lib/app.mjs', 'node:internal/x', 'https://x.test/a.js', 'file:///r/src/daily.py']) assert.equal(repoPath(url, ROOT), '', url);
});

test('line numbers from offsets', () => {
  const starts = lineStarts(SRC);
  assert.equal(lineOf(starts, 0), 1);
  assert.equal(lineOf(starts, at(4)), 4);
  assert.equal(lineOf(starts, SRC.length - 1), 9);
  assert.deepEqual(mergeRanges([[5, 6], [1, 2], [3, 3], [9, 9]]), [[1, 3], [5, 6], [9, 9]]);
});

test('JS: the functions that ran, without branches not taken; the top level only marks the file loaded', () => {
  const entry = {functions: [
    {functionName: '', ranges: [{startOffset: 0, endOffset: SRC.length, count: 1}]},
    {functionName: 'a', ranges: [{startOffset: at(1), endOffset: at(3, 1), count: 0}]},
    {functionName: 'b', ranges: [{startOffset: at(4), endOffset: at(8, 1), count: 1}, {startOffset: at(5, 9), endOffset: at(7, 3), count: 0}]},
  ]};
  assert.deepEqual(jsLines(entry, SRC), [[4, 5], [7, 8]]);
});

test('CSS: the rules used', () => {
  const text = '.a { x: 1 }\n.b { y: 2 }\n.c { z: 3 }\n';
  assert.deepEqual(cssLines({text, ranges: [{start: 0, end: 11}, {start: 24, end: 35}]}), [[1, 1], [3, 3]]);
});

test('entries of several sessions add up per file', () => {
  const files = {};
  addEntries(files, [{url: 'file:///r/desktop/renderer/menu.css', text: '.a{}\n.b{}\n', ranges: [{start: 0, end: 4}]}], {kind: 'css', root: ROOT});
  addEntries(files, [{url: 'file:///r/desktop/renderer/menu.css', text: '.a{}\n.b{}\n', ranges: [{start: 5, end: 9}]}], {kind: 'css', root: ROOT});
  addEntries(files, [{url: 'file:///r/desktop/renderer/app.js', source: SRC, functions: []}], {kind: 'js', root: ROOT});
  assert.deepEqual(files, {'desktop/renderer/menu.css': {loaded: true, lines: [[1, 2]]}, 'desktop/renderer/app.js': {loaded: true, lines: []}});
});

test('hunks from git diff -U0: changed lines on the recorded side, an insertion as the lines around it', () => {
  const diff = ['diff --git a/desktop/renderer/menu.css b/desktop/renderer/menu.css', '--- a/desktop/renderer/menu.css', '+++ b/desktop/renderer/menu.css',
    '@@ -40,2 +40,3 @@', '-x', '+y', '@@ -90,0 +92 @@', '+z', '--- /dev/null', '+++ b/desktop/renderer/new.js', '@@ -0,0 +1,3 @@'].join('\n');
  assert.deepEqual(hunksFromDiff(diff), {'desktop/renderer/menu.css': [[40, 41], [90, 91]]});
});

// 25 Oct 2026: #1911 changed the rail's rules in menu.css and broke interactions (a macOS suite); the PR ran only wander.
const MAP = {suites: {
  interactions: {sha: 'S1', files: {'desktop/renderer/menu.css': {loaded: true, lines: [[30, 60]]}, 'desktop/renderer/app.js': {loaded: true, lines: [[1, 50]]}}},
  wander: {sha: 'S1', files: {'desktop/renderer/menu.css': {loaded: true, lines: [[1, 20]]}, 'desktop/renderer/app.js': {loaded: true, lines: [[1, 10]]}}},
  cardstates: {sha: 'S2', files: {'desktop/renderer/pages/activity-render.js': {loaded: true, lines: [[100, 180]]}, 'desktop/renderer/menu.css': {loaded: true, lines: []}}},
}};

test('a change in lines a suite ran picks that suite only', () => {
  const picked = suitesCovering(MAP, {S1: {'desktop/renderer/menu.css': [[40, 41]]}, S2: {'desktop/renderer/menu.css': [[40, 41]]}});
  assert.deepEqual(Object.keys(picked), ['interactions']);
  assert.match(picked.interactions, /runs desktop\/renderer\/menu\.css:40/);
});

test('a change in lines no suite ran picks every suite that loads the file', () => {
  const picked = suitesCovering(MAP, {S1: {'desktop/renderer/menu.css': [[200, 201]]}, S2: {'desktop/renderer/menu.css': [[200, 201]]}});
  assert.deepEqual(Object.keys(picked).sort(), ['cardstates', 'interactions', 'wander']);
});

test('a file no suite loads picks nothing from the map; each suite reads the diff from its own recorded commit', () => {
  assert.deepEqual(suitesCovering(MAP, {S1: {'desktop/lib/notion.js': [[1, 2]]}}), {});
  assert.deepEqual(Object.keys(suitesCovering(MAP, {S2: {'desktop/renderer/pages/activity-render.js': [[150, 150]]}})), ['cardstates']);
  assert.deepEqual(mapShas(MAP), ['S1', 'S2']);
});

test('a run\'s coverage replaces the suites it recorded and keeps the others', () => {
  const merged = mergeMap(MAP, [{suite: 'wander', sha: 'S3', files: {'desktop/renderer/app.js': {lines: [[5, 6]]}}}, {suite: 'wander', sha: 'S3', files: {'desktop/renderer/app.js': {lines: [[7, 9]]}}}], 'now');
  assert.deepEqual(merged.suites.wander, {sha: 'S3', at: 'now', files: {'desktop/renderer/app.js': {loaded: true, lines: [[5, 9]]}}});
  assert.equal(merged.suites.interactions, MAP.suites.interactions);
});

test('a macOS suite runs on the PR when the coverage map picks it or the PR changes it (owner, 26 Oct 2026)', () => {
  const linux = suite => suite !== 'interactions' && suite !== 'apply';
  const plan = planPrSuites({pointed: ['apply', 'wander'], covering: {interactions: 'runs desktop/renderer/menu.css:40'}, linux});
  assert.deepEqual(plan.suites, ['apply', 'wander', 'interactions']);
  assert.deepEqual(plan.left, [], 'a Mac suite the PR changes runs its steps on the PR (audit rule 3), no longer left to the gate');
  const loads = planPrSuites({covering: {interactions: 'loads desktop/renderer/app.js (line 3 ran in no suite)', wander: 'loads desktop/renderer/app.js (line 3 ran in no suite)'}, linux});
  assert.deepEqual(loads, {suites: ['wander'], left: ['interactions'], deferred: []}, 'a line no suite ran: every suite loading the file, but Mac ones only when they ran it');
});
