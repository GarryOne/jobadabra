#!/usr/bin/env node
// The comment checks a push's NEW code must pass (docs/rules/files.md "Comments"; owner, 27 Oct 2026), only what is cheap and certain:
//   - a new exported function (JS `export function` / `export const x = (...) =>`, Python top-level `def` outside tests) has a doc comment: a comment
//     right above it, a trailing one on its line, or a Python docstring; what it should say (inputs, result, failure, data source) is the rule's, not this check's;
//   - a debt note has its tag form: `TODO(AI): <what> (<date or #PR>)` or `FIXME: <what>`, never a bare "TODO", "XXX", "HACK" or "fix later".
// Old code is never asked (no mass rewrite); a moved line (removed elsewhere in the same push) is not new.
// Usage: node tools/new-code-comments.mjs [--base origin/main]   exit 1 with file:line and the fix. Guard: desktop/test/new-code-comments.test.js.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const CODE_FILE = /\.(m?js|cjs|ts|py|sh)$/;
const TEST_FILE = /(^|\/)(tests?|e2e\/test|__tests__)\/|\.test\.|(^|\/)test_[^/]*\.py$/;
const JS_EXPORT = /^export\s+(?:async\s+)?function\s*\*?\s*\w|^export\s+const\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|^export\s+const\s+\w+\s*=\s*(?:async\s+)?function\b/;
const PY_DEF = /^(?:async\s+)?def\s+(?!main\s*\()[a-z]\w*\s*\(/;   // top level, public (a leading underscore is private); a script's main() needs none
const isComment = line => /^\s*(\/\/|#|\/\*|\*)/.test(line);
// A line's trailing comment, '' when none: strings are blanked first, so a "//" or "#" inside one is not a comment.
const commentOf = line => { const code = line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""'); const at = code.search(/(?:^|\s)(\/\/|#)\s/); return at < 0 ? '' : code.slice(at).trim(); };
const DEBT = /\b(TODO|FIXME|XXX|HACK)\b|\b[Ff]ix (?:it |this )?later\b/;   // upper case only: "to-do" is a feature of the app
const DEBT_OK = /\bTODO\(AI\):\s*\S.{4,}\(\s*(?:\d{1,2} \w{3} \d{4}|\d{4}-\d{2}-\d{2}|#\d+)\s*\)|\bFIXME:\s*\S.{8,}/;
const HOW_DOC = 'Add a comment right above it (or a Python docstring): what it takes, what it returns, what it does on a failure, where its data comes from.';
const HOW_DEBT = 'Write it as "TODO(AI): <what is left> (<date or #PR>)" or "FIXME: <what is wrong>"; never "fix later".';

// A `git diff -U0` -> {files: [{path, added: [{line, text}]}], removed: Set of every removed line, trimmed}. line: in the new file.
export function addedLines(diff) {
  const files = [], removed = new Set();
  let file = null, newLine = 0;
  for (const line of String(diff).split('\n')) {
    if (line.startsWith('diff --git ')) { file = {path: null, added: []}; files.push(file); continue; }
    if (!file) continue;
    if (line.startsWith('+++ ')) { file.path = line === '+++ /dev/null' ? null : line.slice(6); continue; }
    if (line.startsWith('--- ')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { newLine = Number(hunk[1]); continue; }
    if (line.startsWith('+')) file.added.push({line: newLine++, text: line.slice(1)});
    else if (line.startsWith('-')) removed.add(line.slice(1).trim());
  }
  return {files: files.filter(item => item.path), removed};
}

// Python: the first line after a def's signature (it may span lines) is a docstring.
function pyDocstring(lines, at) {
  let end = at;
  while (end < lines.length - 1 && !/:\s*(#.*)?$/.test(lines[end])) end++;
  let next = end + 1;
  while (next < lines.length && !lines[next].trim()) next++;
  return /^\s*[rbuf]*("""|''')/i.test(lines[next] || '');
}

// -> the problems, ['file:line what', ...] (empty when fine). newText(path): the file after the push.
export function commentProblems(diff, newText) {
  const {files, removed} = addedLines(diff), problems = [];
  for (const file of files) {
    if (!CODE_FILE.test(file.path)) continue;
    let lines = null;
    for (const {line, text} of file.added) {
      if (removed.has(text.trim())) continue;   // moved, not new
      const comment = isComment(text) ? text.trim() : commentOf(text);
      if (comment && DEBT.test(comment) && !DEBT_OK.test(comment)) problems.push(`${file.path}:${line} a debt note without its tag: ${comment.slice(0, 90)}\n    ${HOW_DEBT}`);
      if (TEST_FILE.test(file.path)) continue;
      const py = file.path.endsWith('.py');
      if (!(py ? PY_DEF.test(text) : JS_EXPORT.test(text))) continue;
      lines ||= newText(file.path).split('\n');
      const above = lines[line - 2] || '';
      if (isComment(above) || commentOf(text) || (py && pyDocstring(lines, line - 1))) continue;
      problems.push(`${file.path}:${line} a new exported function with no doc comment: ${text.trim().slice(0, 90)}\n    ${HOW_DOC}`);
    }
  }
  return problems;
}

// -> '' or the message for the push base..HEAD of the repo at root.
export function checkPush({root, base = 'origin/main'}) {
  const git = (...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore']});
  let diff;
  try { diff = git('diff', '-U0', '-M', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', git('merge-base', base, 'HEAD').trim(), 'HEAD'); } catch { return ''; }
  const problems = commentProblems(diff, file => { try { return git('show', `HEAD:${file}`); } catch { return ''; } });
  return problems.length ? `this push adds code whose comments are missing (docs/rules/files.md "Comments"):\n  ${problems.slice(0, 10).join('\n  ')}${problems.length > 10 ? `\n  … ${problems.length - 10} more` : ''}` : '';
}

function main() {
  const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'origin/main';
  const why = checkPush({root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), base});
  if (why) { console.error(why); return 1; }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main());
