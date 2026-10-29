// Shared-lib additions belong only to suites that run their steps; renamed picks cannot start an unbounded whole-suite fallback.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {SUITES} from '../lib/context.mjs';
import * as pick from '../lib/pr-suites.mjs';
import {suitesUsing} from '../lib/import-graph.mjs';
import {suitesFor} from '../lib/plan.mjs';

const root = new URL('../', import.meta.url);
const sources = Object.fromEntries(['suites', 'lib'].flatMap(dir => fs.readdirSync(new URL(`${dir}/`, root))
  .filter(name => name.endsWith('.mjs')).map(name => [`${dir}/${name}`, fs.readFileSync(new URL(`${dir}/${name}`, root), 'utf8')])));
const file = 'desktop/e2e/lib/wizard.mjs', name = 'an invalid API key is rejected without saving';

test('#2476: across the real registry, only wizard receives the new wizard step', async () => {
  const line = sources['lib/wizard.mjs'].split('\n').findIndex(text => text.includes(`ctx.run('${name}'`)) + 1;
  const touched = pick.stepsTouched(sources['lib/wizard.mjs'], [[line, line]]);
  assert.deepEqual(touched, {steps: [name], whole: false});
  const users = suitesUsing('', sources)['lib/wizard.mjs'];
  assert.ok(users.length >= 19, 'positive control: the shared lib reaches many suites');
  const own = {};
  for (const suite of users.filter(suite => SUITES.includes(suite))) {
    const {ownsStep} = await import(`../suites/${suite}.mjs`);
    const names = pick.ownedStepNames({suite, file, names: touched.steps, sources, ownsStep, map: {}});
    for (const step of names) for (const home of pick.stepHomes({}, suite, step)) (own[home] ||= []).push(step);
  }
  assert.deepEqual(Object.keys(own), ['wizard']);
  const reached = suitesFor([file], SUITES, {uses: suitesUsing('', sources)});
  const steps = pick.stepLists({suites: [...new Set([...reached, ...Object.keys(own)])], own});
  assert.deepEqual(Object.entries(steps).filter(([, names]) => names.includes(name)).map(([suite]) => suite), ['wizard']);
  assert.ok(!steps.settings?.includes(name), 'the reach smoke keeps its normal pick');
});

test('shared lib ownership retains recorded steps, respects ownsStep, and accepts new direct helper steps', () => {
  assert.equal(typeof pick.ownedStepNames, 'function');
  const input = {suite: 'jobs', file: 'desktop/e2e/lib/deep.mjs', names: ['known', 'new'], sources: {}, map: {suites: {jobs: {steps: {known: {}}}}}};
  assert.deepEqual(pick.ownedStepNames(input), ['known']);
  assert.deepEqual(pick.ownedStepNames({...input, ownsStep: () => false}), []);
  assert.deepEqual(pick.ownedStepNames({...input, sources: {'suites/jobs.mjs': "import {run} from '../lib/deep.mjs';"}}), ['known', 'new']);
});

const cli = fileURLToPath(new URL('../red-steps.mjs', import.meta.url));
test('19 stale picked suites allow only three whole-suite fallbacks, including the retry path', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'picker-fallback-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const suites = Array.from({length: 19}, (_, i) => `suite-${i}`);
  const allowed = [], blocked = [];
  for (const suite of suites) {
    const file = path.join(dir, `${suite}.json`);
    fs.writeFileSync(file, JSON.stringify([{suite, step: 'steps picked for this PR', message: 'picked step not found'}]));
    const env = {...process.env, E2E_FALLBACK_SUITES: suites.join(','), E2E_FALLBACK_SUITE: suite};
    const first = spawnSync(process.execPath, [cli, '--renamed-only', file], {env, encoding: 'utf8'});
    (first.status === 0 ? allowed : blocked).push(suite);
    if (first.status !== 0) {
      assert.match(first.stderr, /picked step not found \(fallback limit\)/);
      assert.match(fs.readFileSync(file, 'utf8'), /picked step not found \(fallback limit\)/);
      const retry = spawnSync(process.execPath, [cli, file], {env, encoding: 'utf8'});
      assert.notEqual(retry.status, 0, 'the normal retry cannot turn a blocked pick into a whole-suite run');
    }
  }
  assert.equal(allowed.length, 3);
  assert.equal(blocked.length, 16);
});

test('the workflow keeps a capped pick red on both attempts without launching a whole suite', t => {
  if (spawnSync('bash', ['--version']).error) return t.skip('requires bash');
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
  assert.match(workflow, /E2E_FALLBACK_SUITES: \$\{\{ needs\.plan\.outputs\.suites \}\}/);
  assert.match(workflow, /E2E_FALLBACK_SUITE: \$\{\{ matrix\.suite \}\}/);
  const windows = fs.readFileSync(new URL('../../../.github/workflows/e2e-windows.yml', import.meta.url), 'utf8');
  assert.match(windows, /E2E_FALLBACK_SUITES:.*needs\.plan\.outputs\.matrix/);
  assert.match(windows, /E2E_FALLBACK_SUITE: \$\{\{ matrix\.suite \}\}/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'picker-workflow-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(dir, 'suites'));
  fs.writeFileSync(path.join(dir, 'suites/suite-18.mjs'), '// Fixture suite exists.\n');
  fs.copyFileSync(cli, path.join(dir, 'red-steps.mjs'));
  fs.writeFileSync(path.join(dir, 'suite.mjs'), `import fs from 'node:fs';
    if (!process.env.E2E_STEP_NAMES) { fs.writeFileSync('whole-ran', 'yes'); process.exit(0); }
    fs.mkdirSync(process.env.E2E_ARTIFACTS, {recursive: true});
    fs.writeFileSync(process.env.E2E_ARTIFACTS + '/suite-failures.json', JSON.stringify([{suite: 'suite-18', step: 'steps picked for this PR'}]));
    process.exit(1);`);
  const env = {...process.env, RUNNER_OS: 'macOS', E2E_ARTIFACTS: path.join(dir, 'artifacts'),
    E2E_STEP_NAMES: '["missing"]', E2E_FALLBACK_SUITE: 'suite-18', E2E_AI_REPLAY: '1',
    E2E_FALLBACK_SUITES: Array.from({length: 19}, (_, i) => `suite-${i}`).join(',')};
  for (const marker of ['id: suite_run', '- name: "First try failed:']) {
    const step = workflow.slice(workflow.indexOf(marker)).split('\n      - name:')[0];
    const script = step.slice(step.indexOf('run: |\n') + 'run: |\n'.length).split('\n')
      .filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n')
      .replace(/\$\{\{ matrix\.(?:suite|key) \}\}/g, 'suite-18')
      .replace(/\$\{\{ github\.workspace \}\}/g, dir.replaceAll('\\', '/'));
    const result = spawnSync('bash', ['-e', '-c', script], {cwd: dir, env, encoding: 'utf8'});
    assert.notEqual(result.status, 0, `${marker}: the attempt stays red`);
    assert.match(result.stderr, /picked step not found \(fallback limit\)/);
    assert.equal(fs.existsSync(path.join(dir, 'whole-ran')), false, `${marker}: no whole-suite bypass`);
  }
});
