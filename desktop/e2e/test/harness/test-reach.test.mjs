// What a harness test reaches (lib/test-reach.mjs), and that harness.yml's `on: paths:` start the run for every one of those paths.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {reach, specifiers, unstage} from '../../lib/test-reach.mjs';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
// Why (owner, 30 Oct 2026, option C; 1 Nov 2026, integration tests in desktop/integration/<layer>/): `npm test` runs every file of test/ and of ../integration/extension/ on each harness PR (harness.yml); no list picks files, so both folders are read here.
// Why (c27, 1 Nov 2026, area folders): the e2e tests sit in test/<area>/ (one level), the extension ones directly in their folder; `fixtures` holds stand-ins, never tests.
const listTests = (folder, repoDir) => {
  const base = new URL(folder, import.meta.url);
  const names = fs.readdirSync(base, {withFileTypes: true}).flatMap(item => (item.isDirectory() && item.name !== 'fixtures' ? fs.readdirSync(new URL(`${item.name}/`, base)).map(name => `${item.name}/${name}`) : item.isFile() ? [item.name] : []));
  return names.filter(name => /\.test\.mjs$/.test(name)).sort().map(name => `${repoDir}/${name}`);
};
const allTests = () => [...listTests('../', 'desktop/e2e/test'), ...listTests('../../../integration/extension/', 'desktop/integration/extension')];

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-reach-'));
  for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true}); fs.writeFileSync(path.join(root, file), text); }
  return root;
}

test('a module\'s relative specifiers: static, side-effect, dynamic, files read via new URL, and a declared "// Reaches:" line; never a package', () => {
  const text = `import {a} from './a.mjs';\nimport './b.mjs';\nconst c = await import('../c.js');\nconst d = new URL('../../renderer/', import.meta.url);\n// Reaches: ./child.mjs ../app/\nimport {chromium} from 'playwright';`;
  assert.deepEqual(specifiers(text).sort(), ['../../renderer/', '../app/', '../c.js', './a.mjs', './b.mjs', './child.mjs']);
});

test('reach follows imports to the end, a folder read covers every file under it, a package is never a path, the repo root is never a reach', t => {
  const root = tree({
    'e2e/test/x.test.mjs': `import {h} from '../lib/h.mjs';\nconst all = new URL('../../../', import.meta.url);`,
    'e2e/lib/h.mjs': `import {g} from './g.mjs';\nconst css = new URL('../../renderer/', import.meta.url);`,
    'e2e/lib/g.mjs': `import {chromium} from 'playwright';`,
  });
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const {paths} = reach(root, 'e2e/test/x.test.mjs');
  assert.deepEqual([...paths].sort(), ['e2e/lib/g.mjs', 'e2e/lib/h.mjs', 'e2e/test/x.test.mjs', 'renderer/']);
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

test('harness.yml starts for every file a harness test reaches (its `paths:` cover them all)', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/harness.yml'), 'utf8');
  const globs = [...workflow.split('\npermissions:')[0].matchAll(/^\s+- '([^']+)'/gm)].map(found => found[1]);
  const matches = (glob, file) => glob.endsWith('/**') ? file.startsWith(glob.slice(0, -2)) : glob === file;
  // As GitHub reads them: in order, the last pattern that matches decides (a '!' leaves the file out, a later plain one takes it back).
  const started = file => globs.reduce((on, glob) => glob.startsWith('!') ? (matches(glob.slice(1), file) ? false : on) : (matches(glob, file) ? true : on), false);
  const cache = new Map(), missing = new Set();
  for (const file of allTests()) {
    for (const item of reach(ROOT, file, cache).paths) {
      const probe = item.endsWith('/') ? `${item}any-file` : item;
      if (!started(probe) && fs.existsSync(path.join(ROOT, item))) missing.add(item);
    }
  }
  assert.deepEqual([...missing].sort(), [], 'add these to harness.yml\'s on: pull_request: paths: (a change there reaches a harness test)');
});

test('a reach into staged desktop/shared/ is a reach into the file stage.mjs copies it from (review on #2241)', () => {
  assert.equal(unstage('desktop/shared/worker/ai.js'), 'worker/src/ai.js');
  assert.equal(unstage('desktop/shared/ladder-core.js'), 'extension/ladder/core.js');
  assert.equal(unstage('desktop/shared/ladder/endings.js'), 'extension/ladder/endings.js');
  assert.equal(unstage('desktop/shared/alias-schema.js'), 'extension/alias-schema.js');
  assert.equal(unstage('desktop/lib/server.js'), 'desktop/lib/server.js');
  const cache = new Map();
  assert.ok(allTests().some(file => [...reach(ROOT, file, cache).paths].some(item => item.startsWith('worker/src/'))), 'a worker file the app server imports through shared/ is reached');
});
