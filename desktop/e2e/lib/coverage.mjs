// Which app code a suite, and each of its steps, runs (gate G1b, owner's yes 26 Oct 2026; per step since PR 2 of the PR-checks plan): with E2E_COVERAGE=1 every app session records the window's JS functions and CSS rules it used and the
// main process's JS functions it ran, as repo lines, in <artifacts>/coverage-<suite>-<n>.json. coverage-map.mjs merges a run's files into the code → suite map that a
// pull request's plan reads (lib/coverage-pick.mjs), so a PR runs the suites that run the code it changes. Why: on 25 Oct #1911 changed menu.css and broke interactions,
// and #1913 changed the run views and broke cardstates; neither PR ran the suite. Never a reason to fail: a session that cannot record is only logged.
// Tests: test/coverage.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const on = (env = process.env) => env.E2E_COVERAGE === '1';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// file:///…/desktop/renderer/app.js?x → desktop/renderer/app.js; only the app's own files (desktop/, outside node_modules), else ''.
export function repoPath(url, root = REPO) {
  let file = '';
  try { file = url.startsWith('file:') ? fileURLToPath(url.split(/[?#]/)[0]) : url; } catch { return ''; }
  const rel = path.relative(root, file).split(path.sep).join('/');
  return rel.startsWith('desktop/') && !rel.includes('node_modules/') && !rel.startsWith('desktop/e2e/') ? rel : '';
}

export const lineStarts = text => { const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1); return starts; };
export function lineOf(starts, offset) {   // 1-based line holding this character offset
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
  return lo + 1;
}

// Line ranges, sorted and joined where they touch.
export function mergeRanges(ranges) {
  const out = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}

// A V8 entry ({functions: [{functionName, ranges: [{startOffset, endOffset, count}]}]}) → the lines of the functions it ran. The script's top level (the
// unnamed function from offset 0) ran before recording started: it only marks the file loaded. A nested range with count 0 is a branch not taken: cut out.
export function jsLines(entry, source) {
  const starts = lineStarts(source), lines = [];
  for (const fn of entry.functions || []) {
    const [outer, ...inner] = fn.ranges || [];
    if (!outer || outer.count === 0) continue;
    if (!fn.functionName && outer.startOffset === 0) continue;
    const skipped = inner.filter(range => range.count === 0).map(range => [range.startOffset, range.endOffset]);
    let at = outer.startOffset;
    for (const [s, e] of skipped.sort((x, y) => x[0] - y[0])) { if (s > at) lines.push([lineOf(starts, at), lineOf(starts, s)]); at = Math.max(at, e); }
    if (at < outer.endOffset) lines.push([lineOf(starts, at), lineOf(starts, Math.max(at, outer.endOffset - 1))]);
  }
  return mergeRanges(lines);
}

// Playwright's CSS entry ({text, ranges: [{start, end}]} = the rules used) → their lines.
export const cssLines = entry => { const starts = lineStarts(entry.text || ''); return mergeRanges((entry.ranges || []).map(r => [lineOf(starts, r.start), lineOf(starts, Math.max(r.start, r.end - 1))])); };

// Adds one session's entries into {path: {loaded: true, lines}}.
export function addEntries(files, entries, {kind, readSource = file => fs.readFileSync(file, 'utf8'), root = REPO}) {
  for (const entry of entries) {
    const rel = repoPath(entry.url || '', root);
    if (!rel) continue;
    let lines = [];
    try { lines = kind === 'css' ? cssLines(entry) : jsLines(entry, entry.source ?? readSource(path.join(root, rel))); } catch { /* unreadable: loaded only */ }
    const now = files[rel] || {loaded: true, lines: []};
    files[rel] = {loaded: true, lines: mergeRanges([...now.lines, ...lines])};
  }
  return files;
}

// The main process records through Node's inspector (Playwright's own connection to it is separate). Filtered there: only the app's files cross back.
const MAIN_START = async () => {
  const {Session} = process.getBuiltinModule('node:inspector');
  const session = new Session(); session.connect();
  const post = (method, params = {}) => new Promise((ok, fail) => session.post(method, params, (error, result) => (error ? fail(error) : ok(result))));
  await post('Profiler.enable');
  await post('Profiler.startPreciseCoverage', {callCount: true, detailed: true});
  globalThis.__e2eCoverage = post;
};
const MAIN_TAKE = async () => {
  const {result} = await globalThis.__e2eCoverage('Profiler.takePreciseCoverage');
  return result.filter(entry => /\/desktop\//.test(entry.url) && !/node_modules/.test(entry.url));
};

// CSS.takeCoverageDelta's rule usage + the sheets seen (id → {url, text}) → Playwright-shaped CSS entries ({url, text, ranges}) for addEntries.
export function cssDeltaEntries(usage, sheets) {
  const byId = {};
  for (const rule of usage || []) {
    const sheet = sheets[rule.styleSheetId];
    if (!rule.used || !sheet?.url || sheet.text == null) continue;
    (byId[rule.styleSheetId] ||= {url: sheet.url, text: sheet.text, ranges: []}).ranges.push({start: rule.startOffset, end: rule.endOffset});
  }
  return Object.values(byId);
}

// Per step (PR 2 of the PR-checks plan, owner 26 Oct 2026: "not even an entire e2e suite, but just few tests/scenarios/cases from that suite"): at each step's end
// the runner calls takeStep; each read of V8's precise coverage resets its counters, and CSS.takeCoverageDelta gives the rules used since the last read, so what one
// read returns is that step's. Lines read outside any step (launch, between steps, the close) go to SETUP. The suite's `files` stay the union (the suite pick).
export const SETUP = '(setup)';
// Python (owner's yes, 26 Oct 2026: scoring PRs ran the whole quality suite): lib/pycov/sitecustomize.py, on PYTHONPATH, records the src/ lines each engine process
// ran into E2E_PY_COVERAGE_DIR, tagged with the step named in its `step` file. Lines a process ran across steps, and lines run at import (they reach every step),
// go to WHOLE: a change there runs the suite whole (lib/coverage-pick.mjs).
export const WHOLE = '(whole)';
const PYCOV = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pycov');
// Before the app starts (lib/app.mjs): the folder, the recorder on PYTHONPATH and the step file in `env`, once per suite process. -> the folder, '' when not recording.
export function pythonCoverage(env = process.env) {
  if (!on(env)) return '';
  if (env.E2E_PY_COVERAGE_DIR) return env.E2E_PY_COVERAGE_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-pycov-'));
  fs.writeFileSync(path.join(dir, 'step'), SETUP);
  Object.assign(env, {E2E_PY_COVERAGE_DIR: dir, PYTHONPATH: [PYCOV, env.PYTHONPATH].filter(Boolean).join(path.delimiter)});
  return dir;
}
const pythonStep = (name, env) => { if (env.E2E_PY_COVERAGE_DIR) try { fs.writeFileSync(path.join(env.E2E_PY_COVERAGE_DIR, 'step'), name); } catch { /* the folder is gone: nothing to tag */ } };
// The recorder's files ({start, end, files: {path: {body, load}}}) into a session's steps.
export function pythonSteps(steps, records) {
  const into = (step, file, lines) => { if (!lines?.length) return; const target = steps[step] ||= {}; const now = target[file] || {loaded: true, lines: []}; target[file] = {loaded: true, lines: mergeRanges([...now.lines, ...lines])}; };
  for (const {start, end, files} of records) {
    const step = start !== end ? WHOLE : start || SETUP;
    for (const [file, {body = [], load = []}] of Object.entries(files || {})) { into(step, file, body); into(WHOLE, file, load); }
  }
  return steps;
}
function takePython(handle, env) {
  const dir = env.E2E_PY_COVERAGE_DIR;
  if (!dir || !fs.existsSync(dir)) return 0;
  const records = [];
  for (const name of fs.readdirSync(dir).filter(name => /^py-\d+\.json$/.test(name))) {
    try { records.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))); fs.rmSync(path.join(dir, name)); } catch { /* a file still being written: the next session's */ }
  }
  pythonSteps(handle.steps, records);
  return records.length;
}
async function windowRecorder(app, page) {
  const cdp = await page.context().newCDPSession(page);
  const sheets = {};
  cdp.on('CSS.styleSheetAdded', ({header}) => { sheets[header.styleSheetId] = {url: header.sourceURL, text: null}; });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.startPreciseCoverage', {callCount: true, detailed: true});
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  await cdp.send('CSS.startRuleUsageTracking');
  return async () => {
    const files = {};
    const {result} = await cdp.send('Profiler.takePreciseCoverage');
    addEntries(files, result, {kind: 'js'});
    const {coverage} = await cdp.send('CSS.takeCoverageDelta');
    for (const id of new Set((coverage || []).filter(rule => rule.used).map(rule => rule.styleSheetId))) {
      if (sheets[id] && sheets[id].text == null && repoPath(sheets[id].url || '')) sheets[id].text = (await cdp.send('CSS.getStyleSheetText', {styleSheetId: id}).catch(() => ({text: null}))).text;
    }
    addEntries(files, cssDeltaEntries(coverage, sheets), {kind: 'css'});
    return files;
  };
}

// One read of everything since the last one: {path: {loaded, lines}}.
async function readDelta(handle) {
  const files = {};
  const quiet = async (what, fn) => { try { await fn(); } catch (error) { console.log(`  (coverage: ${what} not read: ${error.message})`); } };
  if (handle.window) await quiet('window', async () => { for (const [file, entry] of Object.entries(await handle.window())) files[file] = entry; });
  if (handle.main) await quiet('main process', async () => addEntries(files, await handle.app.evaluate(MAIN_TAKE), {kind: 'js'}));
  return files;
}
const addInto = (into, files) => { for (const [file, {lines}] of Object.entries(files)) { const now = into[file] || {loaded: true, lines: []}; into[file] = {loaded: true, lines: mergeRanges([...now.lines, ...lines])}; } return into; };

let sessions = 0;
export async function startCoverage(app, page, env = process.env) {
  if (!on(env)) return null;
  const handle = {app, page, number: ++sessions, window: null, main: false, steps: {}};
  try { handle.window = await windowRecorder(app, page); } catch (error) { console.log(`  (no window coverage: ${error.message})`); }
  try { await app.evaluate(MAIN_START); handle.main = true; } catch (error) { console.log(`  (no main-process coverage: ${error.message})`); }
  return handle;
}

// The runner, at a step's end: what this step ran. Lines read before it (launch, the gap since the last step) go to SETUP first.
// Python processes started from here on are tagged SETUP until the next step starts.
export async function takeStep(handle, name, env = process.env) {
  pythonStep(SETUP, env);
  if (!handle || (!handle.window && !handle.main)) return;
  addInto(handle.steps[name] ||= {}, await readDelta(handle));
}
// At a step's start (`next`: its name, for the Python processes it starts).
export async function takeSetup(handle, next = SETUP, env = process.env) {
  if (handle) addInto(handle.steps[SETUP] ||= {}, await readDelta(handle));
  pythonStep(next, env);
}

// A run of some steps only (E2E_STEPS words, or E2E_STEP_NAMES: an after-merge or PR run): the map lays its steps over the old ones (lib/coverage-pick.mjs mergeMap).
function someSteps(env) {
  if (String(env.E2E_STEPS || '').trim()) return true;
  try { const names = JSON.parse(env.E2E_STEP_NAMES || '[]'); return Array.isArray(names) && names.length > 0; } catch { return false; }
}

// Before the app exits: write what this session ran, per step and in all. `dir`: the suite's artifacts.
export async function saveCoverage(handle, dir, env = process.env) {
  if (!handle) return null;
  await takeSetup(handle, SETUP, env);
  const python = takePython(handle, env);
  const files = {};
  for (const stepFiles of Object.values(handle.steps)) addInto(files, stepFiles);
  const suite = env.E2E_SUITE || 'default';
  const file = path.join(dir, `coverage-${suite}-${handle.number}.json`);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(file, JSON.stringify({suite, sha: env.E2E_COVERAGE_SHA || env.GITHUB_SHA || '', files, steps: handle.steps, partial: someSteps(env)}));   // the commit the suite ran (e2e.yml sets it to the plan's ref)
  console.log(`  coverage: ${Object.keys(files).length} app file(s), ${Object.keys(handle.steps).filter(name => name !== SETUP && name !== WHOLE).length} step(s), ${python} Python process(es) → ${path.basename(file)}`);
  return file;
}
