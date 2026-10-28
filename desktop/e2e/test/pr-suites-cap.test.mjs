// The PR suite budget keeps five strongest reaches and reports every deferred journey after merge.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as pick from '../lib/pr-suites.mjs';
import {ensureStaged} from '../lib/ensure-staged.mjs';
import {shardLegs} from '../lib/suite-shards.mjs';

// Suite imports need generated shared/ even when this test runs alone in a fresh worktree.
ensureStaged(fileURLToPath(new URL('../..', import.meta.url)));

const args = {pullRequest: true, linux: () => true};
const eight = {
  ...args, pointed: ['z-own', 'y-import', 'x-own'], direct: ['z-own', 'x-own'],
  hits: {'b-quote': ['Gone label'], 'a-quote': ['Old label']},
  covering: {'c-map': 'runs app.js:3', 'b-map': 'runs app.js:2', 'a-map': 'runs app.js:1'},
};

test('eight reached suites: own files above imports/quotes above coverage; three wait for merge', () => {
  const plan = pick.planPrSuites(eight);
  assert.deepEqual(plan.suites, ['x-own', 'z-own', 'a-quote', 'b-quote', 'y-import']);
  assert.deepEqual(plan.left, ['c-map', 'b-map', 'a-map']);
  assert.deepEqual(plan.deferred, ['a-map', 'b-map', 'c-map']);
  assert.deepEqual(pick.stepLists({suites: plan.suites, pullRequest: true}), {});
  assert.deepEqual(pick.deferredLines({left: plan.deferred, picked: Object.fromEntries(Object.entries(eight.covering).map(([s, reason]) => [s, {reason}]))}), [
    'a-map · run after merge ← runs app.js:1',
    'b-map · run after merge ← runs app.js:2',
    'c-map · run after merge ← runs app.js:3',
  ]);
  assert.equal(pick.planPrSuites({...eight, pullRequest: false}).suites.length, 8);
});

test('equal reach uses suite name independently of input order', () => {
  for (const pointed of [['f', 'e', 'd', 'c', 'b', 'a'], ['c', 'a', 'e', 'f', 'd', 'b']]) {
    assert.deepEqual(pick.planPrSuites({...args, pointed}).suites, ['a', 'b', 'c', 'd', 'e']);
  }
});

test('five suite names keep all places even when apply and applyflows expand beyond five jobs', async () => {
  const {shards: apply} = await import('../suites/apply.mjs');
  const {shards: applyflows} = await import('../suites/applyflows.mjs');
  const shards = {apply, applyflows};
  const pointed = ['settings', 'applyflows', 'jobs', 'apply', 'calendar'];
  const plan = pick.planPrSuites({...args, pointed});
  assert.deepEqual(plan, {suites: pointed, left: [], deferred: []});
  const jobs = plan.suites.flatMap(suite => shardLegs(suite, shards[suite]));
  assert.equal(jobs.length, apply + applyflows + 3);
  assert.ok(jobs.length > 5, 'the cap counts suite names, not their slice jobs');

  const six = pick.planPrSuites({...args, pointed: [...pointed, 'strategy']});
  assert.deepEqual(six, {
    suites: ['apply', 'applyflows', 'calendar', 'jobs', 'settings'],
    left: ['strategy'], deferred: ['strategy'],
  });
});

test('recorded takes no PR place and remains one suite with all slice jobs after merge', async () => {
  const {shards} = await import('../suites/recorded.mjs');
  const ordinary = ['strategy', 'settings', 'jobs', 'interviews', 'focus', 'calendar'];
  const pointed = ['recorded', ...ordinary];
  const plan = pick.planPrSuites({...args, pointed});
  assert.deepEqual(plan, {
    suites: ['calendar', 'focus', 'interviews', 'jobs', 'settings'],
    left: ['strategy'], deferred: ['strategy'],
  });
  assert.ok(!plan.suites.includes('recorded'));
  assert.ok(!plan.deferred.includes('recorded'));

  const main = pick.planPrSuites({...args, pointed, pullRequest: false});
  assert.deepEqual(main, {suites: pointed, left: [], deferred: []});
  assert.equal(main.suites.filter(suite => suite === 'recorded').length, 1);
  const jobs = main.suites.flatMap(suite => shardLegs(suite, suite === 'recorded' ? shards : undefined).map(leg => ({suite, ...leg})));
  assert.equal(jobs.filter(job => job.suite === 'recorded').length, shards);
  assert.equal(jobs.length, ordinary.length + shards);
  assert.ok(shards > 1, 'one recorded suite expands into several jobs');
});

