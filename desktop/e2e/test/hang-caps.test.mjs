// Every suite that has hang caps uses the one loader table, so its caps live only in hang-caps.json.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {test} from 'node:test';
import {pollUntil} from '../lib/wait-on-state.mjs';

const suites = ['applyflows', 'failureschannels', 'interactions', 'jobs', 'personas', 'settings'];

test('every suite exports the loader table', async () => {
  const {hangCapsFor} = await import('../lib/hang-caps.mjs');
  for (const suite of suites) {
    const exported = await import(`../suites/${suite}.mjs`);
    assert.equal(exported.hangCaps, hangCapsFor(suite), suite);
  }
});

// Execute only personas' jobs callbacks, with terminal pipeline states and no app, clock or transport.
async function personaJobs(key, jobs) {
  const {hangCaps} = await import('../suites/personas.mjs');
  const source = fs.readFileSync(new URL('../suites/personas.mjs', import.meta.url), 'utf8');
  const profile = JSON.parse(fs.readFileSync(new URL(`../fixtures/personas/${key}/profile.json`, import.meta.url), 'utf8'));
  const steps = [], waits = [], clicks = [], finished = {id: 'new', kind: 'search', endedAt: 'done'};
  let phase = 0, reads = 0, clock = 0;
  const window = {__jp: {shared: {allJobs: []}}, pilot: {
    runs: async () => ({runs: reads++ ? [finished] : [], running: reads === 2 ? {kind: 'search'} : null, queued: []}),
    jobs: async () => { assert.ok(reads >= 3, 'read jobs only after the fresh search finishes'); return {jobs}; },
  }};
  const page = {
    click: async selector => { clicks.push(selector); },
    evaluate: async (fn, arg) => fn(arg),
    waitForFunction: async (fn, arg) => {
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
    ensureSetUp: async () => {}, window, hangCaps, console: {log() {}},
    pollUntil: (read, accepts, options) => pollUntil(read, accepts, {...options,
      now: () => clock, pause: async ms => { clock += ms; }}),
  });
  const stop = new Error('end of jobs callbacks');
  let failure;
  try {
    await run({page, feeds: '', needs: [], run: async (name, body) => {
      if (name.includes('Find new employers')) throw stop;
      steps.push(name);
      if (steps.length > 2) { phase++; await body(); }
    }});
  } catch (error) { if (error !== stop) failure = error; }
  return {steps, waits, clicks, failure, profile};
}

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
