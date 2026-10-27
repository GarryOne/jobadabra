// The code → suite map (gate G1b, 26 Oct 2026): merge a run's coverage files into it, and pick the suites a pull request's changed lines touch.
// Map: {suites: {<suite>: {sha, at, files: {<repo path>: {loaded: true, lines: [[from, to], ...]}}, steps: {<step name>: {<repo path>: {lines}}}}}}: each suite's latest
// recorded run (lib/coverage.mjs); `steps` since PR 2 of the PR-checks plan (owner, 26 Oct 2026: "just few tests/scenarios/cases from that suite"), SETUP = lines no step ran.
// Pick: a changed line inside lines a suite ran → that suite. A changed line no suite ran (a file's top level, a function never called, a CSS rule never used)
// → every suite that loaded the file: a change nobody measured runs everyone who loads it, never no one.
// Tests: test/coverage.test.mjs
import {mergeRanges, SETUP, WHOLE} from './coverage.mjs';
import {MAX_USERS} from './plan.mjs';

// Coverage files of one run (each {suite, sha, files, steps, partial, store}) laid over the previous map: a suite this run recorded whole replaces its old entry; the others keep theirs.
// A suite this run recorded only some steps of (an after-merge run, E2E_STEP_NAMES; owner's yes 26 Oct 2026: "keep it fresh after each merge") is laid over its old
// entry step by step (overlay). diff(fromSha, toSha, files) -> `git diff -U0` text, or null when it cannot (coverage-map.mjs).
export function mergeMap(previous, coverageFiles, at = new Date().toISOString(), {diff} = {}) {
  const fresh = {}, partial = {};
  for (const {suite, sha, files, steps, partial: some, store} of coverageFiles) {
    if (!suite || !files) continue;
    const entry = fresh[suite] || (fresh[suite] = {sha, at, files: {}});
    partial[suite] = (partial[suite] ?? true) && Boolean(some);   // one whole file (the whole second try) makes the suite's run whole
    unionFiles(entry.files, files);
    for (const [step, stepFiles] of Object.entries(steps || {})) {
      unionFiles((entry.steps ||= {})[step] ||= {}, stepFiles);
      if (store && step !== SETUP && step !== WHOLE) addStores((entry.stores ||= {}), step, [store]);
    }
  }
  const suites = {...(previous?.suites || {})};
  for (const [suite, entry] of Object.entries(fresh)) {
    const merged = partial[suite] ? overlay(suites[suite], entry, diff) : entry;
    if (merged) suites[suite] = merged;
  }
  return {suites};
}

// `stores`: {<step name>: [the stores it ran on]} (27 Oct 2026: a step named only on the Notion stand-in was picked for a PR run on SQLite, "not found", and the
// whole suite ran again: settings and strategy on #2156). A step with no entry ran before stores were recorded: unknown.
function addStores(into, step, stores) { into[step] = [...new Set([...(into[step] || []), ...stores])].sort(); }

function unionFiles(into, files = {}) {
  for (const [file, {lines = []}] of Object.entries(files)) into[file] = {loaded: true, lines: mergeRanges([...(into[file]?.lines || []), ...lines])};
  return into;
}

// The steps a partial run ran replace theirs; the others keep theirs, moved to the run's commit by the git diff between the two commits, so every line number of an
// entry stays on ONE commit (a PR's diff is taken from it). Launch (SETUP), import-time Python (WHOLE) and the files are unions. Left as it was, for the next
// full run to renew: no old steps (whole-suite picking stays), no diff (an unknown commit), or no old entry (a partial run must not make a suite look recorded).
function overlay(old, now, diff) {
  if (!old?.steps) return old;
  let moved = old;
  if (old.sha !== now.sha) {
    const text = diff ? diff(old.sha, now.sha, Object.keys(old.files)) : null;
    if (text == null) return old;
    moved = shiftEntry(old, lineMoves(text));
  }
  const steps = {...moved.steps}, stores = {...(old.stores || {})};
  for (const [step, files] of Object.entries(now.steps || {})) steps[step] = step === SETUP || step === WHOLE ? unionFiles({...moved.steps[step]}, files) : files;
  for (const [step, names] of Object.entries(now.stores || {})) addStores(stores, step, names);
  return {sha: now.sha, at: now.at, files: unionFiles({...moved.files}, now.files), steps, ...(Object.keys(stores).length ? {stores} : {})};
}

// `git diff -U0 --no-renames <old> <new>` → {path: [[oldStart, oldCount, newStart, newCount], ...]} (comments too: a line number moves either way); a deleted file: false.
// File headers are read only before a file's first hunk: a removed "-- note" line (SQL) prints as "--- note".
export function lineMoves(diff) {
  const out = {};
  let file = '', header = false;
  for (const line of String(diff || '').split('\n')) {
    if (line.startsWith('diff --git')) { header = true; file = ''; continue; }
    if (header && line.startsWith('--- ')) { file = line === '--- /dev/null' ? '' : line.replace(/^--- (a\/)?/, ''); continue; }
    if (header && line === '+++ /dev/null') { if (file) out[file] = false; continue; }
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    header = false;
    if (file && out[file] !== false) (out[file] ||= []).push([Number(m[1]), m[2] === undefined ? 1 : Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]);
  }
  return out;
}

