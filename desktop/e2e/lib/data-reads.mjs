// The repo data files a source file reads at run time (docs, config, JSON named by a path), so a change to one counts as a change to the line that reads it: for the after-merge
// picker (pr-suites.mjs: a changed data file picks the steps that ran its reading line) and the flaky verdict (lib/flaky-verdict.mjs stepFiles: a step's files include what they read).
// Why (2 Nov 2026, betas 16 and 17): #2926 edited docs/notion-profile-template.md, which desktop/lib/strategy.js:92 puts into the wizard's AI ask. The picker dropped every .md change
// (lib/plan.mjs) and the coverage map records code lines only, so no step ran after the merge; the verdict compared code only, so the same red twice looked flaky.
// Invariants: pure (texts in, paths out); a computed path (a template, a variable) is not guessed; a comment or a sentence that mentions a path reads nothing.
// Tests: test/replay/data-reads.test.mjs
// Job: pick the suites
import path from 'node:path';

const DATA = /\.(md|json|jsonl|txt|ya?ml|csv|tsv|toml|html|xml)$/i;
const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const SEGMENT = /^(\.\.?|[\w@.-]+)(\/(\.\.?|[\w@.-]+))*\/?$/;   // a path or a piece of one: no space, no colon, no template
const COMMENT = /^\s*(\/\/|\/\*|\*|#)/;

/** @returns {boolean} a file whose change is read as data (a code file is followed by its imports and the coverage map instead). */
export const isDataFile = file => DATA.test(String(file));

/**
 * The repo data files one source line names with string literals: one literal, or several in a row joined by '/' (`path.join(REPO, 'docs', 'x.md')`,
 * `parents[2] / 'docs' / 'x.md'`), from the repo's root or from the file's own folder (`new URL('../../demo/draft.json', import.meta.url)`).
 * @returns {string[]} repo-relative '/' paths, sorted; a junk join never matches a real changed file, so it costs nothing.
 */
export function pathsOn(line, file) {
  if (COMMENT.test(line)) return [];
  const parts = [...String(line).matchAll(LITERAL)].map(found => found[2]);
  const out = new Set();
  for (let start = 0; start < parts.length; start++) {
    for (let end = start; end < parts.length && SEGMENT.test(parts[end]); end++) {
      const joined = parts.slice(start, end + 1).join('/');
      if (!isDataFile(joined)) continue;
      const own = path.posix.join(path.posix.dirname(file), joined);
      for (const candidate of /^\.\.?\//.test(joined) ? [own] : [joined, own]) {
        const clean = path.posix.normalize(candidate);
        if (clean.includes('/') && !clean.startsWith('../') && !clean.startsWith('/')) out.add(clean);
      }
    }
  }
  return [...out].sort();
}

/** @returns {string[]} every data file a source text names on its lines (pathsOn), once, sorted. */
export function dataReadBy(text, file) {
  return [...new Set(String(text || '').split('\n').flatMap(line => pathsOn(line, file)))].sort();
}

/**
 * The lines that read `dataFile`, from `git grep -n` output over a commit ("<sha>:<path>:<line>:<text>", or without the sha): the changed-line ranges
 * stepsCovering reads for each reader, {path: [[line, line]]}. Only code files read; a doc that mentions the path does not.
 */
export function readHunks(grepOutput, dataFile) {
  const out = {};
  for (const row of String(grepOutput).split('\n')) {
    const found = /^(?:[0-9a-f]{7,40}:)?([^:]+):(\d+):(.*)$/.exec(row);
    if (!found || isDataFile(found[1]) || !pathsOn(found[3], found[1]).includes(dataFile)) continue;
    (out[found[1]] ||= []).push([Number(found[2]), Number(found[2])]);
  }
  return out;
}
