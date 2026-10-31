// The reads behind the flaky verdict (lib/flaky-verdict.mjs): recent runs' step tables, the git diff between a green's commit and the red's, the coverage map.
// Used by the gate (tools/red-main-gate.sh via tools/flaky-verdict.mjs), the Telegram alert (ci-alert.mjs) and the PR verdict (tools/pr-verdict.py); tools/suspend-flip.mjs proposes the suspension from it.
// Why (31 Oct 2026, owner: "You detect flakiness and immediately treat the flakiness root cause"): the evidence is searched by the tool on every red, from runs of every kind
// (main after-merge, nightly, beta, re-checks, PR runs), because a green on a PR head is as good a "same code passed" as one on main (trees are compared, not ancestry).
// Why (31 Oct 2026, owner: "Never suspend safety steps"; found on #2703): the red 41200878403 ran the Notion stand-in store and its "green on the same commit" 41200737331 ran sqlite,
// so the verdict said flaky for two different inputs and suspended a safety step. A green counts only from a view artifact on the red's own store (io.storesOf: per artifact, because a gate run holds
// both stores of a suite, Gitar on #2726); other-store greens are counted, not compared.
// Invariants: every read is injected (`io`), so tests never reach GitHub; a read that fails leaves that green uncomparable ("unknown"), never "changed" or "flaky". Without io.storesOf the store is not looked at.
// Not covered: Mac vs Linux (a suite moves runners only when the run sets all_on_mac; the artifacts do not record the OS); Windows lanes are keyed apart (windows-<suite>).
// Tests: test/flaky-evidence.test.mjs
// Job: report health
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {judge, stepFiles, touched} from './flaky-verdict.mjs';
import {suiteOfKey} from './suite-shards.mjs';

export const WINDOW_RUNS = 100;   // runs of e2e.yml looked at (one API page: about a day of main plus PR runs); the ones nearest the red in time are compared first
export const MAX_GREENS = 12;    // greens compared per step before "changed" is the answer
const NOT_EVIDENCE = /^(Mutant|Bisect) /;   // a mutant's green is on purpose-broken code

/**
 * Verdicts for red steps of one suite. redAt: when the red run started; greens are compared nearest in time first, on either side (a green much newer than the red may already
 * carry the fix, which would read "changed" for a red that was flaky when it happened; the nearest greens are the fair comparison). io: {runs(limit) -> [{id, sha, at, title, url}], viewNames(runId) -> [artifact name], stepsOf(runId, name) -> steps.json | null,
 * changedNames(greenSha, redSha) -> [path] | null, readAt(sha, path) -> text | null, coverageMap() -> map | null}.
 * @returns {Promise<{step: string, redSha: string, verdict: string, green?: object, files?: string[], compared: number}[]>}
 */
export async function verdictsFor({suite, steps, redSha, redRun, redAt, io, window = WINDOW_RUNS, maxGreens = MAX_GREENS}) {
  const map = await io.coverageMap().catch(() => null);
  const texts = new Map();
  const read = file => { if (!texts.has(file)) texts.set(file, io.readAt(redSha, file)); return texts.get(file); };
  const sets = Object.fromEntries(steps.map(step => [step, stepFiles({suite, step, map, read})]));
  const compared = Object.fromEntries(steps.map(step => [step, []]));
  const diffs = new Map();
  const pending = new Set(steps);
  const otherStore = Object.fromEntries(steps.map(step => [step, 0]));
  const storesOn = storeReader(io, suite);
  const redStore = io.storesOf ? soleStore(await storesOn(redRun)) : undefined;   // a red run holding several stores (a gate) does not say which one failed
  if (io.storesOf && redStore == null) return steps.map(step => ({step, redSha, verdict: 'unknown', compared: 0, uncomparable: 0, store: null, otherStore: 0}));   // nothing can be compared with an unknown store (Gitar on #2726: no 100-run scan for a sure "unknown")
  const state = {suite, io, pending, redStore, storesOn, compared, otherStore, maxGreens, sets, redSha, diffs};
  for (const run of nearestFirst(await io.runs(window), redRun, redAt)) {
    if (!pending.size) break;
    await walkRun(run, state);
  }
  return steps.map(step => resultOf(step, {redSha, compared: compared[step], files: sets[step].files, diffs, withStores: Boolean(io.storesOf), redStore, otherStore: otherStore[step]}));
}

/** The names that changed between a green's commit and the red's, read once per commit; null when they cannot be read. */
async function changedSince(sha, {diffs, io, redSha}) {
  if (!diffs.has(sha)) diffs.set(sha, await Promise.resolve(io.changedNames(sha, redSha)).catch(() => null));
  return diffs.get(sha);
}

