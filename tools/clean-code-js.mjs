// Refuses new JS code that is too tangled or copies itself (sonarjs rules), on the lines a change adds, and an old function the change makes
// more complex while it is over the limit; old code the change leaves as complex as it was is never refused.
// Run by `npm run lint` in desktop/ (push gate and the desktop CI job):
//   node tools/clean-code-js.mjs [base]      exit 1 with file:line and the rule for each finding
// Why (28 Oct 2026, owner): "our code is very clean so that AI hallucinations are less prone to introduce bugs". Rules kept by a 20-finding
// sample on the whole tree (docs/superpowers/plans/2026-10-28-clean-code-checks.md): cognitive complexity, identical functions, duplicated
// branches, collapsible ifs. Dropped as mostly noise: duplicate strings (DOM ids), nested ternaries, expression complexity.
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireDesktop = createRequire(path.join(root, 'desktop/package.json'));

/** The most a new function may score before it is split (sonarjs default is 15; 20 keeps the first gate to clearly tangled code). */
export const COMPLEXITY_LIMIT = 20;
const RULES = {
  'sonarjs/cognitive-complexity': ['error', COMPLEXITY_LIMIT],
  'sonarjs/no-identical-functions': 'error',
  'sonarjs/no-duplicated-branches': 'error',
  'sonarjs/no-collapsible-if': 'error',
};
const SCOPE = /^(desktop|extension)\/.*\.(js|mjs|cjs)$/;
const SKIP = /(^|\/)(node_modules|vendor|shared|\.design-system|dist|build)\//;

let linter;
async function eslint() {
  if (linter) return linter;
  let ESLint, sonarjs;
  try {
    ({ESLint} = requireDesktop('eslint'));
    sonarjs = requireDesktop('eslint-plugin-sonarjs');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    // Why (28 Oct 2026, #2414): the shared desktop/node_modules in a worktree can predate the lock that added the plugin.
    throw new Error(`clean-code: ${error.message.split('\n')[0]}. The shared node_modules is older than the lock: cd ~/jobadabra/desktop && npm ci (primary checkout only, never through a worktree link).`);
  }
  // Why (29 Oct 2026): ESLint ignores a file outside its cwd with a rule-less message, which read as clean; run from desktop/, extension/ went unchecked.
  linter = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [{files: ['**/*.js', '**/*.mjs', '**/*.cjs'], languageOptions: {sourceType: 'module', ecmaVersion: 'latest'}, plugins: {sonarjs: sonarjs.default ?? sonarjs}, rules: RULES}],
  });
  return linter;
}

/** The exception comment: `// clean-code-ok: Why (<PR or date>): <reason>`, on the finding's line or the line above. A marker with no `//`, no `(<PR or date>)` or no reason does not count. */
const EXCEPTION = /\/\/\s*clean-code-ok:\s*Why\s*\([^)]+\)\s*:\s*\S/;

const COMPLEXITY = 'sonarjs/cognitive-complexity';
const score = message => Number(/from (\d+) to the \d+ allowed/.exec(message)?.[1] ?? 0);

/** Each over-limit function's complexity in `source`, by the line sonarjs reports it on (the function's head). */
async function complexityByLine(runner, source, file) {
  const [result] = await runner.lintText(source, {filePath: path.join(root, file)});
  return new Map(result.messages.filter(m => m.ruleId === COMPLEXITY).map(m => [m.line, score(m.message)]));
}

/**
 * Lints each file's source and keeps the findings with no exception comment that sit on a line the change added, or that report an old
 * function (its head line unchanged) the change made more complex while it is over the limit.
 * @param {{path: string, source: string, added: Set<number>, base?: {source: string, lineOf: (line: number) => number|null}|null}[]} files
 *   `base`: the file before the change and where each unchanged line sat in it; null for a new file
 * @returns {Promise<{path: string, line: number, rule: string, message: string}[]>}
 */
export async function check(files) {
  const runner = await eslint();
  const found = [];
  for (const file of files) {
    const lines = file.source.split('\n');
    const excused = line => EXCEPTION.test(lines[line - 1] ?? '') || EXCEPTION.test(lines[line - 2] ?? '');
    const [result] = await runner.lintText(file.source, {filePath: path.join(root, file.path)});
    let before;   // the base's over-limit functions, linted once per file and only when an old one is over the limit now
    for (const m of result.messages) {
      if (!m.ruleId?.startsWith('sonarjs/') || excused(m.line)) continue;
      if (file.added.has(m.line)) { found.push({path: file.path, line: m.line, rule: m.ruleId, message: m.message}); continue; }
      // Why (29 Oct 2026, owner: "do we have PR CI guardrails to not get back again in this situation"): fillTab (113) and consider (247)
      // grew a few lines at a time, each change passing because complexity is reported on the head line, which none of them touched.
      if (m.ruleId !== COMPLEXITY || !file.base) continue;
      before ??= await complexityByLine(runner, file.base.source, file.path);
      const was = before.get(file.base.lineOf(m.line)) ?? 0;
      if (score(m.message) > was) {
        found.push({path: file.path, line: m.line, rule: m.ruleId, message: `${m.message} This change raised it from ${was || `at most ${COMPLEXITY_LIMIT}`}: an old function over the limit may not grow.`});
      }
    }
  }
  return found;
}

