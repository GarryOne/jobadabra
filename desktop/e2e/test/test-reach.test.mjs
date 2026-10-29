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
