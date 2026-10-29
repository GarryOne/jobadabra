// Which harness test files a PR reaches (lib/test-reach.mjs, `node test-sets.mjs reached`): imports followed to the end, the pr set only when the harness changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {reach, reachedTests, specifiers, unstage} from '../lib/test-reach.mjs';
import {testSets} from '../test-sets.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const inRepo = file => `desktop/e2e/test/${file}`;

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-reach-'));
  for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true}); fs.writeFileSync(path.join(root, file), text); }
  return root;
}

// Deliberately lexical and overinclusive: no path-literal matching or dependency extraction from the picker is used here.
function suitesReaders(root) {
  const mentionsSuites = source => /\bsuites\b/i.test(source);
  const listsFiles = source => /\b(?:readdir(?:Sync)?|glob(?:Sync)?|opendir(?:Sync)?|walk|scandir|listFiles)\b/i.test(source);
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  return ['desktop/e2e/test', 'desktop/test'].flatMap(dir => {
    if (!fs.existsSync(path.join(root, dir))) return [];
    return fs.readdirSync(path.join(root, dir)).filter(name => /\.test\.[cm]?js$/.test(name)).map(name => `${dir}/${name}`);
  }).filter(file => {
    const source = read(file);
    if (mentionsSuites(source) && listsFiles(source)) return true;
    // One hop only. Ignore helper prose so a comment about suites does not turn an artifact/cache-directory read into a suite scan.
    return [...source.matchAll(/(?:from\s*|import\(\s*|import\s*)['"](\.[^'"]+)['"]/g)].some(([, spec]) => {
      const helper = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (!helper.includes('/lib/') || !fs.existsSync(path.join(root, helper))) return false;
      // Context's registry is consumed by the named SUITES import, not by every user of its unrelated APIs.
      if (helper === 'desktop/e2e/lib/context.mjs' && !/\bSUITES\b/.test(source)) return false;
      const code = read(helper).split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
      // The lowercase directory word distinguishes a suite scan from a helper that uses the SUITES registry but enumerates blobs/artifacts.
      return /\bsuites\b/.test(code) && /\breaddir(?:Sync)?\b/.test(code);
    });
  }).sort();
}

const SUITE_READER_EXCEPTIONS = {
  'desktop/e2e/test/ai-meter.test.mjs': 'Enumerates temporary answer-cache directories; suites occur only in prose.',
  'desktop/e2e/test/ensure-staged.test.mjs': 'Enumerates e2e entrypoints and lib modules that import suites, not the suites directory.',
  'desktop/e2e/test/owns-step.test.mjs': 'Enumerates apply-* lib helpers and reads the two named apply suites, not every suite.',
  'desktop/e2e/test/pr-store.test.mjs': 'walk is a synthetic coverage-step key; reads named watched suites without enumerating suites.',
  'desktop/e2e/test/store-call.test.mjs': 'Enumerates SQLite files in its temporary profile data directory.',
  'desktop/test/flows-matrix.test.js': 'Enumerates apply-* lib helpers and reads the one named apply suite, not every suite.',
};

test('a module\'s relative specifiers: static, side-effect, dynamic, files read via new URL, and a declared "// Reaches:" line; never a package', () => {
  const text = `import {a} from './a.mjs';\nimport './b.mjs';\nconst c = await import('../c.js');\nconst d = new URL('../../renderer/', import.meta.url);\n// Reaches: ./child.mjs ../app/\nimport {chromium} from 'playwright';`;
  assert.deepEqual(specifiers(text).sort(), ['../../renderer/', '../app/', '../c.js', './a.mjs', './b.mjs', './child.mjs']);
});

test('reach follows imports to the end, a folder read covers every file under it, a Playwright import asks for a browser, the repo root is never a reach', () => {
  const root = tree({
    'e2e/test/x.test.mjs': `import {h} from '../lib/h.mjs';\nconst all = new URL('../../../', import.meta.url);`,
    'e2e/lib/h.mjs': `import {g} from './g.mjs';\nconst css = new URL('../../renderer/', import.meta.url);`,
    'e2e/lib/g.mjs': `import {chromium} from 'playwright';`,
  });
  const {paths, browser} = reach(root, 'e2e/test/x.test.mjs');
  assert.deepEqual([...paths].sort(), ['e2e/lib/g.mjs', 'e2e/lib/h.mjs', 'e2e/test/x.test.mjs', 'renderer/']);
  assert.equal(browser, true);
  const picked = reachedTests({root, tests: ['e2e/test/x.test.mjs'], changed: ['renderer/ui-menu.css']});
  // Why (#2435/#2450, 29 Oct 2026): even a single reached test must bring the workflow coverage guard along.
  assert.deepEqual(picked.files, [inRepo('test-reach.test.mjs'), 'e2e/test/x.test.mjs']);
  assert.equal(picked.why['e2e/test/x.test.mjs'], 'renderer/ui-menu.css');
  assert.deepEqual(reachedTests({root, tests: ['e2e/test/x.test.mjs'], changed: ['docs/x.md']}).files, [], 'the root read reaches nothing by itself');
});

test('the pr set runs when the harness changed, not for a recorded case alone', () => {
  const {pr, daily} = testSets(), tests = [...pr, ...daily].map(inRepo), always = pr.map(inRepo);
  const harness = reachedTests({root: ROOT, tests, changed: ['desktop/e2e/lib/test-reach.mjs'], always});
  for (const file of always) assert.ok(harness.files.includes(file), file);
  assert.ok(harness.files.includes(inRepo('test-reach.test.mjs')), 'a change to the reach code runs this test, though it is in the daily set');
  assert.deepEqual(reachedTests({root: ROOT, tests, changed: ['desktop/e2e/recorded/x/case.json'], always}).files, []);
});

test('a suite edit reaches the AI declaration guard without selecting an unrelated test', () => {
  const {pr, daily} = testSets(), tests = [...pr, ...daily].map(inRepo);
  const picked = reachedTests({root: ROOT, tests, changed: ['desktop/e2e/suites/stores.mjs']}).files;
  assert.ok(picked.includes(inRepo('suite-ai-mode.test.mjs')), 'the guard that would have stopped #2476 must run on the PR');
  assert.ok(!picked.includes(inRepo('ai-meter.test.mjs')), 'an ordinary test with only temp-directory reads stays out');
});

test('a suite edit excludes context users that do not consume SUITES, while registry consumers still run', t => {
  const {pr, daily} = testSets(), tests = [...pr, ...daily].map(inRepo);
  const picked = reachedTests({root: ROOT, tests, changed: ['desktop/e2e/suites/stores.mjs']}).files;
  t.diagnostic(`stores.mjs directly reaches ${picked.length} tests`);
  for (const name of ['key-check', 'clock-out', 'issue-links', 'plan-run', 'run-all']) {
    assert.ok(tests.includes(inRepo(`${name}.test.mjs`)), `the real negative control exists: ${name}`);
    assert.ok(!picked.includes(inRepo(`${name}.test.mjs`)), `${name} does not scan suites or consume SUITES`);
  }
  for (const name of ['store', 'suite-budget', 'suite-shards']) assert.ok(picked.includes(inRepo(`${name}.test.mjs`)), `${name} consumes SUITES`);
});

test('context only supplies a directory edge to SUITES consumers, including under broad discovery', t => {
  const plain = inRepo('plain.test.mjs'), registry = inRepo('registry.test.mjs'), indirect = inRepo('indirect.test.mjs'), transitive = inRepo('transitive.test.mjs');
  const root = tree({
    [plain]: "import {openContext} from '../lib/context.mjs';",
    [registry]: "import {SUITES as names} from '../lib/context.mjs';",
    [indirect]: "import {open} from '../lib/open.mjs';",
    [transitive]: "import {other} from '../lib/middle.mjs';",
    'desktop/e2e/lib/open.mjs': "import {openContext} from './context.mjs';",
    'desktop/e2e/lib/context.mjs': "export const SUITES = fs.readdirSync(path.join(root, 'suites')); export const openContext = () => {};",
    'desktop/e2e/lib/middle.mjs': "import {scan} from './scanner.mjs'; export const other = () => 1;",
    'desktop/e2e/lib/scanner.mjs': 'export const scan = () => fs.readdirSync(`${root}/suites`);',
  });
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const picked = reachedTests({root, tests: [plain, registry, indirect, transitive], changed: ['desktop/e2e/suites/stores.mjs']}).files;
  assert.deepEqual(picked, [registry, inRepo('test-reach.test.mjs')]);
  assert.deepEqual(suitesReaders(root), [registry], 'importing another context API does not consume its directory listing');
});

// Inspect both test directories on disk, including unregistered tests, using a broader oracle than scannedDirectories.
test('every registered suite reaches every suites-directory reader', t => {
  const readers = suitesReaders(ROOT);
  assert.ok(readers.includes(inRepo('suite-ai-mode.test.mjs')));
  assert.ok(readers.includes(inRepo('suite-shards.test.mjs')), 'registry readers are part of the class');
  for (const [file, reason] of Object.entries(SUITE_READER_EXCEPTIONS)) {
    assert.ok(readers.includes(file), `remove stale exception: ${file}`);
    assert.ok(reason.length > 20, `explain why ${file} does not scan suites`);
  }
  // context.mjs builds SUITES from these .mjs entries; do not import it and start loading the app just to read the registry.
  const suites = fs.readdirSync(path.join(ROOT, 'desktop/e2e/suites')).filter(name => name.endsWith('.mjs'));
  assert.ok(suites.includes('stores.mjs'));
  const missing = [];
  for (const suite of suites) {
    const picked = reachedTests({root: ROOT, tests: readers, changed: [`desktop/e2e/suites/${suite}`]}).files;
    if (suite === 'stores.mjs') {
      const extra = readers.filter(file => !picked.includes(file));
      t.diagnostic(`broader discovery: ${readers.length} candidates, ${extra.length} beyond the picker (${Object.keys(SUITE_READER_EXCEPTIONS).length} documented exceptions): ${extra.join(', ')}`);
    }
    for (const reader of readers) if (!picked.includes(reader) && !SUITE_READER_EXCEPTIONS[reader]) missing.push(`${suite} -> ${reader}`);
  }
  assert.deepEqual(missing, []);
});

test('independent discovery catches template paths, helper constants and one-hop scans in both test directories', t => {
  const root = tree({
    'desktop/e2e/test/template.test.mjs': 'fs.readdirSync(`${root}/suites`);',
    'desktop/test/helper.test.js': "import {scan} from '../e2e/lib/scanner.mjs'; scan();",
    'desktop/e2e/lib/scanner.mjs': 'export const scan = () => fs.readdirSync(`${root}/suites`);',
    'desktop/e2e/test/constant.test.mjs': "import {SUITES} from '../lib/directory.mjs'; fs.readdirSync(SUITES);",
    'desktop/e2e/lib/directory.mjs': "export const SUITES = 'suites';",
    'desktop/e2e/test/ordinary.test.mjs': 'fs.readdirSync(temp);',
  });
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const readers = suitesReaders(root);
  assert.deepEqual(readers, ['desktop/e2e/test/constant.test.mjs', 'desktop/e2e/test/template.test.mjs', 'desktop/test/helper.test.js']);
  const picked = reachedTests({root, tests: readers, changed: ['desktop/e2e/suites/planted.mjs']}).files;
  assert.deepEqual(readers.filter(reader => !picked.includes(reader)), [], 'every planted scanner, including the template path, must be reached');
});

test('directory scans reach suites and lib through joins, loops, globs and the SUITES registry, without a filename list', t => {
  const sources = {
    join: `const dir = path.join(import.meta.dirname, '..', 'suites'); fs.readdirSync(dir);`,
    loop: `for (const dir of ['suites', 'lib']) fs.readdirSync(path.join(root, dir));`,
    glob: `globSync('../suites/*.mjs');`,
    registry: `import {SUITES as names} from '../lib/context.mjs';`,
    lib: `fs.readdirSync(path.join(root, 'lib'));`,
    dirname: `const dir = path.dirname(fileURLToPath(new URL('../lib/plant.mjs', import.meta.url))); fs.readdirSync(dir);`,
    ordinary: `import {x} from '../lib/helper.mjs'; fs.readdirSync(temp);`,
    mention: `const label = 'suites'; import {x} from '../lib/helper.mjs';`,
  };
  const tests = Object.keys(sources).map(name => inRepo(`${name}.test.mjs`));
  const root = tree(Object.fromEntries(Object.entries(sources).map(([name, source]) => [inRepo(`${name}.test.mjs`), source])));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const picked = file => reachedTests({root, tests, changed: [`desktop/e2e/${file}`]}).files;
  assert.deepEqual(picked('suites/new-suite.mjs'), ['glob', 'join', 'loop', 'registry', 'test-reach'].map(name => inRepo(`${name}.test.mjs`)));
  assert.deepEqual(picked('lib/new-helper.mjs'), ['dirname', 'lib', 'loop', 'test-reach'].map(name => inRepo(`${name}.test.mjs`)));
  assert.deepEqual(picked('recorded/new/case.json'), [], 'scanning code directories never reaches replay data');
});

// Why (#2458, 29 Oct 2026): excluded replay data needs a read inside its DATA tree; a desktop/ ancestor read must still cover harness code.
test('a parent directory read selects lib changes but replay data needs its own file or directory read', t => {
  const parent = inRepo('parent.test.mjs'), folder = inRepo('folder.test.mjs'), file = inRepo('file.test.mjs');
  const reading = relative => `const input = new URL('${relative}', import.meta.url);`;
  const root = tree({[parent]: reading('../..'), [folder]: reading('../recorded/x/'), [file]: reading('../recorded/x/case.json')});
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const changed = ['desktop/e2e/recorded/x/case.json'];
  assert.deepEqual(reachedTests({root, tests: [parent], changed}).files, []);
  assert.deepEqual(reachedTests({root, tests: [parent], changed: ['desktop/e2e/lib/helper.mjs']}).files,
    [parent, inRepo('test-reach.test.mjs')]);
  assert.deepEqual(reachedTests({root, tests: [parent, folder, file], changed}).files,
    [file, folder, inRepo('test-reach.test.mjs')]);
});

// Why (#2435/#2450, 29 Oct 2026): a parent-only URL is a directory even without a trailing slash; desktop/** must cover it.
test('parent-only URL specifiers reach a directory with its trailing slash', t => {
  const root = tree({'desktop/e2e/test/x.test.mjs': ''});
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const spec of ['../..', '../../', './../..']) {
    fs.writeFileSync(path.join(root, 'desktop/e2e/test/x.test.mjs'), `const dir = new URL('${spec}', import.meta.url);`);
    const {paths} = reach(root, 'desktop/e2e/test/x.test.mjs');
    assert.deepEqual([...paths].sort(), ['desktop/', 'desktop/e2e/test/x.test.mjs'], spec);
    assert.ok([...paths].every(file => file.startsWith('desktop/')), 'desktop/** covers every reached path');
  }
});

