#!/usr/bin/env node
// Does a red on main stop a beta? Only a failed safety or data step does. Reads the steps.json of the red suites' e2e-view artifacts and judges them (desktop/e2e/lib/red-main-verdict.mjs).
//   node tools/red-main-verdict.mjs --repo owner/repo --run <run id>=<suite>[,<suite>…] [--run …]
//   exit 0: nothing blocks; prints "Red on main, not safety or data: <suite · step>, …" (the beta lists it in its release notes)
//   exit 1: blocks, or the results cannot be read (a missing result is never a pass); prints one "Stops the beta: <reason>" line each   exit 2: bad usage
// Used by tools/red-main-gate.sh, the one caller for the nightly (gate G2) and the beta by hand (tools/beta-release.sh). Why (1 Nov 2026, owner: "Safety strict, rest tolerant").
// Tests: tests/test_red_main_gate.py, desktop/e2e/test/red-main-verdict.test.mjs
// Job: report health
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {judgeReds} from '../desktop/e2e/lib/red-main-verdict.mjs';
import {suiteOfKey} from '../desktop/e2e/lib/suite-shards.mjs';

const gh = args => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe']});

/** The real reads: a run's non-expired artifact names, and one artifact's steps.json. */
export const ghStepsIo = repo => ({
  names: async runId => gh(['api', '--paginate', `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, '--jq', '.artifacts[] | select(.expired == false) | .name']).split('\n').filter(Boolean),
  stepsOf: async (runId, name) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'red-main-art-'));
    try {
      gh(['run', 'download', String(runId), '-R', repo, '-n', name, '-D', dir]);
      return JSON.parse(fs.readFileSync(path.join(dir, 'steps.json'), 'utf8'));
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  },
});

/** reds: [{runId, suites}] -> the verdict of judgeReds; a read that fails is carried as that suite's error, never as a pass. */
export async function verdictOfReds(reds, io) {
  const found = [];
  const namesOf = new Map();
  for (const {runId, suites} of reds) {
    for (const suite of suites) {
      try {
        if (!namesOf.has(runId)) namesOf.set(runId, await io.names(runId));
        const names = namesOf.get(runId).filter(name => name.startsWith('e2e-view-') && suiteOfKey(name.slice('e2e-view-'.length)) === suite);
        const tables = await Promise.all(names.map(async name => ({name, table: await io.stepsOf(runId, name).catch(() => null)})));   // clean-code-ok: Why (1 Nov 2026): a table that cannot be read stays null and judgeReds blocks on it, naming the artifact
        found.push({suite, runId, tables});
      } catch (error) { found.push({suite, runId, error: String(error.message || error).split('\n')[0].slice(0, 160)}); }
    }
  }
  return judgeReds(found);
}

const parseRuns = argv => argv.flatMap((arg, at) => (arg === '--run' ? [argv[at + 1] || ''] : [])).map(spec => {
  const [runId, suites] = spec.split('=');
  return /^\d+$/.test(runId || '') && suites ? {runId, suites: suites.split(',').filter(Boolean)} : null;
});

async function main(argv) {
  const reds = parseRuns(argv);
  if (!reds.length || reds.includes(null)) { console.error('usage: node tools/red-main-verdict.mjs --repo owner/repo --run <run id>=<suite>[,<suite>…] [--run …]'); return 2; }
  const repo = argv.includes('--repo') ? argv[argv.indexOf('--repo') + 1] : process.env.GITHUB_REPOSITORY || 'GarryOne/jobadabra';
  const verdict = await verdictOfReds(reds, ghStepsIo(repo));
  if (verdict.block) {
    for (const reason of verdict.reasons) console.log(`Stops the beta: ${reason}`);   // no leading spaces: desktop.yml's nightly reads the indented lines after "Main's e2e is red:" as suite names
    if (verdict.line) console.log(verdict.line);
    return 1;
  }
  console.log(verdict.line);
  return 0;
}

// Why (1 Nov 2026): real paths on both sides. A symlinked checkout or temp dir (macOS /var → /private/var) made the plain compare false, main() never ran and the tool exited 0 with no output: a silent pass.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(`red-main-verdict: ${error.message}`); process.exitCode = 1; });   // a crash blocks: unknown is never green
}