test('optional catch counts break a reach tie, never outrank a stronger reach', () => {
  const out = pick.planPrSuites({...eight, catches: {'c-map': 1000, 'y-import': 2, 'b-quote': 1}});
  assert.deepEqual(out.suites, ['x-own', 'z-own', 'y-import', 'b-quote', 'a-quote']);
  const pointed = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(pick.planPrSuites({...args, pointed, catches: {f: 3}}).suites, ['f', 'a', 'b', 'c', 'd']);
});

test('zero through five suites preserve order and leave Mac exclusions out of deferred', () => {
  for (let n = 0; n <= 5; n++) {
    const pointed = ['e', 'd', 'c', 'b', 'a'].slice(0, n);
    assert.deepEqual(pick.planPrSuites({...args, pointed, hits: {mac: ['Old label']}, linux: s => s !== 'mac', catches: {a: 99}}), {suites: pointed, left: ['mac'], deferred: []});
  }
});

test('tolerant, suspended and retired entries never use a PR place or join the deferred backbone', () => {
  const pointed = ['tolerant', 'suspended', 'retired', 'f', 'e', 'd', 'c', 'b', 'a'];
  const lanes = {suites: Object.fromEntries(['tolerant', 'suspended', 'retired'].map(lane => [lane, {lane}]))};
  const out = pick.planPrSuites({...args, pointed, lanes});
  assert.deepEqual(out, {suites: ['a', 'b', 'c', 'd', 'e'], left: ['f'], deferred: ['f']});
  assert.deepEqual(pick.planPrSuites({...args, pointed: ['tolerant', 'b'], lanes}), {suites: ['b'], left: [], deferred: []});
  assert.deepEqual(pick.planPrSuites({...args, pullRequest: false, pointed, lanes}).suites, pointed);
});

