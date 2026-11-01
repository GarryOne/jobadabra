// Guards lib/replay-select.mjs: which recorded cases a change can affect, and that anything it cannot place runs everything (never fewer checks than the owner's rule).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {REPLAY_DIR} from '../../lib/page-replay.mjs';
import {extensionFiles, readMap, selectCases} from '../../lib/replay-select.mjs';
import path from 'node:path';

const files = ['background.js', 'flow.js', 'apply-press.js', 'consent.js', 'ladder/press-why.js'];
const map = {extensionFiles: files, cases: {
  'a-1': ['background.js', 'flow.js', 'apply-press.js', 'ladder/press-why.js'],
  'b-1': ['background.js', 'flow.js', 'consent.js'],
  'c-1': ['background.js', 'flow.js', 'apply-press.js']}};
const pick = (changed, extra = {}) => selectCases({changed, cases: ['a-1', 'b-1', 'c-1'], map, files, flowCore: ['extension/flow-core.js'], ...extra});

test('a file only some cases run selects those cases', () => {
  assert.deepEqual(pick(['extension/consent.js']), {all: false, names: ['b-1'], why: '1 of 3 cases can be affected'});
  assert.deepEqual(pick(['extension/apply-press.js']).names, ['a-1', 'c-1']);
  assert.deepEqual(pick(['extension/ladder/press-why.js', 'extension/consent.js']).names, ['a-1', 'b-1']);
});

test('a shared file (one every case runs), a flow-core file and a replay-tool file run ALL cases', () => {
  assert.equal(pick(['extension/background.js']).all, true);
  assert.equal(pick(['extension/flow-core.js']).all, true);
  assert.equal(pick(['desktop/e2e/lib/replay-browser.mjs']).all, true);
  assert.equal(pick(['desktop/e2e/test/recorded-pages.test.mjs']).all, true);
});

test('a changed file that no case runs (new, or never executed) runs ALL cases', () => {
  const unseen = pick(['extension/brand-new.js']);
  assert.equal(unseen.all, true, 'a file mapped to no case runs everything');
  assert.match(unseen.why, /unmapped/);
});

test('a missing or stale map runs ALL cases; an unknown case always runs', () => {
  assert.equal(pick(['extension/consent.js'], {map: null}).all, true, 'no map');
  assert.equal(pick(['extension/consent.js'], {files: [...files, 'new-file.js']}).all, true, 'extension/ has a file the map never saw');
  assert.equal(pick(['extension/consent.js'], {files: files.slice(1)}).all, true, 'a file was removed');
  const unknown = selectCases({changed: ['extension/consent.js'], cases: ['a-1', 'b-1', 'c-1', 'new-case-1'], map, files});
  assert.deepEqual(unknown.names, ['b-1', 'new-case-1'], 'a case the map does not know runs with the affected ones');
});

test('a changed case folder runs that case; a change that touches no extension, case or tool file runs none', () => {
  assert.deepEqual(pick(['desktop/e2e/recorded/c-1/page-1.html']).names, ['c-1']);
  assert.deepEqual(pick(['desktop/lib/apply.js', 'docs/x.md']), {all: false, names: [], why: 'no extension, case or replay-tool file changed'});
});

test('the committed map names only files that exist (a case it has not measured yet simply always runs)', () => {
  const committed = readMap(REPLAY_DIR);
  assert.ok(committed, 'e2e/recorded-case-map.json exists (npm run recorded-map)');
  const root = path.resolve(REPLAY_DIR, '../../..');
  const now = extensionFiles(root);
  // A case the map does not know always runs (replay-select), and CI replays every case: a case added after the last `npm run recorded-map` is no failure (12 Oct 2026: 21 cases were missing, and this test would have blocked every PR that adds a case).
  for (const [name, used] of Object.entries(committed.cases)) for (const file of used) assert.ok(committed.extensionFiles.includes(file), `${name}: ${file} is in the map's file list`);
  assert.ok(Array.isArray(now) && now.length > 20, 'the extension files are found');
});
