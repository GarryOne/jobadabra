// Measured seconds of every e2e suite part on each store leg, from the jobs of finished beta/gate runs: the data the part-headroom guard reads.
// Job: pick the suites
// Why (31 Oct 2026, a8; beta 41229992832): apply-3of3 went over its 11-minute budget on the Mac + Notion stand-in leg after months at ~5% margin. Weights and budgets came from the default
// store only (tools/e2e-step-timings.mjs skips the -standin/-sqlite artifacts), so the slowest leg was never measured. Guard: desktop/e2e/test/part-headroom.test.mjs.
//   node tools/e2e-part-times.mjs --runs <id,id,...> [--out desktop/e2e/fixtures/part-seconds.json]    (reads the jobs and artifact names of each run: about 4 gh calls per run)
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const SUITE_STEP = /^Run the .* suite/;
const JOB = /^E2E · (Mac \+ Linux|Windows) · (.+)$/;

/** 'standin' | 'sqlite' | null: the store a run used, from the suffix of its e2e-artifacts-* names (every job of a run shares one store). */
export function storeOf(artifactNames) {
  const found = new Set(artifactNames.map(name => /^e2e-artifacts-.*-(standin|sqlite)$/.exec(name)?.[1]).filter(Boolean));
  return found.size === 1 ? [...found][0] : null;
}

/** The store CI's `alternate` gives a run: bit 1 of its run number (desktop/e2e/lib/store.mjs). Only right for a run that did not pin a store. */
export const storeOfRunNumber = number => ((Number(number) >> 1) & 1 ? 'standin' : 'sqlite');

/** Jobs of one run -> [{lane, part, seconds}]: the suite step's own seconds of each `E2E · <lane> · <part>` job that ran it to an end (a step cut by the budget counts: it ran its whole budget). */
export function partRows(jobs) {
  const rows = [];
  for (const job of jobs) {
    const named = JOB.exec(job.name || '');
    const step = (job.steps || []).find(item => SUITE_STEP.test(item.name || '') && item.started_at && item.completed_at && ['success', 'failure'].includes(item.conclusion));
    if (!named || !step) continue;
    rows.push({lane: named[1], part: named[2], seconds: Math.round((Date.parse(step.completed_at) - Date.parse(step.started_at)) / 1000)});
  }
  return rows;
}

/** Rows of many runs ([{run, store, rows}]) -> {"<lane> · <part>": {standin, sqlite, unknown, max, runs}}: the slowest seconds seen per store leg. */
export function slowestByLeg(runs) {
  const table = {};
  for (const {store, rows} of runs) {
    for (const {lane, part, seconds} of rows) {
      const entry = table[`${lane} · ${part}`] ||= {runs: 0, max: 0};
      const leg = store || 'unknown';
      entry[leg] = Math.max(entry[leg] || 0, seconds);
      entry.max = Math.max(entry.max, seconds);
      entry.runs += 1;
    }
  }
  return table;
}

const gh = args => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
/** One run's jobs and store, read from GitHub. */
export function readRun(id, {repo = process.env.GITHUB_REPOSITORY || 'GarryOne/jobadabra', run = gh} = {}) {
  const jobs = run(['api', '--paginate', `repos/${repo}/actions/runs/${id}/jobs?per_page=100`, '--jq', '.jobs[] | {name, steps: [.steps[] | {name, conclusion, started_at, completed_at}]}'])
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  const names = run(['api', '--paginate', `repos/${repo}/actions/runs/${id}/artifacts?per_page=100`, '--jq', '.artifacts[].name']).split('\n').filter(Boolean);
  const number = run(['api', `repos/${repo}/actions/runs/${id}`, '--jq', '.run_number']).trim();
  return {run: id, store: storeOf(names) || storeOfRunNumber(number), runNumber: Number(number), rows: partRows(jobs)};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const arg = name => process.argv[process.argv.indexOf(name) + 1];
  const ids = String(arg('--runs') || '').split(',').filter(Boolean);
  if (!ids.length) { console.error('usage: node tools/e2e-part-times.mjs --runs <id,id,...> [--out file]'); process.exit(2); }
  const runs = ids.map(id => readRun(id));
  const result = {about: 'Slowest seconds of each e2e suite part per store leg, from finished beta/gate runs (tools/e2e-part-times.mjs).', runs: runs.map(({run, runNumber, store}) => ({run, runNumber, store})), parts: slowestByLeg(runs)};
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (process.argv.includes('--out')) fs.writeFileSync(arg('--out'), text); else process.stdout.write(text);
}
