// Guards tools/clean-code-js.mjs: new JS code over the complexity limit or copying a function is refused; old code and simple code are not.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {check, baseCommit, changedFiles, COMPLEXITY_LIMIT} = await import('../../tools/clean-code-js.mjs');

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

test('a depth-1 checkout of a PR merge ref is measured from its first parent, even after main moved on', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-base-'));
  const run = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  const src = path.join(tmp, 'src'), clone = path.join(tmp, 'clone');
  fs.mkdirSync(src); fs.mkdirSync(clone);
  run(src, 'init', '-q', '-b', 'main'); run(src, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  run(src, 'commit', '-q', '--allow-empty', '-m', 'main one');
  const mainWhenBuilt = run(src, 'rev-parse', 'HEAD');
  run(src, 'checkout', '-q', '-b', 'pr'); fs.writeFileSync(path.join(src, 'a.js'), 'x\n'); run(src, 'add', 'a.js'); run(src, 'commit', '-q', '-m', 'pr work');
  run(src, 'checkout', '-q', 'main'); run(src, 'merge', '-q', '--no-ff', '--no-edit', 'pr');
  run(src, 'update-ref', 'refs/pull/1/merge', 'HEAD'); run(src, 'reset', '-q', '--hard', mainWhenBuilt);
  run(src, 'commit', '-q', '--allow-empty', '-m', 'main two, after the merge ref was built');
  run(clone, 'init', '-q'); run(clone, 'remote', 'add', 'origin', pathToFileURL(src).href);
  run(clone, 'fetch', '-q', '--depth=1', 'origin', 'refs/pull/1/merge'); run(clone, 'checkout', '-q', 'FETCH_HEAD');
  assert.equal(baseCommit(clone), mainWhenBuilt);
});

test('what is checked is the committed HEAD against the base: a dirty tree changes nothing, and a moved-and-edited file counts as new', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-changed-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
  fs.mkdirSync(path.join(dir, 'desktop'));
  fs.writeFileSync(path.join(dir, 'desktop', 'old.js'), 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  git('mv', 'desktop/old.js', 'desktop/moved.js');
  fs.appendFileSync(path.join(dir, 'desktop', 'moved.js'), 'export const d = 4;\n');
  fs.writeFileSync(path.join(dir, 'desktop', 'new.js'), 'export const e = 5;\n');
  git('add', '.'); git('commit', '-q', '-m', 'moves, edits and adds');
  fs.writeFileSync(path.join(dir, 'desktop', 'new.js'), 'export const local = 0;\n');   // an uncommitted edit
  fs.writeFileSync(path.join(dir, 'desktop', 'wip.js'), 'export const wip = 1;\n');      // untracked work
  const files = changedFiles(base, dir);
  assert.deepEqual(files.map(f => f.path).sort(), ['desktop/moved.js', 'desktop/new.js']);
  const moved = files.find(f => f.path === 'desktop/moved.js');
  assert.ok(moved.added.has(4));
  assert.equal(files.find(f => f.path === 'desktop/new.js').source, 'export const e = 5;\n');
});

// Why (29 Oct 2026, fl on PR #2441): the first advertised exception, an eslint disable comment naming a sonarjs rule, failed the main lint pass, which does not register sonarjs.
test('the exception marker clears a finding on its line or the line above, and needs a reason; the main lint pass accepts the comment', async () => {
  const marked = `// clean-code-ok: Why (29 Oct 2026, #2441): old function, only its signature line was edited\n${nested('tangled', 8)}`;
  assert.deepEqual(await check([{path: 'desktop/lib/x.js', source: marked, added: allLines(marked)}]), []);
  for (const weak of ['', ' Why x', ' Why (#1):', ' Why (#1): ']) {   // no reason, no (PR) part, no reason after the colon
    const bare = marked.replace(/ Why .*/, weak);
    assert.equal((await check([{path: 'desktop/lib/x.js', source: bare, added: allLines(bare)}])).length, 1, `a marker "${weak}" does not count`);
  }
  const inString = `const s = 'clean-code-ok: Why (#1): reason';\n${nested('tangled', 8)}`;
  assert.equal((await check([{path: 'desktop/lib/x.js', source: inString, added: allLines(inString)}])).length, 1, 'the words in a string are not a marker');
  const {ESLint} = createRequire(import.meta.url)('eslint');
  const main = new ESLint({overrideConfigFile: path.resolve(import.meta.dirname, '../../eslint.config.mjs')});
  const [result] = await main.lintText(marked, {filePath: path.resolve(import.meta.dirname, '../../desktop/lib/x.js')});
  assert.deepEqual(result.messages.map(m => m.message), []);
});
