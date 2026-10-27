// The Why gate (tools/why-changed.mjs): a push that deletes or rewrites a line guarded by a `Why (...):` comment carries "Why-changed: <which> — <reason>".
// Pure cases on a parsed diff, plus one throwaway git repo for the real diff (renames, a split file). Owner, 27 Oct 2026: "rule + gate".
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {checkPush, guardedChanges, missingWhyChanged, whyBlocks} from '../../tools/why-changed.mjs';

const OLD = [
  'import x from "y";',
  '',
  'export function pick(a) {',
  '  // Why (#2201, owner): the AI judges the box, never a label word list.',
  '  if (a.link_box === "work_page") return a;',
  '  return null;',
  '}',
].join('\n');

// A one-file push from OLD to `after`, as git diff -U0 prints it (computed here by a throwaway repo, so the hunks are git's own).
function repo(files, after, message = 'Change it') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'why-changed-'));
  const git = (...rest) => execFileSync('git', ['-C', dir, ...rest], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
  const write = set => { for (const [name, text] of Object.entries(set)) { const file = path.join(dir, name); if (text === null) fs.rmSync(file); else { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text); } } };
  write(files); git('add', '-A'); git('commit', '-qm', 'Base'); git('branch', 'base');
  write(after); git('add', '-A'); git('commit', '-qm', message);
  return {dir, problem: () => checkPush({root: dir, base: 'base'}), done: () => fs.rmSync(dir, {recursive: true, force: true})};
}
const push = (files, after, message) => { const r = repo(files, after, message); try { return r.problem(); } finally { r.done(); } };

test('only "Why:" and "Why (...):" mark a decision; "// Why a job has no score" describes a function and guards nothing', () => {
  assert.equal(whyBlocks('// Why a job has no score\nconst x = 1;').length, 0);
  assert.equal(whyBlocks('# Why: a reason\nx = 1').length, 1);
  assert.deepEqual(whyBlocks(OLD).map(block => block.guarded), [[4, 5]]);
});

