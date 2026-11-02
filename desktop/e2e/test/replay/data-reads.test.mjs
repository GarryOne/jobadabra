// A data file the app reads at run time (docs, config, JSON named by a path) counts as the line that reads it: for the after-merge picker and for the flaky verdict.
// The proof case is betas 16 and 17 (2 Nov 2026): #2926 edited docs/notion-profile-template.md, which desktop/lib/strategy.js:92 reads into the wizard's AI ask; the wizard's
// "strategy is built from the CV" step hung twice on the same ask key, no step ran after the merge, and the red looked "flaky" because only code was compared.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SETUP} from '../../lib/coverage.mjs';
import {stepNamesFor, stepsCovering} from '../../lib/coverage-pick.mjs';
import {dataReadBy, isDataFile, pathsOn, readHunks} from '../../lib/data-reads.mjs';
import {judge, stepFiles, touched} from '../../lib/flaky-verdict.mjs';

const STEP = 'the strategy is built from the CV and shows roles to search for';
const TEMPLATE = 'docs/notion-profile-template.md';
const STRATEGY = [
  "const REPO = path.resolve(__dirname, '..', '..');",
  '// the template: docs/notion-profile-template.md, read below',
  "  const text = fs.readFileSync(path.join(REPO, 'docs', 'notion-profile-template.md'), 'utf8');",
  "  const example = fs.readFileSync(path.join(REPO, 'config', 'search.example.json'), 'utf8');",
  "  say('Fill the template: docs/notion-profile-template.md in Notion');",
].join('\n');

// The base of a join (REPO, __dirname) is a variable, so both readings are kept: a reading that names no real file never matches a changed one.
test('a line names a data file by one literal or by several joined, from the repo root or from its own folder', () => {
  assert.ok(pathsOn("fs.readFileSync(path.join(REPO, 'docs', 'notion-profile-template.md'), 'utf8')", 'desktop/lib/strategy.js').includes(TEMPLATE));
  assert.ok(pathsOn("TEMPLATE = Path(__file__).resolve().parents[2] / 'docs' / 'notion-profile-template.md'", 'src/ai/score.py').includes(TEMPLATE));
  assert.deepEqual(pathsOn("JSON.parse(fs.readFileSync(new URL('../../demo/draft.json', import.meta.url), 'utf8'))", 'desktop/e2e/lib/wizard.mjs'), ['desktop/demo/draft.json'],
    'a ./ or ../ path is read from the file\'s own folder only');
  assert.ok(pathsOn("const rows = load(path.join(__dirname, 'fixtures', 'rows.json'));", 'app-core/x.js').includes('app-core/fixtures/rows.json'));
  assert.ok(pathsOn("const rows = load('config/search.example.json');", 'app-core/x.js').includes('config/search.example.json'));
});

test('a comment, a sentence that mentions a path, a template and a code file name no data file', () => {
  assert.deepEqual(pathsOn('// docs/notion-profile-template.md is read below', 'desktop/lib/strategy.js'), []);
  assert.deepEqual(pathsOn("say('Fill the template: docs/notion-profile-template.md in Notion')", 'desktop/lib/strategy.js'), []);
  assert.deepEqual(pathsOn('read(`docs/${name}.md`)', 'desktop/lib/strategy.js'), []);
  assert.deepEqual(pathsOn("require(path.join(__dirname, 'store.js'))", 'desktop/lib/strategy.js'), [], 'code is followed by its imports, not here');
  assert.equal(isDataFile(TEMPLATE), true);
  assert.equal(isDataFile('desktop/lib/strategy.js'), false);
});

test('the lines that read a changed data file, from git grep over a commit, become changed lines of the reader', () => {
  const grep = [
    `9ce7bc8:desktop/lib/strategy.js:92:  const text = fs.readFileSync(path.join(REPO, 'docs', 'notion-profile-template.md'), 'utf8');`,
    `9ce7bc8:src/ai/score.py:168:# The Profile template's own words (docs/notion-profile-template.md): a page made of only these`,
    `9ce7bc8:src/ai/score.py:169:TEMPLATE = Path(__file__).resolve().parents[2] / 'docs' / 'notion-profile-template.md'`,
    `9ce7bc8:src/doctor.py:124:   'Fill "Profile" in Notion (template: docs/notion-profile-template.md)' if stores.name == 'notion'`,
    `9ce7bc8:docs/README.md:3:see docs/notion-profile-template.md`,
  ].join('\n');
  assert.deepEqual(readHunks(grep, TEMPLATE), {'desktop/lib/strategy.js': [[92, 92]], 'src/ai/score.py': [[169, 169]]});
});

test('the picker: a change to the template picks the one step that ran the line reading it (wizard, betas 16 and 17)', () => {
  const lines = ranges => ({lines: ranges});
  const map = {suites: {
    wizard: {sha: '9ce7bc8', files: {'desktop/lib/strategy.js': lines([[1, 300]])},
      steps: {[STEP]: {'desktop/lib/strategy.js': lines([[80, 120], [220, 230]])}, 'the wizard opens': {'desktop/lib/strategy.js': lines([[1, 20]])}, [SETUP]: {}}},
    settings: {sha: '9ce7bc8', files: {'desktop/lib/strategy.js': lines([[1, 20]])}, steps: {'Export the profile': {'desktop/lib/strategy.js': lines([[1, 20]])}, [SETUP]: {}}},
  }};
  const grep = `9ce7bc8:desktop/lib/strategy.js:92:  const text = fs.readFileSync(path.join(REPO, 'docs', 'notion-profile-template.md'), 'utf8');`;
  assert.deepEqual(stepNamesFor(stepsCovering(map, {'9ce7bc8': readHunks(grep, TEMPLATE)})), {wizard: [STEP]});
});

test('the flaky verdict: a red after a template change is "changed", never "flaky" (the wizard\'s red on the same ask key twice)', () => {
  const tree = {'desktop/e2e/suites/wizard.mjs': "import {seed} from '../lib/wizard.mjs';\n", 'desktop/e2e/lib/wizard.mjs': "const D = JSON.parse(fs.readFileSync(new URL('../../demo/draft.json', import.meta.url), 'utf8'));\n",
    'desktop/e2e/suite.mjs': '', 'desktop/e2e/lib/suite-main.mjs': '', 'desktop/lib/strategy.js': STRATEGY};
  const read = file => tree[file] ?? null;
  const map = {suites: {wizard: {steps: {[STEP]: {'desktop/lib/strategy.js': {lines: [[80, 120]]}}}}}};
  const set = stepFiles({suite: 'wizard', step: STEP, map, read});
  assert.ok(set.files.includes(TEMPLATE), 'the app file the step ran reads the template');
  assert.ok(set.files.includes('config/search.example.json'));
  assert.ok(set.files.includes('desktop/demo/draft.json'), 'the harness file reads the canned draft');
  const changed = touched(['docs/notion-profile-template.md', 'docs/README.md'], set);
  assert.deepEqual(changed, [TEMPLATE]);
  assert.equal(judge([{green: {sha: 'b15'}, files: changed}]).verdict, 'changed');
});

test('dataReadBy lists every data file a source names, once', () => {
  const read = dataReadBy(STRATEGY, 'desktop/lib/strategy.js');
  assert.ok(read.includes(TEMPLATE) && read.includes('config/search.example.json'));
  assert.equal(new Set(read).size, read.length);
});