/** Records one green of a step: the step's files that differ between it and the red (null when the two cannot be compared); a step with no difference, or enough greens, is done. */
async function compareGreen(run, step, state) {
  const changed = await changedSince(run.sha, state);
  const files = changed ? touched(changed, state.sets[step]) : null;
  state.compared[step].push({green: {sha: run.sha, run: run.id, url: run.url}, files});
  if (files?.length === 0 || state.compared[step].length >= state.maxGreens) state.pending.delete(step);
}

/** One run of the window: compare its passes on the red's store; count the ones that passed only on another store (a step with enough of them is done). */
async function walkRun(run, state) {
  const {suite, io, pending, redStore, storesOn, otherStore, maxGreens} = state;
  const {same, left} = await passesOf(run, {suite, io, pending, redStore, storesFor: io.storesOf ? () => storesOn(run.id) : null});
  for (const step of same) if (pending.has(step)) await compareGreen(run, step, state);
  for (const step of left) if (pending.has(step) && !same.has(step) && ++otherStore[step] >= maxGreens) pending.delete(step);
}

/** One step's verdict with its evidence: for flaky, how many files moved between the green and the red and how many of them the step runs (the numbers an owner issue quotes); with stores, the red's store and the greens left out for another one. */
function resultOf(step, {redSha, compared, files, diffs, withStores, redStore, otherStore}) {
  const verdict = judge(compared);
  const moved = verdict.verdict === 'flaky' ? {movedFiles: diffs.get(verdict.green.sha)?.length ?? 0, stepFileCount: files.length} : {};
  return {step, redSha, ...verdict, ...(withStores ? {store: redStore ?? null, otherStore} : {}), ...moved};
}

/** A run's stores ({artifact: store}) read once per run; a failed read is "no stores" (every store unknown). */
function storeReader(io, suite) {
  const stores = new Map();
  return id => {
    if (!stores.has(id)) stores.set(id, Promise.resolve(io.storesOf?.(id, suite)).catch(() => ({})));
    return stores.get(id);
  };
}

const passedIn = (table, step) => Boolean(table?.results?.some(result => result.name === step && result.status === 'passed'));

/** The step tables (steps.json) of a run's e2e-view artifacts for one suite, every shard and store leg, each with its artifact name; an unreadable one is left out. */
async function stepTables(run, suite, io) {
  const names = (await io.viewNames(run.id)).filter(name => name.startsWith('e2e-view-') && suiteOfKey(name.slice('e2e-view-'.length)) === suite);
  return Promise.all(names.map(async name => ({name, table: await io.stepsOf(run.id, name).catch(() => null)})));
}

/** One run's passes of the pending steps: `same` passed on the red's store (or any store when none is looked at), `left` passed only on another known store (counted, never compared; an unknown store proves nothing). */
async function passesOf(run, {suite, io, pending, redStore, storesFor}) {
  const same = new Set(), left = new Set();
  let byName = null;
  for (const {name, table} of await stepTables(run, suite, io)) {
    const passed = [...pending].filter(item => passedIn(table, item));
    if (!passed.length) continue;
    if (storesFor && !byName) byName = await storesFor();   // the stores are read only for a run where a pending step passed (Gitar on #2726)
    const store = byName ? byName[name] : undefined;
    for (const step of passed) {
      if (!byName || store === redStore) same.add(step);
      else if (store != null) left.add(step);
    }
  }
  return {same, left};
}

/** The one store a run's artifacts of a suite agree on, or null when they are unknown or differ. byName: {artifact name: store | null}. */
function soleStore(byName) {
  const found = new Set(Object.values(byName || {}));
  return found.size === 1 && !found.has(null) ? [...found][0] : null;
}

/** The runs that count as evidence (not the red itself, not a mutant), nearest the red in time first; the listed order when the red's time is unknown. */
function nearestFirst(listed, redRun, redAt) {
  const at = Date.parse(redAt || listed.find(item => String(item.id) === String(redRun))?.at || '');
  const candidates = listed.filter(item => String(item.id) !== String(redRun) && !NOT_EVIDENCE.test(item.title || ''));
  const apart = item => (item.at ? Math.abs(Date.parse(item.at) - at) : 0);
  return Number.isNaN(at) ? candidates : [...candidates].sort((a, b) => apart(a) - apart(b));
}

/**
 * Verdicts for the failed steps of a red run, from ci-alert's stepCauses ({suite, step, message}): steps never run (the suite's budget was spent before them) are
 * a consequence, not a red of their own, and get no verdict.
 */
export async function verdictsForCauses(causes, {redSha, redRun, io, ...options}) {
  const bySuite = new Map();
  for (const cause of causes.filter(item => !String(item.message).startsWith('not run: '))) {
    if (!bySuite.has(cause.suite)) bySuite.set(cause.suite, new Map());
    if (!bySuite.get(cause.suite).has(cause.step)) bySuite.get(cause.suite).set(cause.step, String(cause.message));   // the first failure text of the step, for the owner issue
  }
  const out = [];
  for (const [suite, steps] of bySuite) out.push(...(await verdictsFor({suite, steps: [...steps.keys()], redSha, redRun, io, ...options})).map(item => ({suite, message: steps.get(item.step), ...item})));
  return out;
}