test('a removed Why line without the trailer fails, naming the file and the Why', () => {
  const problem = push({'lib/a.js': OLD}, {'lib/a.js': OLD.replace(/  \/\/ Why.*\n/, '')});
  assert.match(problem, /lib\/a\.js:4 \/\/ Why \(#2201, owner\)/); assert.match(problem, /Why-changed:/);
});

test('rewriting the line right under a Why fails too; the line two below is free', () => {
  assert.match(push({'lib/a.js': OLD}, {'lib/a.js': OLD.replace('"work_page") return a', '"work_page" && a.label.includes("Website")) return a')}), /lib\/a\.js:4/);
  assert.equal(push({'lib/a.js': OLD}, {'lib/a.js': OLD.replace('return null', 'return undefined')}), '');
});

test('with "Why-changed: <which> — <reason>" in a commit message it passes; an empty one does not count', () => {
  const after = {'lib/a.js': OLD.replace(/  \/\/ Why.*\n/, '')};
  assert.equal(push({'lib/a.js': OLD}, after, 'Drop the box rule\n\nWhy-changed: #2201 link box — the owner moved it to the shared link rule'), '');
  assert.match(push({'lib/a.js': OLD}, after, 'Drop it\n\nWhy-changed: x'), /Why-changed:/);
});

test('a stale Why is refused even with the trailer: the line under it changed and the Why did not (owner, 27 Oct 2026)', () => {
  const trailer = 'Change the box rule\n\nWhy-changed: #2201 link box — the owner moved it to the shared link rule';
  const code = OLD.replace('"work_page") return a', '"work_page" || a.label === "Website") return a');
  assert.match(push({'lib/a.js': OLD}, {'lib/a.js': code}, trailer), /leaves the Why as it was:\n  lib\/a\.js:4/);
  assert.equal(push({'lib/a.js': OLD}, {'lib/a.js': code.replace('never a label word list.', 'or the box\'s own "Website" label (#3000).')}, trailer), '', 'the Why updated with it: fine');
  assert.equal(push({'lib/a.js': OLD}, {'lib/a.js': code.replace(/  \/\/ Why.*\n/, '')}, trailer), '', 'the Why removed with it: fine');
  const tail = 'x = 1  # Why (#5): one, not zero\n';
  assert.match(push({'w/a.py': tail}, {'w/a.py': 'x = 0  # Why (#5): one, not zero\n'}, trailer), /leaves the Why as it was/, 'a trailing Why kept on a changed line');
  const prompt = '// Why (#2203): `names neither a currency nor a period` — form 106.\nexport const RULE = `A box that names neither a currency nor a period is asked.`;\n';
  assert.match(push({'w/p.js': prompt}, {'w/p.js': prompt.replace('that names neither a currency nor a period is', 'with no currency is')}, trailer), /leaves the Why as it was/, 'a prompt sentence reworded under its Why');
});

test('a pure move passes: a renamed file, a function moved to another file, a re-indent', () => {
  assert.equal(push({'lib/a.js': OLD}, {'lib/a.js': null, 'lib/b.js': OLD}), '');
  const rest = 'import x from "y";\n\nexport { pick } from "./pick.js";\n';
  assert.equal(push({'lib/a.js': OLD}, {'lib/a.js': rest, 'lib/pick.js': OLD.split('\n').slice(2).join('\n')}), '');
  assert.equal(push({'lib/a.js': OLD}, {'lib/a.js': OLD.replace('  // Why', '    // Why').replace('  if (', '    if (')}), '');
});

test('a new Why comment passes, and so does an edit far from any Why or in a file with none', () => {
  assert.equal(push({'lib/a.js': OLD}, {'lib/a.js': OLD.replace('  return null;', '  // Why (#9): null means "ask the person".\n  return null;')}), '');
  assert.equal(push({'lib/a.js': OLD}, {'lib/a.js': OLD.replace('import x from "y"', 'import x from "z"')}), '');
  assert.equal(push({'lib/c.js': 'const a = 1;\n'}, {'lib/c.js': 'const a = 2;\n'}), '');
});

test('a file header Why guards its own lines only, not the first import under it', () => {
  const head = '// Why (12 Oct 2026): Windows ended the launcher at once.\nimport a from "b";\nconst c = 1;\n';
  assert.equal(push({'lib/h.js': head}, {'lib/h.js': head.replace('"b"', '"bb"')}), '');
  assert.match(push({'lib/h.js': head}, {'lib/h.js': head.replace('at once', 'early')}), /lib\/h\.js:1/);
});

test('a header Why ends at the next labelled line: editing "Usage:" or "Used by" under it is free', () => {
  const head = '// Merges reports.\n// Why: one corrupt zip ended a green run red.\n// Used by lib/runner.mjs and the summary.\n// Usage: x.sh <dir>\nset -u\n';
  assert.equal(push({'t/x.sh': head}, {'t/x.sh': head.replace(' and the summary', '').replace('<dir>', '<dir> <out>')}), '');
  assert.match(push({'t/x.sh': head}, {'t/x.sh': head.replace('one corrupt zip', 'a corrupt zip')}), /t\/x\.sh:2/);
});

test('a trailing Why guards the line it sits on; Python and YAML comments count', () => {
  assert.match(push({'w/a.py': 'x = 1  # Why (#5): one, not zero\n'}, {'w/a.py': 'x = 0\n'}), /w\/a\.py:1/);
  const yml = 'steps:\n  # Why (#2199, owner): retry only the red steps.\n  - run: node red-steps.mjs\n';
  assert.match(push({'ci.yml': yml}, {'ci.yml': yml.replace('red-steps.mjs', 'suite.mjs')}), /ci\.yml:2/);
});

test('a prompt sentence: a Why quoting `words` guards those words in the code, not the whole prompt line', () => {
  const prompt = '// Why (#2203): `names neither a currency nor a period` — form 106 left the salary box empty.\nexport const RULE = `Answer. A box that names neither a currency nor a period is asked in the target\'s own. Be short.`;\n';
  assert.equal(push({'w/p.js': prompt}, {'w/p.js': prompt.replace('Be short.', 'Be brief.')}), '', 'another sentence of the same prompt is free');
  const [why, code] = prompt.split('\n');
  assert.match(push({'w/p.js': prompt}, {'w/p.js': `${why}\n${code.replace('names neither a currency nor a period', 'has no currency')}\n`}), /guarded words are gone: "names neither a currency nor a period"/);
  assert.match(push({'w/p.js': prompt}, {'w/p.js': prompt.replace('form 106 left', 'form 106 had')}), /w\/p\.js:1/, 'rewording the Why itself is a change to it');
});

test('Markdown and other non-code files are not read', () => {
  assert.equal(push({'docs/a.md': '<!-- x -->\n# Why: a heading\ntext\n'}, {'docs/a.md': 'other\n'}), '');
});

test('the pure parts agree with the repo path', () => {
  assert.deepEqual(guardedChanges('', () => '', () => ''), []);
  assert.equal(missingWhyChanged([], []), '');
});

test('the push gate runs it where the other trailer checks run, before a PR push stops', () => {
  const hook = fs.readFileSync(new URL('../../tools/pre-push-check.sh', import.meta.url), 'utf8');
  const at = hook.indexOf('node tools/why-changed.mjs --base origin/main');
  assert.ok(at > 0, 'tools/pre-push-check.sh runs tools/why-changed.mjs --base origin/main');
  assert.ok(Math.abs(at - hook.indexOf('node tools/rung-trailer.mjs --base origin/main')) < 1500, 'beside the rung trailer check');
  assert.ok(at < hook.indexOf('case "$command" in *SHIP_PR=1*|*CI_GATES=1*)'), 'before the line where a PR push stops');
});
