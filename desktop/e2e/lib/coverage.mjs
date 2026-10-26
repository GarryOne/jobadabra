// Which app code a suite runs (gate G1b, owner's yes 26 Oct 2026): with E2E_COVERAGE=1 every app session records the window's JS functions and CSS rules it used and the
// main process's JS functions it ran, as repo lines, in <artifacts>/coverage-<suite>-<n>.json. coverage-map.mjs merges a run's files into the code → suite map that a
// pull request's plan reads (lib/coverage-pick.mjs), so a PR runs the suites that run the code it changes. Why: on 25 Oct #1911 changed menu.css and broke interactions,
// and #1913 changed the run views and broke cardstates; neither PR ran the suite. Never a reason to fail: a session that cannot record is only logged.
// Tests: test/coverage.test.mjs
import fs from 'node:fs';
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

let sessions = 0;
export async function startCoverage(app, page, env = process.env) {
  if (!on(env)) return null;
  const handle = {app, page, number: ++sessions, renderer: false, main: false};
  try { await page.coverage.startJSCoverage({resetOnNavigation: false}); await page.coverage.startCSSCoverage({resetOnNavigation: false}); handle.renderer = true; } catch (error) { console.log(`  (no window coverage: ${error.message})`); }
  try { await app.evaluate(MAIN_START); handle.main = true; } catch (error) { console.log(`  (no main-process coverage: ${error.message})`); }
  return handle;
}

// Before the app exits: write what this session ran. `dir`: the suite's artifacts.
export async function saveCoverage(handle, dir, env = process.env) {
  if (!handle) return null;
  const files = {};
  const quiet = async (what, fn) => { try { await fn(); } catch (error) { console.log(`  (coverage: ${what} not read: ${error.message})`); } };
  if (handle.renderer) {
    await quiet('window JS', async () => addEntries(files, await handle.page.coverage.stopJSCoverage(), {kind: 'js'}));
    await quiet('window CSS', async () => addEntries(files, await handle.page.coverage.stopCSSCoverage(), {kind: 'css'}));
  }
  if (handle.main) await quiet('main process', async () => addEntries(files, await handle.app.evaluate(MAIN_TAKE), {kind: 'js'}));
  const suite = env.E2E_SUITE || 'default';
  const file = path.join(dir, `coverage-${suite}-${handle.number}.json`);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(file, JSON.stringify({suite, sha: env.E2E_COVERAGE_SHA || env.GITHUB_SHA || '', files}));   // the commit the suite ran (e2e.yml sets it to the plan's ref)
  console.log(`  coverage: ${Object.keys(files).length} app file(s) → ${path.basename(file)}`);
  return file;
}