const gh = (args, options = {}) => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'], ...options});

/**
 * The real reads: gh for runs and artifacts, git for trees. `root` is the checkout; a commit it lacks (a shallow CI checkout, a PR head that is no ancestor) is fetched into a
 * private bare repo, never into the checkout (a depth-1 fetch would make a full clone shallow). remoteUrl defaults to the repo's public https URL.
 */
export function ghIo({repo, root = process.cwd(), run = gh, remoteUrl = `https://github.com/${repo}.git`}) {
  const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], {encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe']});
  const scratch = {}, have = new Set();
  // kind 'trees' (no blobs: enough to compare two commits) or 'files' (blobs too: enough to read a file at a commit); one private bare repo each, removed at exit.
  const fetched = (kind, shas) => {
    if (!scratch[kind]) {
      scratch[kind] = fs.mkdtempSync(path.join(os.tmpdir(), `flaky-${kind}-`));
      git(scratch[kind], 'init', '-q', '--bare');
      process.once('exit', () => fs.rmSync(scratch[kind], {recursive: true, force: true}));
    }
    const missing = shas.filter(sha => !have.has(`${kind}:${sha}`));
    if (missing.length) git(scratch[kind], 'fetch', '-q', '--no-tags', '--depth=1', ...(kind === 'trees' ? ['--filter=blob:none'] : []), remoteUrl, ...missing);
    for (const sha of missing) have.add(`${kind}:${sha}`);
    return scratch[kind];
  };
  const download = (runId, name) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flaky-art-'));
    try { run(['run', 'download', String(runId), '-R', repo, '-n', name, '-D', dir]); return dir; } catch (error) { fs.rmSync(dir, {recursive: true, force: true}); throw error; }
  };
  const readJson = (runId, name, file) => {
    const dir = download(runId, name);
    try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  };
  const coverageStore = async (runId, name) => {
    const dir = download(runId, name);
    try {
      const file = fs.readdirSync(dir).find(item => /^coverage-.*\.json$/.test(item));
      return file ? JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).store ?? null : null;
    } catch { return null; } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  };
  return {
    runs: async limit => JSON.parse(run(['api', `repos/${repo}/actions/workflows/e2e.yml/runs?status=completed&per_page=${Math.min(limit, 100)}`, '--jq',
      '[.workflow_runs[] | {id, sha: .head_sha, at: .created_at, title: .display_title, url: .html_url}]'])),
    viewNames: async runId => run(['api', '--paginate', `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, '--jq', '.artifacts[] | select(.expired == false) | .name']).split('\n').filter(Boolean),
    stepsOf: async (runId, name) => readJson(runId, name, 'steps.json'),
    /** The store of each of a run's e2e-view artifacts of one suite: {name: store}. Its store leg (-standin, -sqlite) when the key has one (a gate run holds both stores of a suite), else the "store" its coverage artifact records ('' when the suite uses none); null when unknown. */
    storesOf: async (runId, suite) => {
      const names = run(['api', '--paginate', `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, '--jq', '.artifacts[] | select(.expired == false) | .name']).split('\n').filter(Boolean);
      const out = {};
      for (const name of names.filter(item => item.startsWith('e2e-view-') && suiteOfKey(item.slice('e2e-view-'.length)) === suite)) {
        const key = name.slice('e2e-view-'.length), leg = /-(standin|sqlite)$/.exec(key)?.[1];
        out[name] = leg || (names.includes(`e2e-coverage-${key}`) ? await coverageStore(runId, `e2e-coverage-${key}`) : null);
      }
      return out;
    },
    changedNames: async (green, red) => {
      const names = dir => git(dir, 'diff', '--name-only', '--no-renames', green, red).split('\n').filter(Boolean);
      try { return names(root); } catch {
        try { return names(fetched('trees', [green, red])); } catch { return null; }
      }
    },
    readAt: (sha, file) => {
      try { return git(root, 'show', `${sha}:${file}`); } catch { /* not in this checkout: try the snapshot */ }
      try { return git(fetched('files', [sha]), 'show', `${sha}:${file}`); } catch { return null; }
    },
    coverageMap: async () => {
      const id = run(['api', `repos/${repo}/actions/artifacts?name=e2e-coverage-map&per_page=1`, '--jq', '.artifacts[0].workflow_run.id // ""']).trim();
      return id ? readJson(id, 'e2e-coverage-map', 'coverage-map.json') : null;
    },
  };
}
