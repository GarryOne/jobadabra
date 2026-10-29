// Reports calm main e2e step timings and measured hang caps from downloaded artifacts.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {suiteOfKey} from '../desktop/e2e/lib/suite-shards.mjs';

// Usage: node tools/e2e-step-timings.mjs --suite applyflows --runs 12 [--dir artifacts] [--json]
// Invariants: only comparable full runs and the default store count; only passed, finite, nonnegative timings count; shard totals never pool.
const ghCommand = args => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
// Mirrors tools/main_e2e_state.py NOT_MAIN_CHECK + AFTER_MERGE, plus PR runs; guarded against drift in the test.
// Partial after-merge runs are never a fallback: their totals cannot set full-run hang caps.
const comparable = title => typeof title === 'string' && title.length > 0 && !/^(Mutant|RC soak|Stable canary|Beta E2E tests|Gate|Bisect|E2E for PR|E2E after merge) /.test(title);
const artifactMatches = (name, suite) => name.startsWith('e2e-artifacts-') && !/-(standin|sqlite)$/.test(name)
  && suiteOfKey(name.slice('e2e-artifacts-'.length)) === suite;
const median = sorted => (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
const valid = step => step.status === 'passed' && (typeof step.seconds === 'number' || typeof step.seconds === 'string' && step.seconds.trim() !== '')
  && Number.isFinite(Number(step.seconds)) && Number(step.seconds) >= 0;

/** Download the newest N comparable completed main runs with this suite; inject gh to stay offline. */
export function downloadArtifacts({suite, runs, dir}, gh = ghCommand) {
  const seen = new Set();
  let downloaded = 0;
  for (let limit = runs; downloaded < runs; limit *= 2) {
    const candidates = JSON.parse(gh(['run', 'list', '--workflow', 'e2e.yml', '--branch', 'main', '--status', 'completed',
      '--limit', String(limit), '--json', 'databaseId,displayTitle']));
    for (const {databaseId, displayTitle} of candidates) {
      if (seen.has(databaseId)) continue;
      seen.add(databaseId);
      if (!comparable(displayTitle)) continue;
      const names = gh(['api', '--paginate', `repos/{owner}/{repo}/actions/runs/${databaseId}/artifacts`,
        '--jq', '.artifacts[] | select(.expired == false) | .name']).trim().split('\n');
      const matching = names.filter(name => artifactMatches(name, suite));
      if (!matching.length) continue;
      gh(['run', 'download', String(databaseId), ...matching.flatMap(name => ['--name', name]), '--dir', path.join(dir, String(databaseId))]);
      downloaded++;
      if (downloaded === runs) break;
    }
    if (candidates.length < limit) break;
  }
  if (!downloaded) throw new Error(`No downloadable artifacts for suite ${suite} on completed main runs`);
}

/** Read run/artifact/steps.json folders and pool calm passed samples by step name. */
export function measure(dir, suite) {
  const byShard = new Map(), runIds = new Set();
  for (const run of readdirSync(dir, {withFileTypes: true}).filter(entry => entry.isDirectory())) {
    for (const artifact of readdirSync(path.join(dir, run.name), {withFileTypes: true})) {
      if (!artifact.isDirectory() || !artifactMatches(artifact.name, suite)) continue;
      const file = path.join(dir, run.name, artifact.name, 'steps.json');
      let data;
      try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw new Error(`${file}: ${error.message}`);
      }
      if (!Array.isArray(data.results)) throw new Error(`${file}: results must be an array`);
      const steps = data.results.filter(valid);
      const name = artifact.name.slice('e2e-artifacts-'.length);
      if (!byShard.has(name)) byShard.set(name, []);
      byShard.get(name).push({steps, total: steps.reduce((sum, step) => sum + Number(step.seconds), 0)});
      runIds.add(run.name);
    }
  }
  if (!byShard.size) throw new Error(`No ${suite} steps.json artifacts found in ${dir}`);
  const samples = new Map(), shards = [];
  for (const [name, shardRuns] of [...byShard].sort(([a], [b]) => a.localeCompare(b))) {
    const medianTotalSeconds = median(shardRuns.map(run => run.total).sort((a, b) => a - b));
    // Why (29 Oct 2026, a8): runner-slow days must not raise hang caps; calm is <= 1.5x this shard's median total.
    const calm = shardRuns.filter(run => run.total <= 1.5 * medianTotalSeconds);
    shards.push({name, runs: shardRuns.length, calmRuns: calm.length, droppedSlowRuns: shardRuns.length - calm.length, medianTotalSeconds});
    for (const run of calm) for (const step of run.steps) {
      if (!samples.has(step.name)) samples.set(step.name, []);
      samples.get(step.name).push(Number(step.seconds));
    }
  }
  const steps = [...samples].sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => {
    values.sort((a, b) => a - b);
    const n = values.length, p95Seconds = values[Math.ceil(0.95 * n) - 1]; // Nearest-rank p95; median averages the middle pair.
    return {name, n, medianSeconds: median(values), p95Seconds, maxSeconds: values[n - 1], capSeconds: n < 5 ? null : Math.ceil(3 * p95Seconds / 5) * 5};
  });
  const shardRuns = shards.reduce((sum, shard) => sum + shard.runs, 0);
  const droppedSlowShardRuns = shards.reduce((sum, shard) => sum + shard.droppedSlowRuns, 0);
  return {suite, runs: runIds.size, shardRuns, calmShardRuns: shardRuns - droppedSlowShardRuns, droppedSlowShardRuns, shards, steps};
}

function table(report) {
  const rows = [['step', 'n', 'median (s)', 'p95 (s)', 'max (s)', 'cap (s)'], ...report.steps.map(step =>
    [step.name, String(step.n), step.medianSeconds.toFixed(2), step.p95Seconds.toFixed(2), step.maxSeconds.toFixed(2), step.capSeconds == null ? 'n too small' : String(step.capSeconds)])];
  const widths = rows[0].map((_, col) => Math.max(...rows.map(row => row[col].length)));
  return [`${report.suite}: ${report.runs} runs, ${report.calmShardRuns}/${report.shardRuns} calm shard-runs; ${report.droppedSlowShardRuns} slow shard-runs dropped`,
    'Seconds; cap = 3 x nearest-rank p95, rounded up to 5 s (at least 5 calm samples).',
    ...rows.map(row => row.map((cell, col) => cell.padEnd(widths[col])).join('  ').trimEnd())].join('\n');
}

/** Run the CLI with optional acquisition/output seams; remove only its own temporary downloads. */
export function main(args = process.argv.slice(2), {acquire = downloadArtifacts, write = text => console.log(text)} = {}) {
  const options = {runs: 12};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--json') options.json = true;
    else if (['--suite', '--runs', '--dir'].includes(flag) && args[i + 1] && !args[i + 1].startsWith('--')) options[flag.slice(2)] = args[++i];
    else throw new Error(`Unknown or incomplete argument: ${flag}`);
  }
  const {suite} = options, runs = Number(options.runs);
  if (!suite || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(suite) || !Number.isSafeInteger(runs) || runs < 1) {
    throw new Error('Usage: --suite <name> [--runs <positive integer>] [--dir <folder>] [--json]');
  }
  const temporary = !options.dir, dir = options.dir || mkdtempSync(path.join(tmpdir(), 'e2e-step-timings-'));
  try {
    if (temporary) acquire({suite, runs, dir});
    const report = measure(dir, suite);
    write(options.json ? JSON.stringify(report, null, 2) : table(report));
    return report;
  } finally {
    if (temporary) rmSync(dir, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(`e2e-step-timings: ${error.message}`); process.exitCode = 1; }
}
