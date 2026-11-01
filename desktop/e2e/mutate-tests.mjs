// Runs the planted code bugs that name a test (mutants.json `test`): node mutate-tests.mjs <runs.json>. For each test file: once unplanted (its baseline), then
// once per planted bug, each written in, the test run, the file put back. Adds {[key]: {conclusion, findings: []}} to runs.json for mutation-score.mjs.
// Run by mutation.yml under a virtual display (the app-integration tests open a window). A file it cannot put back stops the run (exit 2).
// Job: report health
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {applyMutant, isTestMutant, testBaselineKey, testCommand} from './lib/mutation.mjs';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const mutants = JSON.parse(fs.readFileSync(new URL('./mutants.json', import.meta.url), 'utf8')).filter(isTestMutant);
const out = process.argv[2];
if (!out) { console.error('usage: node mutate-tests.mjs <runs.json>'); process.exit(2); }
const runs = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
// A hang guard only: the slowest app-integration file takes ~15 s on CI.
const LIMIT_MS = 5 * 60000;

/** One run of a test file -> 'success' | 'failure' | 'timed out'. */
function runTest(test) {
  const {cwd, argv} = testCommand(test);
  const done = spawnSync(argv[0], argv.slice(1), {cwd: path.join(root, cwd), encoding: 'utf8', timeout: LIMIT_MS, maxBuffer: 64 * 1024 * 1024});
  if (done.error?.code === 'ETIMEDOUT' || done.signal) return 'timed out';
  return done.status === 0 ? 'success' : 'failure';
}

for (const test of new Set(mutants.map(item => item.test))) {
  const key = testBaselineKey(test);
  runs[key] = {conclusion: runTest(test), findings: []};
  console.log(`${key}: ${runs[key].conclusion}`);
}
for (const mutant of mutants) {
  const file = path.join(root, mutant.file), before = fs.readFileSync(file, 'utf8');
  let conclusion;
  try {
    fs.writeFileSync(file, applyMutant(before, mutant));
    conclusion = runTest(mutant.test);
  } catch (error) {
    conclusion = `not run: ${error.message}`;
  } finally {
    fs.writeFileSync(file, before);
  }
  if (fs.readFileSync(file, 'utf8') !== before) { console.error(`${mutant.file} was not put back after ${mutant.id}`); process.exit(2); }
  runs[mutant.id] = {conclusion, findings: []};
  console.log(`${mutant.id} (${mutant.test}): ${conclusion}`);
}
fs.writeFileSync(out, JSON.stringify(runs, null, 2));