// Old line ranges → new ones across a file's hunks: an unchanged line moves by the hunks above it, a changed line becomes the hunk's new lines (picking more is
// safe), a deleted line goes, inserted lines are not claimed (the after-merge run ran the steps that reach them).
export function shiftRanges(ranges, hunks) {
  const out = [], sorted = [...hunks].sort((x, y) => x[0] - y[0]);
  for (const [from, to] of ranges) {
    let at = from, delta = 0;
    for (const [a, b, c, d] of sorted) {
      const oldLast = b ? a + b - 1 : a, newLast = d ? c + d - 1 : c;   // an insertion (b 0) sits after old line a; a deletion (d 0) after new line c
      if (at > to) break;
      if (oldLast < at) { delta = newLast - oldLast; continue; }
      const first = b ? a : a + 1;
      if (first > to) break;
      if (at < first) out.push([at + delta, first - 1 + delta]);
      if (b && d) out.push([c, newLast]);
      at = Math.max(at, oldLast + 1);
      delta = newLast - oldLast;
    }
    if (at <= to) out.push([at + delta, to + delta]);
  }
  return mergeRanges(out);
}

function shiftFiles(files = {}, moves) {
  const out = {};
  for (const [file, entry] of Object.entries(files)) {
    if (moves[file] === false) continue;
    out[file] = moves[file] ? {...entry, lines: shiftRanges(entry.lines || [], moves[file])} : entry;
  }
  return out;
}
const shiftEntry = (entry, moves) => ({...entry, files: shiftFiles(entry.files, moves), steps: Object.fromEntries(Object.entries(entry.steps).map(([step, files]) => [step, shiftFiles(files, moves)]))});

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

// Each suite's own files for stepsCovering's `watched`: its `watches` as exact files (a watched folder, ending in '/', keeps the shared rule: wander's desktop/lib/),
// plus the folders it `judges` (quality: src/ai/), whose every file is its own. {suite: [paths]}, {suite: [folders]} -> {suite: [files and folders]}
export function watchedFiles(watches, judges = {}) {
  const suites = new Set([...Object.keys(watches || {}), ...Object.keys(judges || {})]);
  return Object.fromEntries([...suites].map(suite => [suite, [...(watches?.[suite] || []).filter(file => !file.endsWith('/')), ...(judges?.[suite] || [])]]));
}
const owns = (paths = [], file) => paths.some(own => (own.endsWith('/') ? file.startsWith(own) : own === file));

// The distinct commits the map was recorded on (one diff each).
export const mapShas = map => [...new Set(Object.values(map?.suites || {}).map(entry => entry.sha).filter(Boolean))];

