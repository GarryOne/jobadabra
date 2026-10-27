// Which harness test files a PR reaches (lib/test-reach.mjs, `node test-sets.mjs reached`): imports followed to the end, the pr set only when the harness changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {reach, reachedTests, specifiers} from '../lib/test-reach.mjs';
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
  assert.deepEqual(picked.files, ['e2e/test/x.test.mjs']);
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