const gitIn = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe']});
const git = (...args) => gitIn(root, ...args);

/** Line numbers a diff adds to one file (`@@ -a,b +c,d @@` hunks, no context). */
export function addedLines(diff) {
  const added = new Set();
  for (const [, start, count] of diff.matchAll(/^@@ [^+]*\+(\d+)(?:,(\d+))? @@/gm)) {
    for (let i = 0; i < (count === undefined ? 1 : Number(count)); i++) added.add(Number(start) + i);
  }
  return added;
}

/**
 * For a diff with no context lines (`-U0`): the base line number of each line of the new file, or null for a line the diff adds.
 * Invariant: a hunk with no new lines (`+c,0`) removes base lines after new line c.
 * @returns {(line: number) => number|null}
 */
export function baseLineOf(diff) {
  const hunks = [...diff.matchAll(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)]
    .map(([, removed = '1', start, count = '1']) => ({removed: Number(removed), start: Number(start), count: Number(count)}));
  return line => {
    let shift = 0;
    for (const h of hunks) {
      if (line >= h.start && line < h.start + h.count) return null;
      if (line > (h.count ? h.start + h.count - 1 : h.start)) shift += h.removed - h.count;
    }
    return line + shift;
  };
}

/**
 * The commit a change is measured from: the merge base with origin/main. A shallow CI checkout of the PR's merge commit has no common history;
 * there the base is the merge commit's first parent, which is main as it was when the merge ref was built (fetched if missing), so a job
 * re-run after main moved still sees exactly what the PR adds. Fetches main once when the ref is missing; null when there is no base.
 */
export function baseCommit(cwd = root) {
  // Why (28 Oct 2026, #2414): the desktop CI job checks out the PR with no origin/main ref, and `git merge-base` threw there.
  const git = (...args) => gitIn(cwd, ...args).trim();
  const ok = (...args) => { try { git(...args); return true; } catch { return false; } };
  if (!ok('rev-parse', '--verify', '-q', 'origin/main')) ok('fetch', '-q', 'origin', 'main');   // offline: no base below
  if (!ok('rev-parse', '--verify', '-q', 'origin/main')) return null;
  try { return git('merge-base', 'origin/main', 'HEAD'); } catch { /* shallow: no shared history */ }
  // A depth-1 clone hides the parents from rev-parse; the commit object still names them.
  const parents = [...git('cat-file', '-p', 'HEAD').matchAll(/^parent (\w+)$/gm)].map(m => m[1]);
  if (parents.length === 2 && (ok('cat-file', '-e', parents[0]) || ok('fetch', '-q', '--depth=1', 'origin', parents[0]))) return parents[0];
  return 'origin/main';
}

/**
 * The in-scope JS files the committed HEAD adds or edits since `base`, as [{path, source, added, base}]: the pushed commits only (never the
 * working tree) and renames counted as new files (base null), so a moved-and-edited file is checked too.
 */
export function changedFiles(base, cwd = root) {
  const changes = gitIn(cwd, 'diff', '--name-status', '--no-renames', '--diff-filter=AM', base, 'HEAD').split('\n')
    .map(row => row.split('\t')).filter(([, name]) => name && SCOPE.test(name) && !SKIP.test(name));
  return changes.map(([status, name]) => {
    const diff = gitIn(cwd, 'diff', '-U0', '--no-renames', base, 'HEAD', '--', name);
    const before = status === 'M' ? {source: gitIn(cwd, 'show', `${base}:${name}`), lineOf: baseLineOf(diff)} : null;
    return {path: name, source: gitIn(cwd, 'show', `HEAD:${name}`), added: addedLines(diff), base: before};
  });
}

async function main() {
  const base = process.argv[2] || baseCommit();
  if (!base) { console.error('clean-code: no origin/main to compare with, nothing checked'); return; }
  let found;
  try { found = await check(changedFiles(base)); } catch (error) { console.error(error.message); process.exit(1); }
  for (const f of found) console.error(`${f.path}:${f.line}  ${f.rule}  ${f.message}`);
  if (found.length) {
    console.error(`clean-code: ${found.length} finding(s) in this change. Split the function or reuse the existing one; a justified exception, on the flagged line or the line above: // clean-code-ok: Why (<PR or date>): <reason>   (not eslint-disable: the main lint pass does not know sonarjs rules)`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
