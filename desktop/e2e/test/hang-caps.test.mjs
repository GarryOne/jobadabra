// Every suite that has hang caps uses the one loader table, so its caps live only in hang-caps.json.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {test} from 'node:test';
import {pollUntil} from '../lib/wait-on-state.mjs';
import {createRunner} from '../lib/runner.mjs';

const suites = ['applyflows', 'failureschannels', 'interactions', 'jobs', 'personas', 'settings'];

test('every suite exports the loader table', async () => {
  const {hangCapsFor} = await import('../lib/hang-caps.mjs');
  for (const suite of suites) {
    const exported = await import(`../suites/${suite}.mjs`);
    assert.equal(exported.hangCaps, hangCapsFor(suite), suite);
  }
});

// Execute only personas' jobs callbacks, with terminal pipeline states and no app, clock or transport.
async function personaJobs(key, jobs, {mode = 'backbone', finishAfterMs = 0} = {}) {
  const {hangCaps} = await import('../suites/personas.mjs');
  const source = fs.readFileSync(new URL('../suites/personas.mjs', import.meta.url), 'utf8');
  const profile = JSON.parse(fs.readFileSync(new URL(`../fixtures/personas/${key}/profile.json`, import.meta.url), 'utf8'));
  const steps = [], waits = [], clicks = [], options = [], pollCaps = [], browserTimeouts = [], finished = {id: 'new', kind: 'search', endedAt: 'done'};
  let phase = 0, reads = 0, clock = 0;
  const window = {__jp: {shared: {allJobs: []}}, pilot: {
    runs: async () => clock < finishAfterMs ? {runs: [], running: {kind: 'search'}, queued: []}
      : {runs: reads++ ? [finished] : [], running: reads === 2 ? {kind: 'search'} : null, queued: []},
    jobs: async () => { assert.ok(reads >= 3, 'read jobs only after the fresh search finishes'); return {jobs}; },
  }};
  const page = {
    click: async selector => { clicks.push(selector); },
    evaluate: async (fn, arg) => fn(arg),
    waitForFunction: async (fn, arg, options) => {
      browserTimeouts.push(options.timeout);
      waits.push(phase);
      for (let n = 0; n < 4; n++) {
        if (await fn(arg)) return;
        if (reads >= 3) window.__jp.shared.allJobs = jobs;
      }
      throw new Error('state wait never settled');
    },
  };
  const run = vm.runInNewContext(`${source.slice(source.indexOf('export async function run')).replace('export ', '')}\nrun`, {
    fs, path, PERSONAS: [key], personaDir: () => new URL(`../fixtures/personas/${key}/`, import.meta.url).pathname,
    ensureSetUp: async () => {}, window, hangCaps, process: {env: {E2E_AI_ANSWERS: mode}}, console: {log() {}},
    pollUntil: (read, accepts, options) => {
      pollCaps.push(options.capMs);
      return pollUntil(read, accepts, {...options, now: () => clock, pause: async ms => { clock += ms; }});
    },
  });
  const stop = new Error('end of jobs callbacks');
  let failure;
  try {
    await run({page, feeds: '', needs: [], run: async (name, body, stepOptions) => {
      if (name.includes('Find new employers')) throw stop;
      steps.push(name);
      options.push(stepOptions);
      if (steps.length > 2) { phase++; await body(); }
    }});
  } catch (error) { if (error !== stop) failure = error; }
  return {steps, waits, clicks, options, pollCaps, browserTimeouts, failure, profile};
}

