// A suite too long for one CI job runs as slices in every gate lane (lib/suite-shards.mjs): each slice fits its budget at today's case count, the planners make one job
// per slice on both lanes, and every workflow that runs a suite passes the slice and names its job, group, caches and artifacts by key (13 Oct 2026: the beta's
// recorded suite, 95 steps in one job, stopped at 46 on Windows and 57 on Mac + Linux when its 11 minutes ran out).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {SUITES} from '../lib/context.mjs';
import {budgetMsOf} from '../lib/runner.mjs';
import {shardOf, shardTurn} from '../lib/replay-shard.mjs';
import {loadCases} from '../lib/page-replay.mjs';
import {shardLegs, suiteOfKey, windowsMatrix} from '../lib/suite-shards.mjs';
import {planRun} from '../plan-run.mjs';
import {macSuites} from '../plan-windows.mjs';
import {suiteOf} from '../triage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HEADROOM = 0.75;   // a slice may use three quarters of its budget: the cases keep coming, and a slow runner day must not cut the last ones

test('every slice of a sharded suite fits its budget on Windows (the slower lane) at today\'s case count', async () => {
  const sharded = [];
  for (const name of SUITES) {
    const suite = await import(`../suites/${name}.mjs`);
    if (!suite.shards) continue;
    sharded.push(name);
    if (suite.stepSharded) continue;   // its slices are steps (below)
    assert.ok(suite.secondsPerCaseOnWindows > 0, `${name}: say what one case takes on Windows (secondsPerCaseOnWindows), measured from a gate run`);
    const cases = loadCases(), budget = budgetMsOf(suite) / 1000;
    for (let index = 1; index <= suite.shards; index++) {
      const slice = shardOf(cases, index, suite.shards).length, seconds = slice * suite.secondsPerCaseOnWindows;
      assert.ok(seconds <= HEADROOM * budget, `${name} slice ${index}/${suite.shards}: ${slice} cases x ${suite.secondsPerCaseOnWindows} s = ${Math.round(seconds)} s, over ${HEADROOM * 100}% of its ${budget} s budget: raise ${name}'s shards (not its budget)`);
    }
  }
  assert.ok(sharded.includes('recorded'), 'the recorded replay is sharded in the gates');
});

test('a sharded suite becomes one job per slice on both lanes; the others stay one job each', async () => {
  const gh = args => (args[0] === 'run' || args[0] === 'issue' ? '[]' : args.join(' ').includes('commits/') ? 'a'.repeat(40) : '');
  const out = await planRun({env: {REPO: 'o/r', EVENT: 'gate', GATE_TAG: 'desktop-v1.0.0', TARGET_REF: 'desktop-v1.0.0', GATE_STORE_LEGS: 'one'}, gh, all: ['apply', 'jobs', 'recorded'],
    minutes: () => 15, shards: {apply: 2, recorded: 3}});
  const include = JSON.parse(out.matrix).include;
  assert.deepEqual(include.map(item => [item.suite, item.key, item.shard]), [['apply', 'apply-1of2', '1/2'], ['apply', 'apply-2of2', '2/2'], ['jobs', 'jobs', ''],
    ['recorded', 'recorded-1of3', '1/3'], ['recorded', 'recorded-2of3', '2/3'], ['recorded', 'recorded-3of3', '3/3']]);
  // Windows runs apply and the settings smoke only (lib/plan.mjs WINDOWS, the e2e audit 26 Oct 2026); a sliced one is sliced there too
  assert.deepEqual(JSON.parse(out.windows_matrix).include.map(item => item.key), ['apply-1of2', 'apply-2of2']);
  assert.equal(out.suites, 'apply,jobs,recorded');   // the suites are still named once (the summary, the Windows gate's input)
});

test('a gate with both store legs keeps them apart from the slices', async () => {
  const gh = args => (args[0] === 'run' || args[0] === 'issue' ? '[]' : args.join(' ').includes('commits/') ? 'a'.repeat(40) : '');
  const out = await planRun({env: {REPO: 'o/r', EVENT: 'gate', GATE_TAG: 'desktop-v1.0.0', TARGET_REF: 'desktop-v1.0.0'}, gh, all: ['jobs'], minutes: () => 15, shards: {jobs: 2}});
  const keys = JSON.parse(out.matrix).include.map(item => item.key);
  assert.deepEqual(keys, ['jobs-1of2', 'jobs-1of2-standin', 'jobs-2of2', 'jobs-2of2-standin']);
  for (const key of keys) assert.equal(suiteOfKey(key), 'jobs');
});

