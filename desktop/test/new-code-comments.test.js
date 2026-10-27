// The comment checks on a push's new code (tools/new-code-comments.mjs; owner, 27 Oct 2026): a new exported function has a doc comment, a debt note has its tag.
// Fake diffs in git's -U0 shape; old code is never asked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {commentProblems} from '../../tools/new-code-comments.mjs';

// A diff that adds `lines` at the top of a new file `path` (lines removed elsewhere: `gone`).
const diff = (path, lines, gone = []) => [
  ...(gone.length ? ['diff --git a/old.js b/old.js', '--- a/old.js', '+++ b/old.js', `@@ -1,${gone.length} +0,0 @@`, ...gone.map(line => `-${line}`)] : []),
  `diff --git a/${path} b/${path}`, '--- /dev/null', `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(line => `+${line}`),
].join('\n');
const check = (path, lines, gone) => commentProblems(diff(path, lines, gone), () => lines.join('\n'));

test('a new exported function without a doc comment is named with file:line', () => {
  for (const line of ['export function pick(a) {', 'export async function load() {', 'export const pick = (a) => a;', 'export const pick = async x => x;', 'export const pick = function (a) {']) {
    const [problem] = check('desktop/lib/a.js', ['const x = 1;', line]);
    assert.match(problem || '', /desktop\/lib\/a\.js:2 a new exported function with no doc comment/, line);
  }
  assert.match(check('src/a.py', ['import os', '', 'def pick(a):', '    return a'])[0] || '', /src\/a\.py:3/);
});

test('a comment above, a trailing one or a Python docstring is enough; private and test code is not asked', () => {
  assert.deepEqual(check('desktop/lib/a.js', ['// -> the pick, or null when none (read from the store).', 'export function pick(a) {']), []);
  assert.deepEqual(check('desktop/lib/a.js', ['/**', ' * The pick.', ' */', 'export function pick(a) {']), []);
  assert.deepEqual(check('desktop/lib/a.js', ['export const pick = a => a;   // the first of a']), []);
  assert.deepEqual(check('src/a.py', ['def pick(a,', '         b):', '    """The pick of a and b; None when neither."""']), []);
  assert.deepEqual(check('src/a.py', ['def _pick(a):', '    return a', 'def main():', '    pass']), []);
  assert.deepEqual(check('desktop/lib/a.js', ['export const LIMIT = 3;', 'function local() {}']), []);
  assert.deepEqual(check('desktop/test/a.test.js', ['export function helper() {}']), []);
  assert.deepEqual(check('tests/test_a.py', ['def helper():', '    pass']), []);
});

test('a moved function is not new: the same line removed elsewhere in the push', () => {
  assert.deepEqual(check('desktop/lib/b.js', ['export function pick(a) {'], ['export function pick(a) {']), []);
});

test('a debt note needs its tag: "TODO(AI): <what> (<date or #PR>)" or "FIXME: <what>"; never a bare TODO or "fix later"', () => {
  for (const line of ['// TODO handle the rest', '  x = 1;  // TODO', '# XXX odd', '// HACK: works', '// fix this later', '// TODO(AI): handle the rest']) {
    assert.match(check('desktop/lib/a.js', [line]).join('\n'), /a debt note without its tag/, line);
  }
  assert.deepEqual(check('desktop/lib/a.js', ['// TODO(AI): read the second page too (27 Oct 2026)', '// TODO(AI): ask once per job (#2210)', '// FIXME: the count is off by one on an empty list']), []);
  assert.deepEqual(check('desktop/lib/a.js', ['const examples = [\'  x = 1;  // TODO\', "# XXX"];']), [], 'a "//" inside a string is not a comment');
  assert.deepEqual(check('desktop/lib/a.js', ['const todo = rows.filter(Boolean);   // the to-do rows', 'const url = "https://example.com/TODO";']), [], 'the app\'s to-do and code that is not a comment');
});

test('the push gate runs it beside the Why check, before a PR push stops', () => {
  const hook = fs.readFileSync(new URL('../../tools/pre-push-check.sh', import.meta.url), 'utf8');
  const at = hook.indexOf('node tools/new-code-comments.mjs --base origin/main');
  assert.ok(at > 0 && Math.abs(at - hook.indexOf('node tools/why-changed.mjs --base origin/main')) < 1500);
  assert.ok(at < hook.indexOf('case "$command" in *SHIP_PR=1*|*CI_GATES=1*)'));
});
