// Which harness test files a change reaches: each test's relative imports (static, dynamic, and files it reads via new URL(..., import.meta.url)), followed to the end.
// Job: pick the suites
// Why (owner, 27 Oct 2026, "Yes, reached files"): a PR ran only the 30-file "pr" set, so a harness or app change broke its own daily-set tests unseen;
// harness-daily stayed red 10 days. A PR now also runs every test file whose imports reach a file it changed. Guard: test/test-reach.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

// Relative specifiers only: a package (playwright, node:fs) is never a changed file. Comments are not stripped: a commented-out import only adds a test, never drops one.
const SPECIFIERS = [
  /\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
  /new URL\(\s*['"](\.{1,2}\/[^'"]*)['"]\s*,\s*import\.meta\.url\s*\)/g,
];
// desktop/shared/ is staged, never in a diff (desktop/scripts/stage.mjs copies it): a reach into it is a reach into the file it was copied from (review on #2241).
const STAGED = [[/^desktop\/shared\/worker\//, 'worker/src/'], [/^desktop\/shared\/bot-worker\.js$/, 'worker/src/'], [/^desktop\/shared\/ladder-core\.js$/, 'extension/ladder/core.js'],
  [/^desktop\/shared\/ladder\//, 'extension/ladder/'], [/^desktop\/shared\/(recipe|alias)-schema\.js$/, 'extension/$1-schema.js']];
/** A staged desktop/shared/ path -> the repo file or folder it is copied from; any other path as it is. @param {string} file @returns {string} */
export const unstage = file => { for (const [from, to] of STAGED) if (from.test(file)) return file.replace(from, to); return file; };
const BROWSER = /\bfrom\s*['"](?:playwright|playwright-core|@playwright\/test)['"]|\bimport\(\s*['"](?:playwright|playwright-core)['"]\s*\)/;
const CODE = /\.(?:mjs|js|cjs)$/;

/** Relative specifiers in a module's text, in order of appearance per pattern. @param {string} text @returns {string[]} */
export function specifiers(text) {
  // A module that runs code by a computed path (a spawned child, the Electron app) names it on a "// Reaches: <relative paths>" line.
  const declared = [...text.matchAll(/^\/\/ Reaches: (.+)$/gm)].flatMap(found => found[1].split(/\s+/).filter(item => /^\.{1,2}\//.test(item)));
  return [...SPECIFIERS.flatMap(pattern => [...text.matchAll(pattern)].map(found => found[1])), ...declared];
}

/**
 * Every repo-relative path a test file reaches (itself included); a directory read via new URL ends with '/' and covers every file under it.
 * @param {string} root the repo root  @param {string} file a repo-relative path  @param {Map} [cache] shared between calls
 * @returns {{paths: Set<string>, browser: boolean}} browser: some reached module imports Playwright (the job then installs a browser)
 */
export function reach(root, file, cache = new Map()) {
  const paths = new Set(), queue = [file];
  let browser = false;
  while (queue.length) {
    const current = queue.pop();
    if (paths.has(current)) continue;
    paths.add(current);
    if (current.endsWith('/') || !CODE.test(current)) continue;
    let text = cache.get(current);
    if (text === undefined) { try { text = fs.readFileSync(path.join(root, current), 'utf8'); } catch { text = ''; } cache.set(current, text); }
    if (BROWSER.test(text)) browser = true;
    for (const spec of specifiers(text)) {
      const joined = path.posix.normalize(path.posix.join(path.posix.dirname(current), spec));
      if (joined.startsWith('..') || joined === '.' || joined === './') continue;   // the repo root (a test that reads any file): every change would reach it
      // Why (#2435/#2450, 29 Oct 2026): parent-only specifiers such as ../.. name directories, which workflow globs need with a trailing slash.
      const directory = spec.endsWith('/') || spec.split('/').every(part => part === '.' || part === '..');
      queue.push(unstage(directory ? `${joined.replace(/\/?$/, '/')}` : joined));
    }
  }
  return {paths, browser};
}

// Test data other jobs replay (harness.yml's paths leave them out): a change there runs only the tests that read it, not the pr set.
const DATA = /^desktop\/e2e\/(?:recorded|recorded-pending|fixtures|ladder-fixtures|widget-zoo)\//;
const HARNESS_INPUTS = new Set(['.github/workflows/harness.yml', 'desktop/package.json', 'desktop/package-lock.json', 'desktop/scripts/stage.mjs']);
// Why (#2458, 29 Oct 2026): replay data only reaches reads inside DATA trees; ancestor directories would select tests for paths the workflow excludes.
const covers = (reached, changed) => reached.has(changed) || [...reached].some(item => item.endsWith('/') && changed.startsWith(item) && (!DATA.test(changed) || DATA.test(item)));

/**
 * The harness test files a change reaches. Assumes `changed` is repo-relative with '/' separators.
 * Invariant: any nonempty selection includes the workflow coverage guard; no reached tests means no guard.
 * @param {{root: string, tests: string[], changed: string[], always?: string[]}} input tests: repo-relative test files; always: run when the harness itself changed
 * @returns {{files: string[], browser: boolean, why: Record<string, string>}} files sorted; why: each file's first changed path that reached it
 */
export function reachedTests({root, tests, changed, always = []}) {
  const cache = new Map(), why = {};
  let browser = false;
  // What the job installs and stages from runs the pr set too, as before #2241 (review on #2241): no test imports a package file or stage.mjs.
  const harnessChanged = changed.some(file => (file.startsWith('desktop/e2e/') && !DATA.test(file)) || HARNESS_INPUTS.has(file));
  for (const test of tests) {
    const reached = reach(root, test, cache);
    const hit = changed.find(file => covers(reached.paths, file)) || (harnessChanged && always.includes(test) ? 'the harness changed: the pr set' : '');
    if (!hit) continue;
    why[test] = hit;
    browser ||= reached.browser;
  }
  // Why (#2435/#2450, 29 Oct 2026): another test's reads can break workflow coverage without importing the guard that checks it.
  if (Object.keys(why).length) why['desktop/e2e/test/test-reach.test.mjs'] ||= 'a harness test was reached: check workflow paths';
  return {files: Object.keys(why).sort(), browser, why};
}
