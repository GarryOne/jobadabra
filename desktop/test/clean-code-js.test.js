// Guards tools/clean-code-js.mjs: new JS code over the complexity limit or copying a function is refused; old code and simple code are not.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {check, baseCommit, COMPLEXITY_LIMIT} = await import('../../tools/clean-code-js.mjs');

// A function with `n` nested ifs, each holding a statement (so they cannot be merged): cognitive complexity grows with each nesting level.
const nested = (name, n) => `export function ${name}(x) {\n${Array.from({length: n}, (_, i) => `${'  '.repeat(i + 1)}if (x > ${i}) {\n${'  '.repeat(i + 2)}x += 1;`).join('\n')}\n${'  '.repeat(n + 1)}return x;\n${Array.from({length: n}, (_, i) => `${'  '.repeat(n - i)}}`).join('\n')}\n  return 0;\n}\n`;
const allLines = source => new Set(source.split('\n').map((_, i) => i + 1));

test('a new function over the complexity limit is refused, with its line and the limit', async () => {
  const source = nested('tangled', 8);
  const found = await check([{path: 'desktop/lib/x.js', source, added: allLines(source)}]);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].line, 1);
  assert.match(found[0].message, new RegExp(`${COMPLEXITY_LIMIT}`));
});

test('the same function in old code, where no added line touches its head, is not refused', async () => {
  const source = nested('tangled', 8);
  const found = await check([{path: 'desktop/lib/x.js', source, added: new Set([5])}]);
  assert.deepEqual(found, []);
});

test('a small new function passes', async () => {
  const source = nested('plain', 2);
  assert.deepEqual(await check([{path: 'desktop/lib/x.js', source, added: allLines(source)}]), []);
});

test('a new function identical to another in the file is refused', async () => {
  const body = n => `export const ${n} = list => {\n  const out = [];\n  for (const item of list) {\n    if (item.ok) out.push(item.id);\n  }\n  return out;\n};\n`;
  const source = body('idsA') + body('idsB');
  const found = await check([{path: 'desktop/lib/x.js', source, added: allLines(source)}]);
  assert.ok(found.some(f => f.rule === 'sonarjs/no-identical-functions'), JSON.stringify(found));
});

test('the sonarjs plugin is a desktop dev dependency that the lock file pins', () => {
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json');
  assert.ok(pkg.devDependencies['eslint-plugin-sonarjs']);
  assert.ok(require('../package-lock.json').packages['node_modules/eslint-plugin-sonarjs']);
});

test('npm run lint runs the check', () => {
  const require = createRequire(import.meta.url);
  assert.match(require('../package.json').scripts.lint, /tools\/clean-code-js\.mjs/);
});

test('a checkout with no origin/main (the desktop CI job) gets no base, not a crash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-base-'));
  const git = (...args) => execFileSync('git', args, {cwd: dir, stdio: 'ignore'});
  git('init', '-q'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'one');
  assert.equal(baseCommit(dir), null);
});

test('a checkout whose origin/main shares no history with HEAD measures from main\'s tip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-base-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {cwd: dir, stdio: 'ignore'});
  git('init', '-q'); git('commit', '-q', '--allow-empty', '-m', 'main');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '--orphan', 'pr'); git('commit', '-q', '--allow-empty', '-m', 'unrelated');
  assert.equal(baseCommit(dir), 'origin/main');
});