test('planner owns the cap deferrals, excluding a Mac-only loader even after merge', () => {
  const input = {...args, covering: {
    mac: 'loads app.js (line 9 ran in no suite)',
    f: 'runs app.js:6', e: 'runs app.js:5', d: 'runs app.js:4',
    c: 'runs app.js:3', b: 'runs app.js:2', a: 'runs app.js:1',
  }, linux: suite => suite !== 'mac'};
  const plan = pick.planPrSuites(input);
  assert.deepEqual(plan.suites, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(plan.left, ['mac', 'f']);
  assert.deepEqual(plan.deferred, ['f']);
  const main = pick.planPrSuites({...input, pullRequest: false});
  assert.deepEqual(main.suites, ['f', 'e', 'd', 'c', 'b', 'a']);
  assert.deepEqual(main.left, ['mac']);
  assert.deepEqual(main.deferred, []);
});

// Reaches: ../pr-suites.mjs
// Run the real CLI with only git's read results supplied; gh is a tripwire and all output is temporary.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const cli = new URL('../pr-suites.mjs', import.meta.url);
function cliPlan({catches, pullRequest = true, listed = {}, suites = ['wizard', 'wander', 'strategy', 'settings', 'jobs', 'interviews', 'focus', 'calendar'], extraFiles = [], coverage = {}} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-cap-cli-'));
  try {
    const files = [...suites.map(s => `desktop/e2e/suites/${s}.mjs`), ...extraFiles];
    const diff = files.map(file => {
      const line = extraFiles.includes(file) ? 1 : fs.readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8').split('\n').findIndex(text => text.startsWith('import ')) + 1;
      assert.ok(line > 0, `fixture needs an import line: ${file}`);
      return `--- a/${file}\n+++ b/${file}\n@@ -${line} +${line} @@\n-old\n+new`;
    }).join('\n');
    const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (args.includes('--name-only')) console.log(${JSON.stringify(files.join('\n'))});\nelse if (args[0] === 'show') console.log(${JSON.stringify(JSON.stringify({suites: listed}))});\nelse console.log(${JSON.stringify(diff)});\n`, {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}\nthrow new Error('Network forbidden in CLI test');\n`, {mode: 0o755});
    const output = path.join(dir, 'output'), map = path.join(dir, 'map.json');
    fs.writeFileSync(map, JSON.stringify(coverage));
    const argv = [cli.pathname, '--base', 'origin/main', '--plan', '--map', map, ...(pullRequest ? ['--pull-request'] : [])];
    if (catches) { const file = path.join(dir, 'catches.json'); fs.writeFileSync(file, JSON.stringify(catches)); argv.push('--catches', file); }
    const run = spawnSync(process.execPath, argv, {encoding: 'utf8', timeout: 30000, env: {...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GITHUB_OUTPUT: output, GITHUB_REPOSITORY: ''}});
    assert.equal(run.status, 0, run.stderr);
    assert.ok(fs.existsSync(output), run.stdout + run.stderr);
    const values = Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
    return {values, text: run.stdout};
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

test('CLI writes five whole suites and three deferrals with their reasons to stdout and GITHUB_OUTPUT', () => {
  const {values, text} = cliPlan();
  assert.equal(values.suites, 'calendar,focus,interviews,jobs,settings');
  assert.equal(values.left, 'wizard,wander,strategy');
  const steps = JSON.parse(values.steps);
  assert.deepEqual(Object.keys(steps), ['(why)']);
  for (const suite of values.left.split(',')) {
    assert.match(text, new RegExp(`${suite} · run after merge ← desktop/e2e/suites/${suite}.mjs`));
    assert.ok(steps['(why)'].some(line => line.startsWith(`${suite} · run after merge ←`)));
  }
});

test('CLI reads catch counts only when supplied and applies the base registry before capping', () => {
  assert.equal(cliPlan({catches: {wizard: 99}}).values.suites, 'wizard,calendar,focus,interviews,jobs');
  const {values} = cliPlan({listed: {calendar: {lane: 'tolerant'}, focus: {lane: 'suspended'}}});
  assert.equal(values.suites, 'interviews,jobs,settings,strategy,wander');
  assert.equal(values.left, 'wizard');
  const main = cliPlan({pullRequest: false, catches: {wizard: 99}, listed: {calendar: {lane: 'tolerant'}}});
  assert.equal(main.values.suites.split(',').length, 8);
  assert.equal(main.values.left, '');
});

test('CLI labels only the capped Linux suite for merge, not the Mac-only loader', () => {
  const {values, text} = cliPlan({
    suites: ['strategy', 'settings', 'jobs', 'interviews', 'focus', 'calendar'],
    extraFiles: ['cap-fixture.js'],
    coverage: {suites: {
      strategy: {sha: 'fixture', files: {'cap-fixture.js': {loaded: true, lines: []}}, steps: {}},
      interactions: {sha: 'fixture', files: {'cap-fixture.js': {loaded: true, lines: []}}, steps: {}},
    }},
  });
  assert.equal(values.suites, 'calendar,focus,interviews,jobs,settings');
  assert.equal(values.left, 'strategy,interactions');
  assert.ok(text.includes('| `strategy` | run after merge | loads cap-fixture.js'));
  assert.ok(text.includes('| `interactions` | not in this PR run | loads cap-fixture.js'));
  assert.ok(!text.includes('| `interactions` | run after merge |'));
  const reasons = JSON.parse(values.steps)['(why)'];
  assert.deepEqual(reasons.filter(line => line.includes(' · run after merge ←')), [
    'strategy · run after merge ← desktop/e2e/suites/strategy.mjs (the suite watches or imports it, and its recorded run never loaded it)',
  ]);
});