// Why (#2435/#2450, 29 Oct 2026): changing another test's inputs must run the guard that checks every test's workflow coverage.
test('the PRs that escaped the workflow coverage guard now select it; docs alone select nothing', () => {
  const {pr, daily} = testSets(), tests = [...pr, ...daily].map(inRepo);
  const picked = ['desktop/e2e/test/pr-suites-cap.test.mjs', 'desktop/e2e/lib/ai-answers.mjs']
    .map(file => reachedTests({root: ROOT, tests, changed: [file]}).files.includes(inRepo('test-reach.test.mjs')));
  assert.deepEqual(picked, [true, true], '#2435 and #2450 must both run the workflow coverage guard');
  assert.deepEqual(reachedTests({root: ROOT, tests, changed: ['docs/x.md']}).files, []);
});

test('the two changes that left harness-daily red reach the tests they broke (owner, 27 Oct 2026: "Yes, reached files")', () => {
  const {pr, daily} = testSets(), tests = [...pr, ...daily].map(inRepo);
  // 8c8bd70 (21 Oct): target_roles became the one list; offline-app.test.mjs starts the app's server as a child process (lib/offline-app.mjs "Reaches:").
  assert.ok(reachedTests({root: ROOT, tests, changed: ['desktop/lib/target-roles.js']}).files.includes(inRepo('offline-app.test.mjs')));
  // 3fc251e (18 Oct): the menu's styles moved to ui-menu.css; interact.test.mjs serves the renderer folder.
  assert.ok(reachedTests({root: ROOT, tests, changed: ['desktop/renderer/ui-menu.css']}).files.includes(inRepo('interact.test.mjs')));
  // Any extension file: the tests that load the whole extension (lib/extension.mjs "Reaches:").
  assert.ok(reachedTests({root: ROOT, tests, changed: ['extension/fill-flow.js']}).files.includes(inRepo('fill-overlay.test.mjs')));
});

