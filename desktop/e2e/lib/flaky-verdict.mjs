// The flaky verdict, pure: a step red on code that has not changed since it last passed is flaky (design: docs/superpowers/specs/2026-10-28-e2e-reliability-design.md,
// "Verdicts that change a state"). Which files a step runs, and whether any green of it ran on the same files; the reads (gh, git) are lib/flaky-evidence.mjs.
// Why (31 Oct 2026, owner: "How last time it didn't go red, but this time it went, without changing the code on that area. Means its flaky"; "why I need to flag this personally"):
// since row 32 no job runs twice on a commit, so "same code, different result" is read from the step's files across two runs, and the tools say it on the red.
// Invariants: a verdict errs towards "changed" (an unmapped step counts the whole desktop/ app; a computed import is not guessed); any one green with no change decides "flaky".
// Tests: test/flaky-verdict.test.mjs
// Job: report health
import path from 'node:path';
import {SETUP} from './coverage.mjs';

/** Directories the step is not mapped by: the extension and the engine are not in the coverage map (it records the desktop main process only), so they count whole. */
export const WHOLE_DIRS = ['extension/', 'src/'];
/** Harness files that wrap every suite without being imported by it. */
export const HARNESS_ROOTS = ['desktop/e2e/suite.mjs', 'desktop/e2e/lib/suite-main.mjs'];
const SHOWN = 3;

// import/export ... from './x', import './x', import('./x'): relative literals only, in source order. A computed specifier (a template) is not matched.
const IMPORT = /(?:\b(?:import|export)\s[^'"`;()]*?\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"`]+)['"]/g;

/** @returns {string[]} the relative module specifiers a source text names, in order. */
export function importsOf(source) {
  return [...String(source).matchAll(IMPORT)].map(found => found[1]);
}

function resolved(from, specifier, read) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  return [base, `${base}.mjs`, `${base}.js`, `${base}/index.mjs`, `${base}/index.js`].find(candidate => read(candidate) != null) || null;
}

/** The repo files the roots import, transitively, roots included. read(path) -> text or null (a file not in the repo is not followed). */
export function importClosure(roots, read) {
  const seen = new Set(), queue = roots.filter(file => read(file) != null);
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsOf(read(file))) {
      const next = resolved(file, specifier, read);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen].sort();
}

/**
 * The files a step runs: its suite file with the harness it imports, the app files the coverage map gives the step (and the launch, which every step runs), and
 * extension/ and src/ whole. A step the map does not know counts the whole desktop/ app: the verdict can then only say "changed" more often, never "flaky" wrongly.
 * @returns {{files: string[], dirs: string[], mapped: boolean}}
 */
export function stepFiles({suite, step, map, read}) {
  const entry = map?.suites?.[suite]?.steps;
  const mapped = Boolean(entry?.[step]);
  const app = mapped ? [...Object.keys(entry[step]), ...Object.keys(entry[SETUP] || {})] : [];
  const files = [...new Set([...importClosure([`desktop/e2e/suites/${suite}.mjs`, ...HARNESS_ROOTS], read), ...app])].sort();
  return {files, dirs: mapped ? [...WHOLE_DIRS] : ['desktop/', ...WHOLE_DIRS], mapped};
}

/** @returns {string[]} the changed names that are in the step's set: an exact file, or anything under one of its whole directories. */
export function touched(names, {files, dirs}) {
  return names.filter(name => files.includes(name) || dirs.some(dir => name.startsWith(dir)));
}

/**
 * The verdict from the greens compared, newest first: [{green: {sha, run, url}, files: the step's files that differ green..red, or null when the two could not be compared}].
 * flaky: some green with no difference; changed: every comparable green differs (the newest one's files are named); unknown: none comparable.
 */
export function judge(compared) {
  const usable = compared.filter(item => item.files);
  const same = usable.find(item => item.files.length === 0);
  if (same) return {verdict: 'flaky', green: same.green, compared: usable.length};
  if (usable.length) return {verdict: 'changed', green: usable[0].green, files: usable[0].files, compared: usable.length};
  return {verdict: 'unknown', compared: 0, uncomparable: compared.length};
}

const quoted = step => `“${String(step).length > 90 ? `${String(step).slice(0, 89)}…` : step}”`;
const short = sha => String(sha || '').slice(0, 7);

/** One line for the gate, the alert and the PR verdict. input: {step, verdict, green, files, compared, redSha, store, otherStore}. */
export function sayLine({step, verdict, green, files = [], redSha = '', store, otherStore = 0}) {
  if (verdict === 'flaky') {
    const same = green.sha === redSha ? `the same commit ${short(redSha)}` : `${short(green.sha)}, and none of its files changed up to ${short(redSha)}`;
    return `Flaky: ${quoted(step)} passed on ${same} (${green.url}): fix the non-deterministic input it depends on, not the step`;
  }
  if (verdict === 'changed') return `Changed: ${quoted(step)} differs from its newest green ${short(green.sha)} (${green.url}) in ${files.slice(0, SHOWN).join(', ')}${files.length > SHOWN ? ` +${files.length - SHOWN} more` : ''}: a likely regression`;
  const elsewhere = otherStore ? `; ${otherStore} green(s) ran another store than the red's (${store || 'none'}) and say nothing about it` : '';
  return `Unknown: ${quoted(step)} has no green to compare with in the recent runs${elsewhere}`;
}
