// A beta retries a failed step once; safety and data steps never get that retry; every other run keeps its one try (owner, 1 Nov 2026, "Auto-retry in betas only").
// Why (1 Nov 2026, owner): "In a beta (nightly or by hand), a non-safety, non-data step that fails gets one automatic retry. If it passes, the beta releases and the notes list it.
// PR, main and night runs keep one try, so flakes are still counted and fixed. Safety and data steps get no retry." The cases: (a) retry passes in a beta, (b) fails twice,
// (c) a safety step, (d) a data step, (e) not a beta, (f) a hung step and a fault step are never retried, (g) the notes line.
// Job: report health
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRunner} from '../../lib/runner.mjs';
import {BETA_RETRY, mayRetry, passedOnRetry, retryLine, retryLog} from '../../lib/beta-retry.mjs';

process.env.E2E_RETRY_WAIT_MS = '0';   // the pause between the two tries is the runner's, not the test's subject
const WRONG = () => new Error('expected 3 cards, saw 2');   // a wrong value: not an environment failure, so only a beta retries it

async function inBeta(on, body) {
  const before = process.env[BETA_RETRY];
  if (on) process.env[BETA_RETRY] = '1'; else delete process.env[BETA_RETRY];
  try { return await body(); } finally { if (before === undefined) delete process.env[BETA_RETRY]; else process.env[BETA_RETRY] = before; }
}

// A step that throws on its first `failures` calls, then passes; returns the runner and the number of calls.
async function attempt(on, failures, options = {}) {
  return inBeta(on, async () => {
    const runner = createRunner(() => null, {keepGoing: true});
    let calls = 0;
    await runner.run('the step', async () => { calls++; if (calls <= failures) throw WRONG(); }, options);
    return {result: runner.results[0], calls};
  });
}

test('(a) in a beta, a step that fails once and then passes is passed, and the retry is recorded', async () => {
  const {result, calls} = await attempt(true, 1);
  assert.equal(calls, 2);
  assert.equal(result.status, 'passed');
  assert.match(result.retried, /expected 3 cards/);
});

test('(b) in a beta, a step that fails twice is failed: the retry is one, not a loop', async () => {
  const {result, calls} = await attempt(true, 2);
  assert.equal(calls, 2);
  assert.equal(result.status, 'failed');
});

test('(c) a safety step is never retried, in a beta too', async () => {
  const {result, calls} = await attempt(true, 1, {safety: true});
  assert.equal(calls, 1);
  assert.equal(result.status, 'failed');
  assert.equal(result.safety, true);
});

test('(d) a data step is never retried, in a beta too, and its result says it is a data step', async () => {
  const {result, calls} = await attempt(true, 1, {data: true});
  assert.equal(calls, 1);
  assert.equal(result.status, 'failed');
  assert.equal(result.data, true);
});

test('(e) outside a beta (PR, main, night, scheduled) a wrong value keeps its one try', async () => {
  const {result, calls} = await attempt(false, 1);
  assert.equal(calls, 1);
  assert.equal(result.status, 'failed');
});

test('(f) a fault-injection step and a step cut off by its hang cap are not retried, in a beta too', () => {
  const env = {[BETA_RETRY]: '1'};
  assert.equal(mayRetry({error: WRONG(), faults: true, env}), false);
  assert.equal(mayRetry({error: Object.assign(WRONG(), {stepHang: true}), env}), false);
  assert.equal(mayRetry({error: WRONG(), env}), true);
});

test('the old retry stays: an environment failure is retried once in every run, a beta or not', () => {
  assert.equal(mayRetry({error: new Error('Unexpected token \'<\', "<!DOCTYPE "...'), env: {}}), true);
  assert.equal(mayRetry({error: WRONG(), env: {}}), false);
  assert.equal(mayRetry({error: WRONG(), env: {[BETA_RETRY]: '0'}}), false);
});

test('(g) the release notes line lists each step that passed on its retry, by suite and step; nothing when none did', () => {
  const results = [{name: 'a', status: 'passed'}, {name: 'b', status: 'passed', retried: 'expected 3'}, {name: 'c', status: 'failed', retried: 'x'}];
  assert.deepEqual(passedOnRetry('jobs', results), ['jobs · b']);
  assert.equal(retryLine(['jobs · b', 'apply · c']), 'Passed on retry in this beta: jobs · b, apply · c');
  assert.equal(retryLine([]), '');
});

test('(g2) the line is read from the artifacts of every suite, a suite run on two stores is listed once, nothing when none retried', async () => {
  const {mkdtempSync, mkdirSync, writeFileSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {retryLineFor} = await import('../../passed-on-retry.mjs');
  const root = mkdtempSync(`${tmpdir()}/retry-`);
  const put = (folder, suite, results) => { mkdirSync(`${root}/${folder}`); writeFileSync(`${root}/${folder}/steps.json`, JSON.stringify({v: 1, suite, results})); };
  assert.equal(retryLineFor(root), '');
  put('e2e-artifacts-jobs', 'jobs', [{name: 'the list', status: 'passed', retried: 'expected 3'}, {name: 'other', status: 'passed'}]);
  put('e2e-artifacts-jobs-standin', 'jobs', [{name: 'the list', status: 'passed', retried: 'expected 3'}]);
  put('e2e-artifacts-focus', 'focus', [{name: 'a card', status: 'passed', retried: 'x'}]);
  assert.equal(retryLineFor(root), 'Passed on retry in this beta: focus · a card, jobs · the list');
});

test('the job log says which retry it is: an environment failure, or the beta retry of a step that failed on its own terms', async () => {
  assert.match(retryLog('a step', "Unexpected token '<'"), /the environment failed/);
  assert.match(retryLog('a step', 'expected 3 cards, saw 2'), /beta retry.*not an environment failure/);
  assert.doesNotMatch(retryLog('a step', 'expected 3 cards, saw 2'), /the environment failed/);
  const lines = [], log = console.log;
  console.log = line => lines.push(String(line));
  try { await attempt(true, 1); } finally { console.log = log; }
  assert.ok(lines.some(line => /beta retry/.test(line)) && !lines.some(line => /the environment failed/.test(line)), lines.join('\n'));
});
