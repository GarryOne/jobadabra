// The reads behind the flaky verdict (lib/flaky-verdict.mjs): recent runs' step tables, the git diff between a green's commit and the red's, the coverage map.
// Used by the gate (tools/red-main-gate.sh via tools/flaky-verdict.mjs), the Telegram alert (ci-alert.mjs) and the PR verdict (tools/pr-verdict.py); tools/suspend-flip.mjs proposes the suspension from it.
// Why (31 Oct 2026, owner: "You detect flakiness and immediately treat the flakiness root cause"): the evidence is searched by the tool on every red, from runs of every kind
// (main after-merge, nightly, beta, re-checks, PR runs), because a green on a PR head is as good a "same code passed" as one on main (trees are compared, not ancestry).
// Invariants: every read is injected (`io`), so tests never reach GitHub; a read that fails leaves that green uncomparable ("unknown"), never "changed" or "flaky".
// Tests: test/flaky-evidence.test.mjs
// Job: report health
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {judge, stepFiles, touched} from './flaky-verdict.mjs';
import {suiteOfKey} from './suite-shards.mjs';

export const WINDOW_RUNS = 40;   // runs of e2e.yml looked at, newest first (about two days of main plus PR runs)
export const MAX_GREENS = 12;    // greens compared per step before "changed" is the answer
const NOT_EVIDENCE = /^(Mutant|Bisect) /;   // a mutant's green is on purpose-broken code

/**
 * Verdicts for red steps of one suite. io: {runs(limit) -> [{id, sha, title, url}], viewNames(runId) -> [artifact name], stepsOf(runId, name) -> steps.json | null,
 * changedNames(greenSha, redSha) -> [path] | null, readAt(sha, path) -> text | null, coverageMap() -> map | null}.
 * @returns {Promise<{step: string, redSha: string, verdict: string, green?: object, files?: string[], compared: number}[]>}
 */
export async function verdictsFor({suite, steps, redSha, redRun, io, window = WINDOW_RUNS, maxGreens = MAX_GREENS}) {
  const map = await io.coverageMap().catch(() => null);
  const texts = new Map();
  const read = file => { if (!texts.has(file)) texts.set(file, io.readAt(redSha, file)); return texts.get(file); };
  const sets = Object.fromEntries(steps.map(step => [step, stepFiles({suite, step, map, read})]));
  const compared = Object.fromEntries(steps.map(step => [step, []]));
  const diffs = new Map();
  const pending = new Set(steps);
  for (const run of (await io.runs(window)).filter(item => String(item.id) !== String(redRun) && !NOT_EVIDENCE.test(item.title || ''))) {
    if (!pending.size) break;
    const names = (await io.viewNames(run.id)).filter(name => name.startsWith('e2e-view-') && suiteOfKey(name.slice('e2e-view-'.length)) === suite);
    for (const name of names) {
      const table = await io.stepsOf(run.id, name).catch(() => null);
      for (const step of [...pending]) {
        if (!table?.results?.some(result => result.name === step && result.status === 'passed')) continue;
        if (!diffs.has(run.sha)) diffs.set(run.sha, await Promise.resolve(io.changedNames(run.sha, redSha)).catch(() => null));
        const changed = diffs.get(run.sha);
        const files = changed ? touched(changed, sets[step]) : null;
        compared[step].push({green: {sha: run.sha, run: run.id, url: run.url}, files});
        if (files?.length === 0 || compared[step].length >= maxGreens) pending.delete(step);
      }
    }
  }
  return steps.map(step => {
    const verdict = judge(compared[step]);
    // The evidence an owner issue quotes: how many files moved between the green and the red, and how many of them the step runs.
    return {step, redSha, ...verdict, ...(verdict.verdict === 'flaky' ? {movedFiles: diffs.get(verdict.green.sha)?.length ?? 0, stepFileCount: sets[step].files.length} : {})};
  });
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
    runs: async limit => JSON.parse(run(['api', `repos/${repo}/actions/workflows/e2e.yml/runs?status=completed&per_page=${limit}`, '--jq',
      '[.workflow_runs[] | {id, sha: .head_sha, title: .display_title, url: .html_url}]'])),
    viewNames: async runId => run(['api', '--paginate', `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, '--jq', '.artifacts[] | select(.expired == false) | .name']).split('\n').filter(Boolean),
    stepsOf: async (runId, name) => readJson(runId, name, 'steps.json'),
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
