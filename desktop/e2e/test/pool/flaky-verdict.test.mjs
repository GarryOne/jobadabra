// A red step is "flaky" when a green of the same step ran on code that differs from the red's only outside the step's files (rows 33, a8, 31 Oct 2026).
// The proof case is the owner's: apply's "reads a job's form" step, red on fb1d711 (run 41200878403), green on #2689's head 79e6c34 (run 41199890591), and not
// "unchanged" against 4a79a6b because lib/background-proof.mjs, which the step imports, moved between them.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {importsOf, importClosure, stepFiles, touched, judge, sayLine, HARNESS_ROOTS} from '../../lib/flaky-verdict.mjs';

const STEP = '"See which jobs can apply automatically" reads a job\'s form in the hidden browser: You review and submit, the tab closes, and nothing is filled or sent';
const tree = {
  'desktop/e2e/suites/apply.mjs': "import {ctx} from '../../lib/context.mjs';\nimport {proof} from '../../lib/background-proof.mjs';\nconst later = await import('../../lib/later.mjs');\n",
  'desktop/e2e/lib/context.mjs': "export * from '../runner.mjs';\nimport './side-effect.mjs';\nimport fs from 'node:fs';\nimport x from 'left-pad';\n",
  'desktop/e2e/lib/runner.mjs': 'export const run = 1;\n',
  'desktop/e2e/lib/side-effect.mjs': '',
  'desktop/e2e/lib/background-proof.mjs': "import {run} from '../runner.mjs';\n",
  'desktop/e2e/lib/later.mjs': '',
  'desktop/e2e/lib/unrelated.mjs': '',
  'desktop/e2e/suite.mjs': '', 'desktop/e2e/lib/suite-main.mjs': '',
};
const read = file => tree[file] ?? null;

test('importsOf finds static, side-effect, re-export and literal dynamic imports, never packages or node:', () => {
  assert.deepEqual(importsOf(tree['desktop/e2e/lib/context.mjs']), ['./runner.mjs', './side-effect.mjs']);
  assert.deepEqual(importsOf(tree['desktop/e2e/suites/apply.mjs']), ['../lib/context.mjs', '../lib/background-proof.mjs', '../lib/later.mjs']);
  assert.deepEqual(importsOf('const a = await import(`./x/${name}.mjs`);'), [], 'a computed import cannot be followed and is not guessed');
});

test('the closure follows imports transitively from the suite and the harness roots, inside the repo', () => {
  const files = importClosure(['desktop/e2e/suites/apply.mjs', ...HARNESS_ROOTS], read);
  assert.deepEqual(files.filter(file => file.includes('lib/')).sort(), ['desktop/e2e/lib/background-proof.mjs', 'desktop/e2e/lib/context.mjs', 'desktop/e2e/lib/later.mjs',
    'desktop/e2e/lib/runner.mjs', 'desktop/e2e/lib/side-effect.mjs', 'desktop/e2e/lib/suite-main.mjs']);
  assert.ok(!files.includes('desktop/e2e/lib/unrelated.mjs'));
});

test('a step runs its suite closure, the app files the coverage map gives it, and extension/ and src/ whole', () => {
  const map = {suites: {apply: {steps: {[STEP]: {'desktop/lib/apply-run.js': {lines: [[1, 2]]}}, other: {'desktop/lib/other.js': {lines: []}}}}}};
  const set = stepFiles({suite: 'apply', step: STEP, map, read});
  assert.ok(set.files.includes('desktop/lib/apply-run.js'));
  assert.ok(!set.files.includes('desktop/lib/other.js'), "another step's files are not this step's");
  assert.deepEqual(set.dirs, ['extension/', 'src/']);
  assert.equal(set.mapped, true);
});

test('with no coverage entry for the step the whole desktop/ app counts, so the verdict can only err towards "changed"', () => {
  const set = stepFiles({suite: 'apply', step: STEP, map: null, read});
  assert.equal(set.mapped, false);
  assert.ok(set.dirs.includes('desktop/'));
});

test('touched keeps only changed names that are in the set: exact files, or under a whole directory', () => {
  const set = {files: ['desktop/e2e/lib/background-proof.mjs'], dirs: ['extension/', 'src/']};
  assert.deepEqual(touched(['desktop/e2e/ci-alert.mjs', 'desktop/e2e/lib/background-proof.mjs', 'src/ai/x.py', 'extension/a.js', 'srcs/not.py'], set),
    ['desktop/e2e/lib/background-proof.mjs', 'src/ai/x.py', 'extension/a.js']);
});

