// The reads behind the flaky verdict (lib/flaky-verdict.mjs): recent runs' step tables, the git diff between a green's commit and the red's, the coverage map.
// Used by the gate (tools/red-main-gate.sh via tools/flaky-verdict.mjs), the Telegram alert (ci-alert.mjs) and the PR verdict (tools/pr-verdict.py); tools/suspend-flip.mjs proposes the suspension from it.
// Why (31 Oct 2026, owner: "You detect flakiness and immediately treat the flakiness root cause"): the evidence is searched by the tool on every red, from runs of every kind
// (main after-merge, nightly, beta, re-checks, PR runs), because a green on a PR head is as good a "same code passed" as one on main (trees are compared, not ancestry).
// Why (31 Oct 2026, owner: "Never suspend safety steps"; found on #2703): the red 41200878403 ran the Notion stand-in store and its "green on the same commit" 41200737331 ran sqlite,
// so the verdict said flaky for two different inputs and suspended a safety step. A green counts only from a run on the red's own store (io.storeOf); other-store greens are counted, not compared.
// Invariants: every read is injected (`io`), so tests never reach GitHub; a read that fails leaves that green uncomparable ("unknown"), never "changed" or "flaky". Without io.storeOf the store is not looked at.
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
  const stores = new Map();
  const storeOn = id => { if (!stores.has(id)) stores.set(id, Promise.resolve(io.storeOf(id, suite)).catch(() => null)); return stores.get(id); };
  const redStore = io.storeOf ? await storeOn(redRun) : undefined;
  const changedSince = async sha => {
    if (!diffs.has(sha)) diffs.set(sha, await Promise.resolve(io.changedNames(sha, redSha)).catch(() => null));
    return diffs.get(sha);
  };
  const compare = async (run, step) => {
    if (io.storeOf) {
      const store = await storeOn(run.id);
      if (redStore == null || store == null) { compared[step].push({green: {sha: run.sha, run: run.id, url: run.url}, files: null}); return; }   // a store that cannot be read proves nothing
      if (store !== redStore) { if (++otherStore[step] >= maxGreens) pending.delete(step); return; }   // another store is another input: counted, never compared
    }
    const changed = await changedSince(run.sha);
    const files = changed ? touched(changed, sets[step]) : null;
    compared[step].push({green: {sha: run.sha, run: run.id, url: run.url}, files});
    if (files?.length === 0 || compared[step].length >= maxGreens) pending.delete(step);
  };
  for (const run of nearestFirst(await io.runs(window), redRun, redAt)) {
    if (!pending.size) break;
    for (const table of await stepTables(run, suite, io)) {
      for (const step of [...pending].filter(name => passedIn(table, name))) await compare(run, step);
    }
  }
  return steps.map(step => {
    const verdict = judge(compared[step]);
    // The evidence an owner issue quotes: how many files moved between the green and the red, and how many of them the step runs.
    return {step, redSha, ...verdict, ...(io.storeOf ? {store: redStore ?? null, otherStore: otherStore[step]} : {}), ...(verdict.verdict === 'flaky' ? {movedFiles: diffs.get(verdict.green.sha)?.length ?? 0, stepFileCount: sets[step].files.length} : {})};
  });
}

const passedIn = (table, step) => Boolean(table?.results?.some(result => result.name === step && result.status === 'passed'));

/** The step tables (steps.json) of a run's e2e-view artifacts for one suite, every shard; an unreadable one is left out. */
async function stepTables(run, suite, io) {
  const names = (await io.viewNames(run.id)).filter(name => name.startsWith('e2e-view-') && suiteOfKey(name.slice('e2e-view-'.length)) === suite);
  return Promise.all(names.map(name => io.stepsOf(run.id, name).catch(() => null)));
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
  return {
    runs: async limit => JSON.parse(run(['api', `repos/${repo}/actions/workflows/e2e.yml/runs?status=completed&per_page=${Math.min(limit, 100)}`, '--jq',
      '[.workflow_runs[] | {id, sha: .head_sha, at: .created_at, title: .display_title, url: .html_url}]'])),
    viewNames: async runId => run(['api', '--paginate', `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, '--jq', '.artifacts[] | select(.expired == false) | .name']).split('\n').filter(Boolean),
    stepsOf: async (runId, name) => readJson(runId, name, 'steps.json'),
    /** The store a run ran this suite on: the store leg of one of its keys (settings-standin), else the "store" its coverage artifact records ('' when the suite uses none); null when unknown. */
    storeOf: async (runId, suite) => {
      const names = run(['api', '--paginate', `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, '--jq', '.artifacts[] | select(.expired == false) | .name']).split('\n').filter(Boolean);
      const mine = names.filter(name => /^e2e-(view|coverage)-/.test(name) && suiteOfKey(name.replace(/^e2e-(view|coverage)-/, '')) === suite);
      const leg = mine.map(name => /-(standin|sqlite)(?:-\d+of\d+)?$/.exec(name)?.[1]).find(Boolean);
      if (leg) return leg;
      const coverage = mine.find(name => name.startsWith('e2e-coverage-'));
      if (!coverage) return null;
      const dir = download(runId, coverage);
      try {
        const file = fs.readdirSync(dir).find(name => /^coverage-.*\.json$/.test(name));
        return file ? JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).store ?? null : null;
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
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
