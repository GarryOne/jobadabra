// The code → suite map (gate G1b, 26 Oct 2026): merge a run's coverage files into it, and pick the suites a pull request's changed lines touch.
// Map: {suites: {<suite>: {sha, at, files: {<repo path>: {loaded: true, lines: [[from, to], ...]}}}}}: each suite's latest recorded run (lib/coverage.mjs).
// Pick: a changed line inside lines a suite ran → that suite. A changed line no suite ran (a file's top level, a function never called, a CSS rule never used)
// → every suite that loaded the file: a change nobody measured runs everyone who loads it, never no one.
// Tests: test/coverage.test.mjs
import {mergeRanges} from './coverage.mjs';

// Coverage files of one run (each {suite, sha, files}) laid over the previous map: a suite this run recorded replaces its old entry; the others keep theirs.
export function mergeMap(previous, coverageFiles, at = new Date().toISOString()) {
  const fresh = {};
  for (const {suite, sha, files} of coverageFiles) {
    if (!suite || !files) continue;
    const entry = fresh[suite] || (fresh[suite] = {sha, at, files: {}});
    for (const [file, {lines = []}] of Object.entries(files)) {
      const now = entry.files[file] || {loaded: true, lines: []};
      entry.files[file] = {loaded: true, lines: mergeRanges([...now.lines, ...lines])};
    }
  }
  return {suites: {...(previous?.suites || {}), ...fresh}};
}

// `git diff -U0 <from> <to>` → {path: [[from, to], ...]} on the <from> side: the lines changed or removed, and for a pure insertion the two lines around it.
export function hunksFromDiff(diff) {
  const out = {};
  let file = '';
  for (const line of String(diff || '').split('\n')) {
    if (line.startsWith('--- ')) { file = line === '--- /dev/null' ? '' : line.replace(/^--- (a\/)?/, ''); continue; }
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (!m || !file) continue;
    const start = Number(m[1]), count = m[2] === undefined ? 1 : Number(m[2]);
    (out[file] ||= []).push(count === 0 ? [start, start + 1] : [start, start + count - 1]);
  }
  return out;
}

const overlaps = (ranges, [a, b]) => ranges.some(([x, y]) => x <= b && a <= y);

// hunksBySha: {<sha>: {path: ranges}} (the diff from each suite's recorded commit to the PR's head, for the files the PR changes). → {suite: reason}
export function suitesCovering(map, hunksBySha) {
  const picked = {};
  const suites = Object.entries(map?.suites || {});
  for (const [suite, {sha, files}] of suites) {
    const hunks = hunksBySha[sha] || {};
    for (const [file, ranges] of Object.entries(hunks)) {
      const mine = files[file];
      if (!mine) continue;
      for (const range of ranges) {
        if (overlaps(mine.lines, range)) { picked[suite] ||= `runs ${file}:${range[0]}`; break; }
        // no suite ran these lines: everyone who loads the file
        const ranByAny = suites.some(([, other]) => overlaps(other.files[file]?.lines || [], range));
        if (!ranByAny) { picked[suite] ||= `loads ${file} (line ${range[0]} ran in no suite)`; break; }
      }
    }
  }
  return picked;
}

// The distinct commits the map was recorded on (one diff each).
export const mapShas = map => [...new Set(Object.values(map?.suites || {}).map(entry => entry.sha).filter(Boolean))];
