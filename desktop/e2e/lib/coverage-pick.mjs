// The code → suite map (gate G1b, 26 Oct 2026): merge a run's coverage files into it, and pick the suites a pull request's changed lines touch.
// Map: {suites: {<suite>: {sha, at, files: {<repo path>: {loaded: true, lines: [[from, to], ...]}}, steps: {<step name>: {<repo path>: {lines}}}}}}: each suite's latest
// recorded run (lib/coverage.mjs); `steps` since PR 2 of the PR-checks plan (owner, 26 Oct 2026: "just few tests/scenarios/cases from that suite"), SETUP = lines no step ran.
// Pick: a changed line inside lines a suite ran → that suite. A changed line no suite ran (a file's top level, a function never called, a CSS rule never used)
// → every suite that loaded the file: a change nobody measured runs everyone who loads it, never no one.
// Tests: test/coverage.test.mjs
import {mergeRanges, SETUP, WHOLE} from './coverage.mjs';

// Coverage files of one run (each {suite, sha, files}) laid over the previous map: a suite this run recorded replaces its old entry; the others keep theirs.
export function mergeMap(previous, coverageFiles, at = new Date().toISOString()) {
  const fresh = {};
  for (const {suite, sha, files, steps} of coverageFiles) {
    if (!suite || !files) continue;
    const entry = fresh[suite] || (fresh[suite] = {sha, at, files: {}});
    const into = (target, file, lines) => { const now = target[file] || {loaded: true, lines: []}; target[file] = {loaded: true, lines: mergeRanges([...now.lines, ...lines])}; };
    for (const [file, {lines = []}] of Object.entries(files)) into(entry.files, file, lines);
    for (const [step, stepFiles] of Object.entries(steps || {})) for (const [file, {lines = []}] of Object.entries(stepFiles)) into((entry.steps ||= {})[step] ||= {}, file, lines);
  }
  return {suites: {...(previous?.suites || {}), ...fresh}};
}

// `git diff -U0 <from> <to>` → {path: [[from, to], ...]} on the <from> side: the lines changed or removed, and for a pure insertion the two lines around it.
// A hunk whose changed lines are all comments or blank changes no behaviour: left out (#1992's header-comment edit picked 17 suites, 26 Oct 2026).
const COMMENT = /^\s*$|^\s*(\/\/|\/\*|\*|<!--|-->)/, PY_COMMENT = /^\s*(#|$)/;
export function hunksFromDiff(diff) {
  const out = {};
  let file = '', hunk = null;
  const close = () => { if (hunk && hunk.code) (out[hunk.file] ||= []).push(hunk.range); hunk = null; };
  for (const line of String(diff || '').split('\n')) {
    if (line.startsWith('diff --git')) { close(); continue; }
    if (line.startsWith('--- ')) { close(); file = line === '--- /dev/null' ? '' : line.replace(/^--- (a\/)?/, ''); continue; }
    if (line.startsWith('+++ ')) continue;
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (m) {
      close();
      if (!file) continue;
      const start = Number(m[1]), count = m[2] === undefined ? 1 : Number(m[2]);
      hunk = {file, range: count === 0 ? [start, start + 1] : [start, start + count - 1], code: false};
      continue;
    }
    if (hunk && /^[-+]/.test(line) && !(hunk.file.endsWith('.py') ? PY_COMMENT : COMMENT).test(line.slice(1))) hunk.code = true;
  }
  close();
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

// The STEPS a pull request's changed lines reach (PR 2 of the PR-checks plan). -> {suite: {steps: [names], setup: bool, whole: bool, reason}}:
//  - a changed line some steps ran → those steps (each suite runs its own, plus their stepNeeds and the critical setup: lib/runner.mjs);
//  - a line only launch or the gaps between steps ran (SETUP) → the setup of ONE suite that ran it (settings when it did: the same launch in every suite), unless a
//    suite already runs for this PR;
//  - a line nobody ran (a file's top level, a function never called) → every suite that loads the file, whole: a change nobody measured runs everyone who loads it;
//  - a suite recorded before steps were (no `steps`) → by its lines, whole, as suitesCovering.
export function stepsCovering(map, hunksBySha, {smoke = 'settings'} = {}) {
  const out = {}, setupOnly = [];
  const suites = Object.entries(map?.suites || {});
  const pick = (suite, patch, reason) => { const now = out[suite] ||= {steps: [], setup: false, whole: false, reason}; if (patch.step && !now.steps.includes(patch.step)) now.steps.push(patch.step); if (patch.setup) now.setup = true; if (patch.whole) now.whole = true; };
  const ran = (lines, range) => overlaps(lines || [], range);
  for (const [suite, entry] of suites) {
    const hunks = hunksBySha[entry.sha] || {};
    for (const [file, ranges] of Object.entries(hunks)) {
      if (!entry.files[file]) continue;
      for (const range of ranges) {
        if (!entry.steps) { if (ran(entry.files[file].lines, range)) pick(suite, {whole: true}, `runs ${file}:${range[0]}`); continue; }
        if (ran(entry.steps[WHOLE]?.[file]?.lines, range)) { pick(suite, {whole: true}, `runs ${file}:${range[0]} at import or across steps`); continue; }   // Python (lib/coverage.mjs WHOLE)
        const steps = Object.entries(entry.steps).filter(([name, files]) => name !== SETUP && name !== WHOLE && ran(files[file]?.lines, range)).map(([name]) => name);
        for (const step of steps) pick(suite, {step}, `runs ${file}:${range[0]} in "${step}"`);
        if (steps.length) continue;
        if (ran(entry.steps[SETUP]?.[file]?.lines, range)) { setupOnly.push({suite, key: `${file}:${range[0]}`}); continue; }
        const ranByAny = suites.some(([, other]) => ran(other.files[file]?.lines, range));
        if (!ranByAny) pick(suite, {whole: true}, `loads ${file} (line ${range[0]} ran in no suite)`);
      }
    }
  }
  const byKey = {};
  for (const {suite, key} of setupOnly) (byKey[key] ||= []).push(suite);
  for (const [key, candidates] of Object.entries(byKey)) {
    if (candidates.some(suite => out[suite])) continue;   // a suite that runs anyway runs its setup
    const chosen = candidates.includes(smoke) ? smoke : [...candidates].sort()[0];
    pick(chosen, {setup: true}, `runs ${key} at launch (one suite's setup)`);
  }
  return out;
}

// The suites a PR's files point at (pointsAt(file) -> suites: its own suite file, the harness, a suite's `watches`, lib/plan.mjs suitesFor) that still run whole.
// A watched file the step map recorded for that suite (the engine's Python since 26 Oct 2026) no longer does: its changed lines pick the steps (stepsCovering).
export function stillWhole(changedFiles, pointsAt, map) {
  const out = new Set();
  for (const file of changedFiles) for (const suite of pointsAt(file)) if (!map?.suites?.[suite]?.files?.[file]) out.add(suite);
  return [...out];
}

// E2E_STEP_NAMES per suite for e2e.yml (pr_steps): a whole suite gets none; setup only: ["(setup)"].
export function stepNamesFor(picked) {
  return Object.fromEntries(Object.entries(picked).filter(([, p]) => !p.whole).map(([suite, p]) => [suite, p.steps.length ? p.steps : [SETUP]]));
}
