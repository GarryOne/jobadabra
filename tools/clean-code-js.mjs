// Refuses new JS code that is too tangled or copies itself (sonarjs rules), on the lines a change adds, never on old code.
// Run by `npm run lint` in desktop/ (push gate and the desktop CI job):
//   node tools/clean-code-js.mjs [base]      exit 1 with file:line and the rule for each finding on an added line
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
  linter = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{files: ['**/*.js', '**/*.mjs', '**/*.cjs'], languageOptions: {sourceType: 'module', ecmaVersion: 'latest'}, plugins: {sonarjs: sonarjs.default ?? sonarjs}, rules: RULES}],
  });
  return linter;
}

/**
 * Lints each file's source and keeps the findings that sit on a line the change added.
 * @param {{path: string, source: string, added: Set<number>}[]} files
 * @returns {Promise<{path: string, line: number, rule: string, message: string}[]>}
 */
export async function check(files) {
  const runner = await eslint();
  const found = [];
  for (const file of files) {
    const [result] = await runner.lintText(file.source, {filePath: path.join(root, file.path)});
    for (const m of result.messages) {
      if (m.ruleId?.startsWith('sonarjs/') && file.added.has(m.line)) found.push({path: file.path, line: m.line, rule: m.ruleId, message: m.message});
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
 * The in-scope JS files the committed HEAD adds or edits since `base`, as [{path, source, added}]: the pushed commits only (never the working
 * tree) and renames counted as new files, so a moved-and-edited file is checked too.
 */
export function changedFiles(base, cwd = root) {
  const names = gitIn(cwd, 'diff', '--name-only', '--no-renames', '--diff-filter=AM', base, 'HEAD').split('\n').filter(n => SCOPE.test(n) && !SKIP.test(n));
  return names.map(name => ({path: name, source: gitIn(cwd, 'show', `HEAD:${name}`), added: addedLines(gitIn(cwd, 'diff', '-U0', '--no-renames', base, 'HEAD', '--', name))}));
}

async function main() {
  const base = process.argv[2] || baseCommit();
  if (!base) { console.error('clean-code: no origin/main to compare with, nothing checked'); return; }
  let found;
  try { found = await check(changedFiles(base)); } catch (error) { console.error(error.message); process.exit(1); }
  for (const f of found) console.error(`${f.path}:${f.line}  ${f.rule}  ${f.message}`);
  if (found.length) {
    console.error(`clean-code: ${found.length} finding(s) on lines this change adds. Split the function or reuse the existing one; a justified exception: // eslint-disable-next-line <rule> -- Why (<PR or date>): <reason>`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