test('harness.yml starts for every file a harness test reaches (its `paths:` cover them all)', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/harness.yml'), 'utf8');
  const globs = [...workflow.split('\npermissions:')[0].matchAll(/^\s+- '([^']+)'/gm)].map(found => found[1]);
  const matches = (glob, file) => glob.endsWith('/**') ? file.startsWith(glob.slice(0, -2)) : glob === file;
  // As GitHub reads them: in order, the last pattern that matches decides (a '!' leaves the file out, a later plain one takes it back).
  const started = file => globs.reduce((on, glob) => glob.startsWith('!') ? (matches(glob.slice(1), file) ? false : on) : (matches(glob, file) ? true : on), false);
  const {pr, daily} = testSets(), cache = new Map(), missing = new Set();
  for (const file of [...pr, ...daily]) {
    for (const item of reach(ROOT, inRepo(file), cache).paths) {
      const probe = item.endsWith('/') ? `${item}any-file` : item;
      if (!started(probe) && fs.existsSync(path.join(ROOT, item))) missing.add(item);
    }
  }
  assert.deepEqual([...missing].sort(), [], 'add these to harness.yml\'s on: pull_request: paths: (a change there reaches a harness test)');
});

test('a reach into staged desktop/shared/ is a reach into the file stage.mjs copies it from, and the job\'s own inputs run the pr set (review on #2241)', () => {
  assert.equal(unstage('desktop/shared/worker/ai.js'), 'worker/src/ai.js');
  assert.equal(unstage('desktop/shared/ladder-core.js'), 'extension/ladder/core.js');
  assert.equal(unstage('desktop/shared/ladder/endings.js'), 'extension/ladder/endings.js');
  assert.equal(unstage('desktop/shared/alias-schema.js'), 'extension/alias-schema.js');
  assert.equal(unstage('desktop/lib/server.js'), 'desktop/lib/server.js');
  const {pr, daily} = testSets(), tests = [...pr, ...daily].map(inRepo), always = pr.map(inRepo);
  assert.ok(reachedTests({root: ROOT, tests, changed: ['worker/src/ai.js']}).files.length > 0, 'a worker file the app server imports through shared/ reaches its tests');
  for (const input of ['desktop/package.json', 'desktop/package-lock.json', 'desktop/scripts/stage.mjs']) {
    const picked = reachedTests({root: ROOT, tests, changed: [input], always}).files;
    for (const file of always) assert.ok(picked.includes(file), `${input} runs the pr set (${file})`);
  }
});
