// Guard for tools/coverage-report.mjs, the nightly coverage report (owner via a8, 1 Nov 2026: "Yes, nightly report"). Small fake inputs, one per source: a source that is missing or empty reads
// "not measured", never 0%; a layer that cannot see a folder reads "n/a"; a journey with and without a test; and the real docs/gtm-journeys.json stays whole.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {buildReport, coveredLines, journeyTable, readE2eMap, readPython, readV8, renderMarkdown, scopeOf, suiteCadence, walkScope} from '../../tools/coverage-report.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true}); fs.writeFileSync(path.join(root, rel), text); };

// A checkout with one file per folder: src/a.py (4 statements), desktop/lib/x.js (4 non-blank lines, a function never run), extension/e.js (2 lines).
function checkout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-report-'));
  write(root, 'src/a.py', 'a = 1\nb = 2\n\nc = 3\nd = 4\n');
  write(root, 'desktop/lib/x.js', 'function used() {\n  return 1;\n}\nfunction unused() {\n  return 2;\n}\n');
  write(root, 'extension/e.js', 'let one = 1;\nlet two = 2;\n');
  write(root, 'desktop/lib/x.test.js', 'a test is not product code\n');
  write(root, 'desktop/e2e/suites/jobs.mjs', "export const cadence = 'night-report';\n");
  write(root, 'desktop/e2e/suites/wizard.mjs', 'export const x = 1;\n');
  // qualityai's shape (Gitar, PR 2830): the suite re-exports a cadence another module holds.
  write(root, 'desktop/e2e/suites/qualityai.mjs', "import {PLANNER} from '../lib/quality-journey.mjs';\nexport const cadence = PLANNER.cadence;\n");
  write(root, 'desktop/e2e/lib/quality-journey.mjs', "export const PLANNER = Object.freeze({\n  cadence: 'night-report', budgetMinutes: 10,\n});\n");
  write(root, 'desktop/integration/app/screen-focus.test.js', '// a test\n');
  write(root, 'desktop/test/has-unit.test.js', '// a unit test\n');
  return root;
}
// V8's shape for x.js: the module (count 1) and `unused` (count 0, lines 4-6).
const v8For = (root, rel, ranges) => ({result: [{scriptId: '1', url: pathToFileURL(path.join(root, rel)).href, functions: [{functionName: '', ranges}]}]});
const X = 'function used() {\n  return 1;\n}\nfunction unused() {\n  return 2;\n}\n';
const X_RANGES = [{startOffset: 0, endOffset: X.length, count: 1}, {startOffset: X.indexOf('function unused'), endOffset: X.length, count: 0}];

test('scope: product code only, no tests, no fixtures, no other language', () => {
  assert.equal(scopeOf('src/a.py').folder, 'src');
  assert.equal(scopeOf('desktop/lib/x.js').folder, 'desktop/lib');
  assert.equal(scopeOf('desktop/main.js').folder, 'desktop (main process)');
  assert.equal(scopeOf('desktop/lib/x.test.js'), null);
  assert.equal(scopeOf('desktop/test/x.js'), null);
  assert.equal(scopeOf('src/a.js'), null);
  assert.equal(scopeOf('extension/node_modules/z.js'), null);
});

test('V8 ranges: a nested count-0 range cuts its lines out', () => {
  assert.deepEqual([...coveredLines(X, [{ranges: X_RANGES}])].sort(), [1, 2, 3]);
});

test('every source measured: per layer and per folder', () => {
  const root = checkout();
  const dir = path.join(root, 'v8'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'coverage-1-1-0.json'), JSON.stringify(v8For(root, 'desktop/lib/x.js', X_RANGES)));
  fs.writeFileSync(path.join(dir, 'coverage-2-1-0.json'), '{"result": [');   // a process killed mid-write: skipped, the rest counts
  const py = path.join(root, 'cov.json');
  fs.writeFileSync(py, JSON.stringify({files: {'src/a.py': {summary: {covered_lines: 3, num_statements: 4}}}}));
  const map = path.join(root, 'map.json');
  fs.writeFileSync(map, JSON.stringify({suites: {wizard: {sha: 'abcdef012', files: {'extension/e.js': {loaded: true, lines: [[1, 1]]}, 'desktop/lib/x.js': {loaded: true, lines: [[4, 6]]}}}}}));
  const tree = walkScope(root);
  const layer = (id, langs, read) => ({id, label: id, langs, ...read});
  const report = buildReport({tree, journeys: [], layers: [
    layer('unit-py', ['py'], readPython(py, root)), layer('unit-js', ['js'], readV8([dir], root)), layer('e2e', ['js', 'py'], readE2eMap(map)),
  ]});
  const cellOf = (folder, id) => report.folders.find(row => row.folder === folder).cells[id];
  assert.equal(cellOf('src', 'unit-py').pct, 75);
  assert.equal(cellOf('desktop/lib', 'unit-js').pct, 50);   // 3 of the file's 6 non-blank lines ran
  assert.equal(cellOf('extension', 'unit-js').pct, 0);   // measured layer, a file no test loaded: 0%, a real zero
  assert.equal(cellOf('src', 'unit-js').state, 'n/a');
  assert.equal(cellOf('extension', 'e2e').pct, 50);
  assert.equal(cellOf('desktop/lib', 'e2e').pct, 50);
  assert.match(report.layers.find(l => l.id === 'e2e').note, /1 suites at abcdef0/);
});

