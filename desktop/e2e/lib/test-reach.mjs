// Every path a harness test reaches: its relative imports (static, dynamic, and files it reads via new URL(..., import.meta.url)), followed to the end.
// Job: run the backbone
// Why (owner, 30 Oct 2026, option C "run all on every PR"): every harness PR runs every test file, so nothing picks files any more; what is left is the
// reach itself, which harness.yml's `on: paths:` must cover so a change a test reaches starts the run. Guard: test/harness/test-reach.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

// Relative specifiers only: a package (playwright, node:fs) is never a repo path. Comments are not stripped: a commented-out import only adds a path to cover, never drops one.
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
 * @returns {{paths: Set<string>}}
 */
export function reach(root, file, cache = new Map()) {
  const paths = new Set(), queue = [file];
  while (queue.length) {
    const current = queue.pop();
    if (paths.has(current)) continue;
    paths.add(current);
    if (current.endsWith('/') || !CODE.test(current)) continue;
    let text = cache.get(current);
    if (text === undefined) { try { text = fs.readFileSync(path.join(root, current), 'utf8'); } catch { text = ''; } cache.set(current, text); }
    for (const spec of specifiers(text)) {
      const joined = path.posix.normalize(path.posix.join(path.posix.dirname(current), spec));
      if (joined.startsWith('..') || joined === '.' || joined === './') continue;   // the repo root (a test that reads any file): every change would reach it
      // Why (#2435/#2450, 29 Oct 2026): parent-only specifiers such as ../.. name directories, which workflow globs need with a trailing slash.
      const directory = spec.endsWith('/') || spec.split('/').every(part => part === '.' || part === '..');
      queue.push(unstage(directory ? `${joined.replace(/\/?$/, '/')}` : joined));
    }
  }
  return {paths};
}