// A recording must survive the old 90-second boundary at the runner and both state waits.
for (const mode of ['backbone', 'record', 'off']) test(`personas ${mode}: only recording removes the jobs-check cap`, async t => {
  const {hangCaps} = await import('../suites/personas.mjs');
  const result = await personaJobs('austin', [{title: 'Data Analyst', fit: 80}], {mode, finishAfterMs: 95000});
  const recording = mode === 'record', name = result.steps[3];
  assert.equal(hangCaps[name], 90, 'the shared backbone measurement is unchanged');
  if (recording) {
    assert.equal(result.failure, undefined, 'a recording waits beyond 90 seconds for completion');
    assert.deepEqual(result.pollCaps, [Infinity]);
    assert.deepEqual(result.browserTimeouts, [0]);
  } else {
    assert.match(result.failure?.message || '', /the jobs check never finished/);
    assert.deepEqual(result.pollCaps, [90000]);
  }
  t.mock.method(console, 'log', () => {});
  t.mock.timers.enable({apis: ['setTimeout']});
  const runner = createRunner(() => null, {keepGoing: true, hangCaps, budgetMs: 15 * 60000});
  let enter, finish;
  const entered = new Promise(resolve => { enter = resolve; });
  const pending = runner.run(name, () => { enter(); return new Promise(resolve => { finish = resolve; }); }, result.options[3]);
  await entered;
  t.mock.timers.tick(90000);
  await new Promise(setImmediate);
  assert.equal(runner.results.length, recording ? 0 : 1);
  if (recording) finish();
  await pending;
  assert.equal(runner.results[0].status, recording ? 'passed' : 'failed');
});

for (const key of ['austin', 'sao_paulo']) test(`personas ${key}: start, completion and original result assertions are separate capped steps`, async () => {
  const {hangCaps} = await import('../suites/personas.mjs');
  const profile = JSON.parse(fs.readFileSync(new URL(`../fixtures/personas/${key}/profile.json`, import.meta.url), 'utf8'));
  const result = await personaJobs(key, [{title: profile.roles[0], fit: 80}]);
  assert.equal(result.failure, undefined);
  assert.equal(result.steps.length, 5, 'two preparation steps, then three jobs steps');
  assert.deepEqual(result.steps.slice(2), [
    `${profile.name}: starts a jobs check`,
    `${profile.name}: the jobs check finishes and its results reach the Jobs list`,
    `${profile.name}: a jobs check keeps the roles in their places and drops the wrong ones`,
  ]);
  assert.deepEqual(result.clicks, ['.nav[data-view="jobs"]', '#refresh']);
  assert.ok(result.waits.every(phase => phase === 2), 'only the completion step waits');
  for (const name of result.steps.slice(2)) assert.ok(hangCaps[name] >= 30 && hangCaps[name] <= 90, name);
});

test('personas: a finished search with no scores fails its original requirement without waiting out the suite', async () => {
  const result = await personaJobs('austin', [{title: 'Data Analyst', fit: null}]);
  assert.match(result.failure?.message || '', /no matching role was kept and scored/);
  assert.equal(result.steps.length, 5);
  assert.ok(result.waits.every(phase => phase === 2));
});

test('personas: scored matches do not hide a wrongly kept role', async () => {
  const result = await personaJobs('austin', [{title: 'Data Analyst', fit: 80}, {title: 'Account Executive', fit: 60}]);
  assert.match(result.failure?.message || '', /jobs for the wrong role were kept: Account Executive/);
});

test('personas: splitting jobs keeps one selected persona and the original aggregate budget', async () => {
  const suite = await import('../suites/personas.mjs');
  const {stepCalls} = await import('../lib/pr-suites.mjs');
  const source = fs.readFileSync(new URL('../suites/personas.mjs', import.meta.url), 'utf8');
  assert.equal(stepCalls(source).length, 8);
  assert.match(source, /const PERSONAS = \[pickPersona\(\)\];/);
  for (const key of ['austin', 'sao_paulo']) assert.equal(suite.pickPersona({E2E_PERSONA: key}), key);
  assert.equal(suite.minutes, 15);
  assert.equal(suite.budgetMinutes, undefined);
  assert.equal(suite.aggregateBudget, undefined);
});

test('personas: a manual workflow can select either persona without changing another suite', () => {
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
  const input = workflow.split('      persona:')[1]?.split('      pr_suites:')[0];
  assert.ok(input, 'the dispatch needs an explicit persona input');
  assert.match(input, /options: \[alternate, austin, sao_paulo\]/);
  assert.match(input, /default: alternate/);
  assert.ok(workflow.includes("E2E_PERSONA: ${{ matrix.suite == 'personas' && inputs.persona || '' }}"));
});