test('a missing or empty source is "not measured", never 0%', () => {
  const root = checkout();
  const empty = path.join(root, 'empty'); fs.mkdirSync(empty);
  const bad = path.join(root, 'bad.json'); fs.writeFileSync(bad, 'not json');
  const reads = [readPython('', root), readPython(bad, root), readV8([], root), readV8([empty], root), readV8([path.join(root, 'nope')], root), readE2eMap(''), readE2eMap(bad)];
  for (const read of reads) { assert.equal(read.measured, false); assert.ok(read.why, 'it says why'); }
  const report = buildReport({tree: walkScope(root), journeys: [], layers: [{id: 'unit-js', label: 'Unit · JS', langs: ['js'], ...readV8([empty], root)}]});
  assert.equal(report.layers[0].total.state, 'not measured');
  assert.equal(report.folders.find(row => row.folder === 'desktop/lib').cells['unit-js'].state, 'not measured');
  const text = renderMarkdown(report);
  assert.match(text, /\| Unit · JS \| not measured \|/);
  assert.doesNotMatch(text, /\| Unit · JS \| 0%/);
});

test('journeys: a layer is named from facts in the checkout; one with nothing is "no test"', () => {
  const root = checkout();
  assert.equal(suiteCadence(root, 'jobs'), 'night-report');
  assert.equal(suiteCadence(root, 'qualityai'), 'night-report', 'a cadence re-exported from another module');
  assert.equal(suiteCadence(root, 'wizard'), '');
  assert.equal(suiteCadence(root, 'nope'), '');
  const registry = {journeys: [{id: 'J1', tier: 1, steps: [{suite: 'wizard', step: 's'}]}, {id: 'J2', tier: 2, steps: [{suite: 'apply', step: 't'}]}], kept: []};
  const journeys = [
    {n: 1, name: 'Set up', priority: 'HIGH', card: {}, suites: ['wizard'], unit: []},
    {n: 2, name: 'Focus', priority: 'MED', card: {}, suites: ['focus'], unit: []},
    {n: 3, name: 'Find', priority: 'HIGH', card: {}, suites: ['jobs'], unit: ['desktop/test/has-unit.test.js', 'desktop/test/gone.test.js']},
    {n: 4, name: 'Language', priority: 'HIGH', card: {}, suites: ['apply'], unit: []},
    {n: 5, name: 'Mail', priority: 'MED', card: {}, suites: ['qualityai'], unit: []},
  ];
  const [one, two, three, four, five] = journeyTable({journeys, registry, root});
  assert.deepEqual(one.layers, ['e2e']);
  assert.deepEqual(two.layers, ['integration']);
  assert.deepEqual(three.layers, ['unit', 'nightly report']);
  assert.deepEqual(three.unit, ['desktop/test/has-unit.test.js']);   // a listed file that does not exist counts for nothing
  assert.equal(four.tested, false, 'a tier 2 suite is not e2e');
  assert.deepEqual(five.nightly, ['qualityai'], 'a journey whose only night suite is qualityai still has its nightly layer');
  const report = buildReport({tree: walkScope(root), layers: [], journeys: [one, two, three, four, five]});
  assert.equal(report.journeys.withTest, 4);
  assert.match(renderMarkdown(report), /\| 4 \| Language \| HIGH \| \*\*no test\*\* \|/);
});

test('docs/gtm-journeys.json: 38 board cards in order, every unit file listed exists', () => {
  const data = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/gtm-journeys.json'), 'utf8'));
  assert.deepEqual(data.journeys.map(j => j.n), Array.from({length: 38}, (_, i) => i + 1));
  for (const j of data.journeys) {
    assert.match(j.card.url, /^https:\/\/trello\.com\/c\/\w{8}$/, `journey ${j.n} card link`);
    assert.ok(['HIGH', 'MED', 'LOW'].includes(j.priority), `journey ${j.n} priority`);
    for (const file of j.unit) assert.ok(fs.existsSync(path.join(REPO, file)), `journey ${j.n} lists ${file}, which is gone`);
  }
});
