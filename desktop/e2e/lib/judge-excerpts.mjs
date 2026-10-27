// The code a one-call judge (lib/judge-call.mjs) reads, fetched by code: the claude-code-action agent grepped for itself; a plain call gets the lines its finding
// names instead. From the finding's own words (quoted text, `code`, file:line, a function name, a failed step's title) -> `git grep -F` at the tested build ->
// a few numbered excerpts. Fetching only, no judgment: which excerpt matters is the AI's call. Guarded by test/judge-excerpts.test.mjs.
import {execFileSync} from 'node:child_process';

export const PATHS = {ui: ['desktop/renderer', 'desktop/lib', 'desktop/main.js', 'desktop/preload.js'], code: ['src', 'desktop/lib', 'desktop/renderer', 'extension', 'desktop/main.js'],
  suite: ['desktop/e2e/suites', 'desktop/e2e/lib']};
const MAX_EXCERPTS = 8, AROUND = 10, MAX_CHARS = 14000, MAX_HITS = 3;
const realGit = (args, cwd) => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']});

// The finding's words worth searching for, most specific first: file refs, quoted text, code spans, called names, then the failed step's title.
export function needlesOf(finding) {
  const text = `${finding.title || ''}\n${finding.detail || ''}\n${finding.impact || ''}`;
  const refs = [...text.matchAll(/((?:desktop|src|extension|tools)\/[\w./-]+\.\w+)(?::(\d+))?/g)].map(m => ({ref: m[1], line: Number(m[2]) || 0}));
  const quoted = [...text.matchAll(/[`'"“‘]([^`'"”’\n]{4,80})[`'"”’]/g)].map(m => m[1].trim()).filter(s => /[a-z]/i.test(s));
  const named = [...text.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(\)?/g)].map(m => m[1].split('.').at(-1)).filter(s => s.length > 3);
  // CSS selectors the detectors print (div.run-mode-main, span#activity-meta, #cal-upcoming .cal-row): their class and id names.
  const selectors = [...text.matchAll(/(?:^|[\s('"(])[a-z]*((?:[#.][a-z][\w-]{3,})+)/gi)].flatMap(m => m[1].split(/[#.]/).filter(name => name.length > 4 && /-|[A-Z]/.test(name)));
  const files = [...text.matchAll(/(?:^|[\s(])([\w-]+\.(?:js|mjs|css|html|py))\b/g)].map(m => m[1]);
  const words = [...new Set([...quoted, ...selectors, ...named.map(name => `${name}(`)])].filter(word => !/^(https?:|the |a )/i.test(word));
  // A quote with an ellipsis or a number in it often differs from the source: also try its longest plain piece.
  const pieces = words.flatMap(word => { const piece = word.split(/…|\.\.\.|\d+|[{}]/).map(s => s.trim()).sort((a, b) => b.length - a.length)[0]; return piece && piece !== word && piece.length >= 8 ? [word, piece] : [word]; });
  return {refs, files: [...new Set(files)], words: [...new Set(pieces)]};
}

export const pathsFor = finding => (finding.source === 'code-review' ? PATHS.code : finding.source === 'suite-failure' ? [...PATHS.suite, ...PATHS.ui] : PATHS.ui);

// -> [{file, from, to, lines, why}] at `ref` (a commit; '' = the working tree), at most MAX_EXCERPTS, MAX_CHARS in all.
// `words`: what the judge asked for (a second round): searched as given, in every product and test folder, instead of the finding's own words.
export function excerptsFor(finding, {ref = '', cwd = process.cwd(), git = realGit, words: asked = null, max = MAX_EXCERPTS} = {}) {
  const show = file => { try { return (ref ? git(['show', `${ref}:${file}`], cwd) : git(['show', `HEAD:${file}`], cwd)).split('\n'); } catch { return null; } };
  const cache = new Map(), linesOf = file => (cache.has(file) ? cache.get(file) : (cache.set(file, show(file)), cache.get(file)));
  const out = [];
  let chars = 0;
  const add = (file, at, why) => {
    const lines = linesOf(file);
    if (!lines || out.length >= max) return;
    const from = Math.max(1, at - AROUND), to = Math.min(lines.length, at + AROUND);
    if (out.some(item => item.file === file && at >= item.from && at <= item.to)) return;
    const slice = lines.slice(from - 1, to).map(line => line.slice(0, 220)), size = slice.join('\n').length;
    if (chars + size > MAX_CHARS) return;
    chars += size;
    out.push({file, from, to, lines: slice, why});
  };
  const {refs, files, words} = asked ? {refs: [], files: [], words: asked} : needlesOf(finding);
  for (const item of refs) add(item.ref, item.line || 1, 'named by the finding');
  if (files.length) {   // a bare file name (sidebar-rail.js): its path in the tested build
    let all = [];
    try { all = git(['ls-tree', '-r', '--name-only', ref || 'HEAD', '--', 'desktop', 'src', 'extension'], cwd).split('\n'); } catch { /* none */ }
    for (const name of files) { const found = all.find(file => file.endsWith(`/${name}`) && !/\/test\//.test(file)); if (found) add(found, 1, 'named by the finding'); }
  }
  const paths = asked ? [...new Set([...PATHS.code, ...PATHS.suite, 'desktop/e2e'])] : pathsFor(finding);
  // A failed step's title comes from its picture's file name (punctuation lost): its first words, any punctuation between them.
  const step = finding.step ? [{pattern: finding.step.split(' ').filter(Boolean).slice(0, 6).join('[^a-zA-Z0-9]+'), flags: ['-E', '-i'], label: finding.step}] : [];
  for (const {pattern, flags, label} of [...step, ...words.map(word => ({pattern: word, flags: ['-F'], label: word}))]) {
    const word = label;
    let hits = [];
    try { hits = git(['grep', '-n', '-I', ...flags, '-e', pattern, ...(ref ? [ref] : []), '--', ...paths], cwd).split('\n').filter(Boolean); } catch { /* no match */ }
    for (const hit of hits.filter(line => !/\/test\//.test(line)).slice(0, MAX_HITS)) {
      const m = (ref ? hit.slice(ref.length + 1) : hit).match(/^([^:]+):(\d+):/);
      if (m) add(m[1], Number(m[2]), `has "${word.slice(0, 40)}"`);
    }
  }
  return out;
}