// The STEPS a pull request's changed lines reach (PR 2 of the PR-checks plan). -> {suite: {steps: [names], setup: bool, whole: bool, reason}}:
//  - a changed line some steps ran → those steps (each suite runs its own, plus their stepNeeds and the critical setup: lib/runner.mjs);
//  - a line only launch or the gaps between steps ran (SETUP) → the setup of ONE suite that ran it (settings when it did: the same launch in every suite), unless a
//    suite already runs for this PR;
//  - a line nobody ran (a file's top level, a function never called) → every suite that loads the file, whole: a change nobody measured runs everyone who loads it;
//  - a suite recorded before steps were (no `steps`) → by its lines, whole, as suitesCovering.
// `reach`: {step: 'file:line'}, the first changed line that picked each step (the plan's reasons, lib/pick-why.mjs).
// `watched`: {suite: [files]}, the exact files each suite's `watches` names (quality: src/ai/score.py). A changed line in one is never shared code for that suite: it
// runs its own steps that ran the line (whole when none did), because no other suite judges that file (#2194's score.py lines went to failureschannels
// and settings only, and quality did not run on main; 27 Oct 2026). A watched folder (wander: desktop/lib/) keeps the shared rule; a judged folder (quality's src/ai/,
// watchedFiles) does not: every file under it is the suite's own (#2234's place_triage.py).
export function stepsCovering(map, hunksBySha, {smoke = 'settings', maxUsers = MAX_USERS, watched = {}} = {}) {
  const out = {}, setupOnly = [];
  const suites = Object.entries(map?.suites || {});
  const pick = (suite, patch, reason) => { const now = out[suite] ||= {steps: [], setup: false, whole: false, reason, reach: {}}; if (patch.step && !now.steps.includes(patch.step)) now.steps.push(patch.step); if (patch.step && patch.at) now.reach[patch.step] ||= patch.at; if (patch.setup) now.setup = true; if (patch.whole) now.whole = true; };
  const ran = (lines, range) => overlaps(lines || [], range);
  // A changed line more than `maxUsers` suites ran is shared code (the app's launch, the local server, the notifier: every suite runs it), as a helper nearly
  // every suite imports is (lib/plan.mjs MAX_USERS): ONE suite runs it, the settings smoke when it ran it (its steps that did, else its setup), else the first.
  // #2118 (app-notify.js:61) and #2119 (server.js:51) ran all 20 suites whole on 26 Oct 2026.
  // A line NO suite ran (a new import, a branch never taken) in a file more than `maxUsers` suites load: that suite's setup proves the file still loads; running
  // every loader whole would not run the line either. -> {suite, loadOnly} or null.
  const runner = (file, range) => {
    const mine = name => hunksBySha[map.suites[name].sha]?.[file];   // that suite's recorded commit has a diff for the file
    const users = suites.filter(([name, entry]) => ran(entry.files[file]?.lines, range) && mine(name)).map(([name]) => name);
    const loaders = users.length ? users : suites.filter(([name, entry]) => entry.files[file] && mine(name)).map(([name]) => name);
    if (loaders.length <= maxUsers) return null;
    return {suite: loaders.includes(smoke) ? smoke : [...loaders].sort()[0], loadOnly: !users.length};
  };
  for (const [suite, entry] of suites) {
    const hunks = hunksBySha[entry.sha] || {};
    for (const [file, ranges] of Object.entries(hunks)) {
      if (!entry.files[file]) continue;
      for (const range of ranges) {
        const shared = owns(watched[suite], file) ? null : runner(file, range);   // Why (#2212): a suite's own watched file is never shared code (quality skipped after #2194)
        if (shared && shared.suite !== suite) continue;
        if (shared?.loadOnly) { if (entry.steps) setupOnly.push({suite, key: `${file}:${range[0]}`}); else pick(suite, {whole: true}, `loads ${file} (line ${range[0]} ran in no suite)`); continue; }
        if (!entry.steps) { if (ran(entry.files[file].lines, range)) pick(suite, {whole: true}, `runs ${file}:${range[0]}`); continue; }
        if (ran(entry.steps[WHOLE]?.[file]?.lines, range)) { pick(suite, {whole: true}, `runs ${file}:${range[0]} at import or across steps`); continue; }   // Python (lib/coverage.mjs WHOLE)
        const steps = Object.entries(entry.steps).filter(([name, files]) => name !== SETUP && name !== WHOLE && ran(files[file]?.lines, range)).map(([name]) => name);
        for (const step of steps) pick(suite, {step, at: `${file}:${range[0]}`}, `runs ${file}:${range[0]} in "${step}"`);
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
export const stillWhole = (changedFiles, pointsAt, map) => Object.keys(stillWholeBy(changedFiles, pointsAt, map));
// The same, with the first file that keeps each suite whole: {suite: file}.
export function stillWholeBy(changedFiles, pointsAt, map) {
  const out = {};
  for (const file of changedFiles) for (const suite of pointsAt(file)) if (!map?.suites?.[suite]?.files?.[file]) out[suite] ||= file;
  return out;
}

// The map's suites with no step data (recorded before per-step coverage, 26 Oct 2026, and not run whole since: a run of a few steps keeps an old entry as it was):
// they can only be picked whole. pr-suites.mjs names them, so "0 picked steps" is never silent. -> [{suite, sha, at}]
export const steplessSuites = map => Object.entries(map?.suites || {}).filter(([, entry]) => !entry.steps).map(([suite, entry]) => ({suite, sha: String(entry.sha || '').slice(0, 7), at: String(entry.at || '').slice(0, 16)}));

// E2E_STEP_NAMES per suite for e2e.yml (pr_steps): a whole suite gets none; setup only: ["(setup)"].
export function stepNamesFor(picked) {
  return Object.fromEntries(Object.entries(picked).filter(([, p]) => !p.whole).map(([suite, p]) => [suite, p.steps.length ? p.steps : [SETUP]]));
}

// The store a PR runs a suite's picked steps on (e2e.yml E2E_STORE through plan-run.mjs): the one most of them were recorded on, SQLite on a tie. A step with no
// recorded store counts for both. Steps never seen on the chosen store are dropped and named (they do not exist there: the runner would fail them as "not found"
// and run the whole suite again). entry: the suite's map entry. -> {store, steps, dropped: [{step, stores}]}
export const PR_STORES = ['sqlite', 'standin'];
export function storeFor(entry, names) {
  const known = Object.fromEntries(Object.entries(entry?.stores || {}).map(([step, stores]) => [step, stores.filter(store => PR_STORES.includes(store))]));   // the real workspace (notion-real): its own pin
  const on = (step, store) => !known[step]?.length || known[step].includes(store);
  const score = store => names.filter(step => on(step, store)).length;
  const store = PR_STORES.reduce((best, next) => (score(next) > score(best) ? next : best));
  return {store, steps: names.filter(step => on(step, store)), dropped: names.filter(step => !on(step, store)).map(step => ({step, stores: known[step]}))};
}
