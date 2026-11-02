#!/usr/bin/env node
// The journey gate (spec: docs/superpowers/specs/2026-10-10-application-journey.md, step 4): a push that touches a flow file (desktop/e2e/flows.mjs FLOW_FILES)
// runs the journey tests (JOURNEY_TESTS: the applying scenarios as event sequences, no browser, seconds) and is blocked when one fails. The area suites
// run only the tests that import a changed file, so an extension-only change never reached them. An extension change also replays the recorded
// pages (layer 2, e2e/recorded). Called by tools/pre-push-check.sh.
// Usage: node tools/journey-gate.mjs [--base origin/main]. Exit 0: passed or nothing to check; 1: a journey test failed. Guard: desktop/test/journey-gate.test.js.
import {execFileSync, spawnSync} from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function touchedFlowFiles(changed, flowFiles) {
  const flows = new Set(flowFiles);
  return changed.map(file => file.trim()).filter(file => flows.has(file) || /^desktop\/test\/(journeys|application-journey|journey-identity|extension-tab-identity)\.test\.js$/.test(file));
}

// Layer 2 (recorded pages, e2e/recorded): the local push gate opens NO browser and takes NO heavy lock (owner, 11 Oct 2026: "CI heavy, local light"): CI replays all the cases after the push
// (.github/workflows/page-cases.yml). JP_GATE_REPLAY=1 (or JP_GATE_FULL=1 / PUSH_FULL=1) replays here, every case until the affected-case map lands.
export const replayWanted = (env, touched) => touched.some(file => file.startsWith('extension/') || file.startsWith('desktop/e2e/recorded/')) && (env.JP_GATE_REPLAY === '1' || env.JP_GATE_FULL === '1' || env.PUSH_FULL === '1');
async function replay(desktop, changed) {
  const e2e = path.join(desktop, 'e2e');
  if (!fs.existsSync(path.join(e2e, 'node_modules', 'playwright-core'))) { console.log('journey gate: recorded pages skipped (no desktop/e2e/node_modules: npm ci there)'); return 0; }
  const started = Date.now();
  // `npm run recorded` takes the heavy-run lock (tools/heavy-lock.sh) and may wait for it and for a busy machine: the 6 minutes are for the replay itself.
  const waitS = process.env.JOBADABRA_HEAVY === '0' ? 0 : Number(process.env.JOBADABRA_HEAVY_WAIT || 1800) + Number(process.env.JOBADABRA_HEAVY_LOAD_WAIT || 300);
  // Only the cases the change can affect (e2e/lib/replay-select.mjs, from the measured case map); every case when a shared, flow-core or replay-tool file changed, a file is unmapped or the map is stale;
  // JP_GATE_FULL=1 / PUSH_FULL=1: all. CI replays all of them after the push.
  const {FLOW_CORE} = await import(path.join(repo, 'desktop/e2e/flows.mjs'));
  const {loadCases, REPLAY_DIR} = await import(path.join(e2e, 'lib/page-replay.mjs'));
  const {selectCases, readMap, extensionFiles} = await import(path.join(e2e, 'lib/replay-select.mjs'));
  const names = loadCases().map(item => item.name);
  const full = process.env.JP_GATE_FULL === '1' || process.env.PUSH_FULL === '1';
  const pick = full ? {all: true, why: 'the full run was asked for'} : selectCases({changed, cases: names, map: readMap(REPLAY_DIR), flowCore: FLOW_CORE, files: extensionFiles(repo)});
  if (!pick.all && !pick.names.length) { console.log(`journey gate: no recorded case to replay (${pick.why})`); return 0; }
  console.log(`journey gate: replaying ${pick.all ? `all ${names.length}` : `${pick.names.length} of ${names.length}`} recorded cases (${pick.why})`);
  const run = spawnSync('npm', ['run', '-s', 'recorded'], {cwd: e2e, encoding: 'utf8', timeout: (6 * 60 + waitS) * 1000, env: {...process.env, ...(pick.all ? {} : {JP_REPLAY_CASES: pick.names.join(',')})}});
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  if (run.status === 0) { console.log(`journey gate: recorded pages replayed in ${seconds} s`); return 0; }
  const failures = String(run.stdout || '').split('\n').filter(line => /^not ok|^# fail|^\s+[0-9]+: '/.test(line)).join('\n');
  const load = os.loadavg()[0].toFixed(0), failed = failedCases(run.stdout);
  // A case that fails in the full replay and passes alone is load-sensitive (11 Oct 2026: workday-start-dialog-1 at load 147): said as FLAKY, never a silent pass.
  if (failed.length && failed.length <= MAX_RETRIED) {
    const alone = failed.map(name => ({name, ok: spawnSync('node', ['--test', 'test/record/recorded-pages.test.mjs'], {cwd: e2e, encoding: 'utf8', timeout: 2 * 60 * 1000,
      env: {...process.env, JP_REPLAY: '1', REPLAY_ONLY: name}}).status === 0}));
    if (alone.every(r => r.ok)) { console.log(`journey gate: FLAKY under load (load average ${load}): ${failed.join(', ')} failed in the full replay and passed alone; counted as passed`); return 0; }
  }
  console.error(`journey gate: a recorded page no longer works (layer 2, load average ${load}):\n${failures}\nreproduce: cd desktop/e2e && npm run recorded`);
  return 1;
}
// The recorded cases a TAP run failed ("not ok 25 - workday-start-dialog-1: a start dialog …" gives "workday-start-dialog-1"); retried alone only when few failed.
const MAX_RETRIED = 3;
export function failedCases(stdout) {
  return [...new Set(String(stdout || '').split('\n').map(line => /^not ok \d+ - ([\w.-]+)/.exec(line)?.[1]).filter(Boolean))];
}

async function main() {
  const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'origin/main';
  let changed = [];
  try { changed = execFileSync('git', ['-C', repo, 'diff', '--name-only', `${base}..HEAD`], {encoding: 'utf8'}).split('\n').filter(Boolean); } catch { return 0; }
  const {FLOW_FILES, JOURNEY_TESTS} = await import(path.join(repo, 'desktop/e2e/flows.mjs'));
  const touched = touchedFlowFiles(changed, FLOW_FILES);
  if (!touched.length) return 0;
  const desktop = path.join(repo, 'desktop');
  if (!fs.existsSync(path.join(desktop, 'shared'))) spawnSync('node', ['scripts/stage.mjs'], {cwd: desktop, stdio: 'ignore'});   // the app's lib imports shared/
  const started = Date.now();
  const run = spawnSync('node', ['--test', ...JOURNEY_TESTS], {cwd: desktop, encoding: 'utf8'});
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (run.status === 0) {
    console.log(`journey gate: ${JOURNEY_TESTS.length} test files passed in ${seconds} s (flow files touched: ${touched.length})`);
    if (replayWanted(process.env, touched)) return replay(desktop, changed);
    if (touched.some(file => file.startsWith('extension/') || file.startsWith('desktop/e2e/recorded/'))) console.log('journey gate: recorded pages are replayed in CI after the push (page-cases.yml); JP_GATE_REPLAY=1 replays them here');
    return 0;
  }
  const failures = String(run.stdout || '').split('\n').filter(line => /^\s*not ok|^# fail/.test(line)).join('\n');   // nested subtests too: the failing scenario is named, not only its file (11 Oct 2026: a failure at load ~36 named no case)
  console.error(`journey gate: a journey scenario failed (load average ${os.loadavg()[0].toFixed(0)})  (${touched.slice(0, 5).join(', ')}${touched.length > 5 ? ', …' : ''} changed):\n${failures}\nreproduce: cd desktop && node --test ${JOURNEY_TESTS.join(' ')}`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main());