test('a job\'s key, job name or artifact folder leads back to its suite', () => {
  assert.deepEqual(shardLegs('apply'), [{key: 'apply', shard: ''}]);
  assert.equal(suiteOf('e2e-artifacts-windows-recorded-2of4'), 'recorded');
  assert.equal(suiteOf('e2e-artifacts-recorded-4of4'), 'recorded');
  assert.equal(suiteOf('e2e-artifacts-jobs-standin'), 'jobs');
  assert.deepEqual(macSuites([{name: 'recorded-1of4', conclusion: 'success'}, {name: 'recorded-2of4', conclusion: 'failure'}, {name: 'jobs', conclusion: 'success'}]), ['jobs', 'recorded']);
  assert.deepEqual(windowsMatrix(['jobs', 'recorded'], {recorded: 2}).include.map(item => item.key), ['jobs', 'recorded-1of2', 'recorded-2of2']);
});

// The class: every workflow job that runs `node suite.mjs ${{ matrix.suite }}` (e2e.yml: through its `once` function, since 26 Oct 2026). Its slice reaches the suite, and its identity (job name, group, caches, artifacts) is the key,
// so two slices never share a concurrency group (a third waiting job there is cancelled) or overwrite each other's artifacts.
test('every workflow job that runs a suite passes its slice and names everything by key', () => {
  const dir = path.join(ROOT, '.github/workflows');
  const jobs = [];
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.yml'))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const block of text.split(/\n(?=  [\w-]+:\n)/)) if (/(node suite\.mjs|once) \$\{\{ matrix\.suite \}\}/.test(block)) jobs.push({file, id: /^\s*([\w-]+):/.exec(block)[1], block});
  }
  assert.deepEqual(jobs.map(job => `${job.file}:${job.id}`).sort(), ['desktop.yml:test-mac', 'desktop.yml:test-windows', 'e2e-windows.yml:suite', 'e2e.yml:suite']);
  // Where the suite's own name is right: its file, the command that runs it, a comparison with a named suite, a step's title, the steps a PR picked for it (every slice runs them).
  const allowed = /suites\/\$\{\{ matrix\.suite \}\}\.mjs|suite\.mjs \$\{\{ matrix\.suite \}\}|again \$\{\{ matrix\.suite \}\}|once \$\{\{ matrix\.suite \}\}|\[ "\$\{\{ matrix\.suite \}\}" != quality|matrix\.suite == '|name: .*\$\{\{ matrix\.suite \}\} suite|fromJSON\(inputs\.pr_steps\)\[matrix\.suite\]/;
  for (const job of jobs) {
    assert.match(job.block, /JP_REPLAY_SHARD: \$\{\{ matrix\.shard \}\}/, `${job.file} ${job.id}: pass the slice to the suite (JP_REPLAY_SHARD: \${{ matrix.shard }})`);
    for (const line of job.block.split('\n').filter(text => text.includes('matrix.suite') && !allowed.test(text)))
      assert.fail(`${job.file} ${job.id}: name it by matrix.key, not matrix.suite (two slices would share it): ${line.trim()}`);
  }
});

test('a step-sharded suite gives every step to exactly one slice, and splits the work in near halves', () => {
  for (const count of [1, 2, 3, 4]) {
    for (let ordinal = 0; ordinal < 14; ordinal++) {
      const owners = Array.from({length: count}, (_, at) => at + 1).filter(index => shardTurn(ordinal, {index, count}));
      assert.equal(owners.length, 1, `step ${ordinal} of ${count} slices`);
    }
  }
  assert.equal(shardTurn(5, null), true, 'no slice: every step runs');
});

test('applyflows is two slices of steps whose seconds are within a third of each other (a gate run, 23 Oct 2026)', async () => {
  const suite = await import('../suites/applyflows.mjs');
  assert.equal(suite.shards, 2);
  const seconds = [26.7, 10.9, 13.5, 51.3, 23.3, 34.0, 21.9, 72.1, 41.7, 19.8, 75.5, 40];   // the 12 journey steps' seconds in that run (the 13th has none: it failed)
  const sum = index => seconds.filter((_, ordinal) => shardTurn(ordinal, {index, count: 2})).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum(1) - sum(2)) / (sum(1) + sum(2)) < 0.34, `slices ${sum(1)} vs ${sum(2)}`);
});