const green = (sha, files, extra = {}) => ({green: {sha, run: `r-${sha}`, url: `https://x/${sha}`, ...extra}, files});

test('flaky: some green differs from the red only outside the step files (the owner\'s apply case)', () => {
  const verdict = judge([green('4a79a6b', ['desktop/e2e/lib/background-proof.mjs']), green('79e6c34', [])]);
  assert.equal(verdict.verdict, 'flaky');
  assert.equal(verdict.green.sha, '79e6c34', 'any green counts: the one with no change on the step\'s files');
});

test('changed: every green differs on the step files, and the newest green\'s files are named', () => {
  const verdict = judge([green('a1', ['desktop/lib/apply-run.js', 'src/x.py']), green('b2', ['src/y.py'])]);
  assert.equal(verdict.verdict, 'changed');
  assert.deepEqual(verdict.files, ['desktop/lib/apply-run.js', 'src/x.py']);
  assert.equal(verdict.green.sha, 'a1');
  assert.equal(verdict.compared, 2);
});

test('unknown: no green in the window, or none that could be compared', () => {
  assert.equal(judge([]).verdict, 'unknown');
  assert.equal(judge([green('a1', null)]).verdict, 'unknown');
  assert.equal(judge([green('a1', null), green('b2', ['src/y.py'])]).verdict, 'changed', 'an uncomparable green is skipped, a comparable one decides');
});

test('sayLine names the step, the green run it compared to and, for changed, the files', () => {
  const flaky = sayLine({step: 'S', redSha: 'fb1d711aaaa', ...judge([green('79e6c34', [], {url: 'https://x/runs/41199890591'})])});
  assert.match(flaky, /^Flaky: “S” /);
  assert.match(flaky, /none of its files changed up to fb1d711/);
  assert.match(flaky, /79e6c34/);
  assert.match(flaky, /https:\/\/x\/runs\/41199890591/);
  assert.match(sayLine({step: 'S', redSha: '79e6c34aaaa', ...judge([green('79e6c34aaaa', [])])}), /the same commit 79e6c34 /, 'a green on the red\'s own commit is the strongest evidence');
  const changed = sayLine({step: 'S', ...judge([green('a1', ['a.js', 'b.js', 'c.js', 'd.js'])])});
  assert.match(changed, /^Changed: “S” /);
  assert.match(changed, /a\.js, b\.js, c\.js \+1 more/);
  assert.match(sayLine({step: 'S', ...judge([])}), /^Unknown: “S” /);
  assert.match(sayLine({step: 'S', ...judge([]), store: 'standin', otherStore: 2}), /^Unknown: “S” .*2 green\(s\) ran another store than the red's \(standin\)/, 'the line says why a green was left out');
});

// The same verdict against a real git repository: a tree diff between commits that are not ancestors of each other (a PR head against main).
test('a tree diff between a PR head and a later main names only what moved, and a PR head need not be an ancestor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flaky-verdict-'));
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {encoding: 'utf8'}).trim();
  git('init', '-q', '-b', 'main');
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true}); fs.writeFileSync(path.join(dir, file), text); };
  put('desktop/e2e/lib/background-proof.mjs', '1'); put('desktop/e2e/ci-alert.mjs', '1');
  git('add', '-A'); git('commit', '-q', '-m', 'base'); const base = git('rev-parse', 'HEAD');
  git('checkout', '-q', '-b', 'pr'); put('desktop/e2e/lib/background-proof.mjs', '2'); git('commit', '-qam', 'pr'); const pr = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main'); put('desktop/e2e/ci-alert.mjs', '2'); git('commit', '-qam', 'main'); const main = git('rev-parse', 'HEAD');
  const names = (a, b) => git('diff', '--name-only', a, b).split('\n').filter(Boolean);
  const set = {files: ['desktop/e2e/lib/background-proof.mjs'], dirs: ['extension/', 'src/']};
  assert.deepEqual(touched(names(base, main), set), [], 'main moved only the alert since base: the base green says flaky');
  assert.deepEqual(touched(names(pr, main), set), ['desktop/e2e/lib/background-proof.mjs'], 'the PR head differs on the step\'s file: that green alone says changed');
  fs.rmSync(dir, {recursive: true, force: true});
});
