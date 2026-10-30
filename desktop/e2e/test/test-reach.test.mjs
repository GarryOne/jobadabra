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

// Deliberately lexical and overinclusive: discovery is independent of the picker's specifiers and declared readers.
function suitesReaders(root) {
  const mentionsSuites = source => /\bsuites\b/i.test(source);
  const listsFiles = source => /\b(?:readdir(?:Sync)?|glob(?:Sync)?|opendir(?:Sync)?|walk|scandir|listFiles)\b/i.test(source);
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const dir = 'desktop/e2e/test';
  return fs.readdirSync(path.join(root, dir)).filter(name => /\.test\.[cm]?js$/.test(name)).map(name => `${dir}/${name}`).filter(file => {
    const source = read(file);
    if (/\bSUITES\b/.test(source) || (listsFiles(source) && (mentionsSuites(source) || /\bE2E\b|['"]\.\.\/?['"]/.test(source)))) return true;
    // Any relative import, static or dynamic, can supply a scanner or consume the registry one hop away.
    return [...source.matchAll(/(?:from\s*|import\(\s*|import\s*)['"](\.[^'"]+)['"]/g)].some(([, spec]) => {
      const helper = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (!fs.existsSync(path.join(root, helper)) || !fs.statSync(path.join(root, helper)).isFile()) return false;
      // Context has unrelated APIs too; importing one alone does not consume the registry.
      if (helper === 'desktop/e2e/lib/context.mjs' && !/\bSUITES\b/.test(source)) return false;
      const code = read(helper).split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
      return /\bSUITES\b/.test(code) || (/\bsuites\b/.test(code) && listsFiles(code));
    });
  }).sort();
}

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

test('independent discovery finds registry consumers through any relative import, only in harness tests', t => {
  const root = tree({
    [inRepo('direct.test.mjs')]: "const {SUITES} = await import('../lib/context.mjs');",
    [inRepo('static.test.mjs')]: "import {facts} from '../plan-run.mjs';",
    [inRepo('dynamic.test.mjs')]: "const {facts} = await import('../plan-run.mjs');",
    [inRepo('root.test.mjs')]: "fs.readdirSync(new URL('../', import.meta.url));",
    [inRepo('scanner.test.mjs')]: "import {scan} from '../lib/scanner.mjs';",
    [inRepo('plain.test.mjs')]: "import {openContext} from '../lib/context.mjs';",
    'desktop/e2e/plan-run.mjs': "const {SUITES} = await import('./lib/context.mjs');",
    'desktop/e2e/lib/context.mjs': "export const SUITES = fs.readdirSync('suites');",
    'desktop/e2e/lib/scanner.mjs': "export const scan = () => fs.readdirSync('suites');",
    'desktop/test/outside.test.js': "const {SUITES} = await import('../e2e/lib/context.mjs');",
  });
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  assert.deepEqual(suitesReaders(root), ['direct', 'dynamic', 'root', 'scanner', 'static'].map(name => inRepo(`${name}.test.mjs`)));
});

test('declared folder readers select exactly their tests, including additions and deletions', t => {
  const entry = inRepo('root-reader.test.mjs'), suite = inRepo('suite-reader.test.mjs'), lib = inRepo('lib-reader.test.mjs'), both = inRepo('both.test.mjs'), ordinary = inRepo('ordinary.test.mjs');
  const tests = [entry, suite, lib, both, ordinary];
  const root = tree(Object.fromEntries(tests.map(file => [file, ''])));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const folderReaders = {'./': [entry], 'suites/': [suite, both], 'lib/': [lib, both]};
  for (const [folder, readers] of Object.entries(folderReaders)) {
    const changed = `desktop/e2e/${folder === './' ? '' : folder}brand-new.mjs`;
    const picked = reachedTests({root, tests, changed: [changed], folderReaders});
    assert.deepEqual(picked.files, [...readers, inRepo('test-reach.test.mjs')].sort());
    for (const file of readers) assert.equal(picked.why[file], changed);
  }
  assert.deepEqual(reachedTests({root, tests, changed: ['desktop/e2e/suites-alike/new.mjs'], folderReaders}).files, []);
  assert.deepEqual(reachedTests({root, tests, changed: ['desktop/e2e/recorded/new/case.json'], folderReaders}).files, []);
  assert.deepEqual(reachedTests({root, tests, changed: ['desktop/e2e/suites/new.mjs']}).files, [], 'no implicit folder readers');
});

test('a brand-new suite reaches the AI declaration, cadence and real gate guards', () => {
  const {pr, daily, folderReaders = {}} = testSets(), tests = [...pr, ...daily].map(inRepo);
  const readers = Object.fromEntries(Object.entries(folderReaders).map(([folder, files]) => [folder, files.map(inRepo)]));
  const picked = reachedTests({root: ROOT, tests, changed: ['desktop/e2e/suites/brand-new.mjs'], folderReaders: readers}).files;
  for (const name of ['suite-ai-mode', 'suite-cadence', 'plan-gate-real', 'net-records-key']) assert.ok(picked.includes(inRepo(`${name}.test.mjs`)), `${name} reads every suite`);
});

test('a stores edit reaches suite readers and excludes unrelated context users', t => {
  const {pr, daily, folderReaders = {}} = testSets(), tests = [...pr, ...daily].map(inRepo);
  const readers = Object.fromEntries(Object.entries(folderReaders).map(([folder, files]) => [folder, files.map(inRepo)]));
  const picked = reachedTests({root: ROOT, tests, changed: ['desktop/e2e/suites/stores.mjs'], folderReaders: readers}).files;
  t.diagnostic(`stores.mjs directly reaches ${picked.length} tests`);
  assert.ok(picked.includes(inRepo('suite-ai-mode.test.mjs')));
  for (const name of ['key-check', 'clock-out', 'issue-links', 'plan-run', 'run-all']) {
    assert.ok(tests.includes(inRepo(`${name}.test.mjs`)), `the real negative control exists: ${name}`);
    assert.ok(!picked.includes(inRepo(`${name}.test.mjs`)), `${name} does not scan suites or consume SUITES`);
  }
});

test('a new harness root file reaches ensure-staged, while replay data alone reaches nothing', () => {
  const {pr, daily, folderReaders} = testSets(), tests = [...pr, ...daily].map(inRepo);
  const readers = Object.fromEntries(Object.entries(folderReaders).map(([folder, files]) => [folder, files.map(inRepo)]));
  const pick = changed => reachedTests({root: ROOT, tests, changed: [changed], folderReaders: readers}).files;
  for (const name of ['ensure-staged', 'net-records-key']) assert.ok(pick('desktop/e2e/brand-new.mjs').includes(inRepo(`${name}.test.mjs`)), `${name} reads the harness root`);
  assert.deepEqual(pick('desktop/e2e/recorded/x/case.json'), []);
});

test('every discovered folder-reader candidate is declared or has an exception with a reason', () => {
  const candidates = suitesReaders(ROOT), {pr, daily, folderReaders = {}, folderReaderExceptions = {}} = testSets();
  const exceptions = Object.fromEntries(Object.entries(folderReaderExceptions).map(([file, reason]) => [inRepo(file), reason]));
  const listed = new Set(Object.values(folderReaders).flat().map(inRepo));
  for (const name of ['suite-ai-mode', 'suite-shards', 'suite-cadence', 'plan-gate-real', 'ensure-staged', 'wide-local']) assert.ok(candidates.includes(inRepo(`${name}.test.mjs`)), `${name} must be discovered`);
  for (const file of candidates) {
    assert.ok(listed.has(file) || exceptions[file], `add ${file} to folderReaders in test-sets.json, or to the exceptions with a reason`);
  }
  for (const [folder, files] of Object.entries(folderReaders)) {
    assert.ok(['./', 'suites/', 'lib/', 'report/'].includes(folder), `unknown reader folder: ${folder}`);
    assert.deepEqual(files, [...new Set(files)].sort(), `${folder} readers must be sorted and unique`);
    for (const file of files) {
      assert.ok(fs.existsSync(path.join(ROOT, inRepo(file))), `missing reader: ${file}`);
      assert.ok([...pr, ...daily].includes(file), `add ${file} to the pr or daily set`);
    }
  }
  for (const [file, reason] of Object.entries(exceptions)) {
    assert.ok(candidates.includes(file), `remove stale exception: ${file}`);
    assert.ok(typeof reason === 'string' && reason.length > 20, `explain why ${file} does not read a whole folder`);
    assert.ok(!listed.has(file), `remove listed reader from exceptions: ${file}`);
  }
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
