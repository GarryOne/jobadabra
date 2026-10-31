// LinkedIn jobs on every Find jobs, PR 2/3: the engine's search and the registered LinkedIn step run side by side on the press's one clock. The engine's result is
// never changed or delayed by the step, a Stop or a failure of either ends both, the step's verdict is recorded once, and the light scoring runs only with time left.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {besideSteps, ownPress, setLinkedinStep, withLinkedin} from '../lib/search-beside.js';

const storage = {};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const base = (extra = {}) => ({recorded: [], scored: [], ...extra});

test('no step registered: the engine\'s steps run alone and their result is returned as it is', async () => {
  assert.deepEqual(await withLinkedin(storage, () => {}, null, async () => ({code: 0, result: 'r'}), {step: null}), {code: 0, result: 'r'});
});

test('the step starts with the engine\'s steps, not after them, and both are awaited', async () => {
  const order = [];
  const step = async () => { order.push('step start'); await wait(20); order.push('step end'); return {state: 'done', jobs: 3}; };
  const main = async () => { order.push('main start'); await wait(5); order.push('main end'); return {code: 0}; };
  const r = base();
  assert.deepEqual(await withLinkedin(storage, () => {}, null, main, {step, deadlineMs: 500, record: (_, row) => r.recorded.push(row)}), {code: 0});
  assert.deepEqual(order.slice(0, 2).sort(), ['main start', 'step start']);
  assert.deepEqual(order.slice(2), ['main end', 'step end']);
  assert.equal(r.recorded.length, 1, 'the verdict is recorded once');
  assert.equal(r.recorded[0].state, 'done');
  assert.match(r.recorded[0].at, /^\d{4}-\d\d-\d\dT/);
});

test('a step that is off writes nothing; a step that throws never fails the search', async () => {
  const r = base();
  const record = (_, row) => r.recorded.push(row);
  assert.deepEqual(await withLinkedin(storage, () => {}, null, async () => ({code: 0}), {step: async () => ({state: 'off', jobs: 0}), record}), {code: 0});
  assert.deepEqual(await withLinkedin(storage, () => {}, null, async () => ({code: 0}), {step: async () => { throw new Error('x'); }, record}), {code: 0});
  assert.deepEqual(r.recorded, []);
});

test('Stop ends the step at once; so does a failing search, which is still thrown', async () => {
  const stop = new AbortController();
  let seen = null;
  const step = async signal => { seen = signal; await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true})); return {state: 'stopped', jobs: 0}; };
  setTimeout(() => stop.abort(), 10);
  await withLinkedin(storage, () => {}, stop.signal, async () => { await wait(40); return {code: null}; }, {step, deadlineMs: 5000, record: () => {}});
  assert.equal(seen.aborted, true, 'Stop reached the step');
  await assert.rejects(withLinkedin(storage, () => {}, null, async () => { throw new Error('engine broke'); }, {step, deadlineMs: 5000, record: () => {}}), /engine broke/);
  assert.equal(seen.aborted, true, 'a failing search ends the step too');
});

test('the press\'s deadline ends the step even when the engine\'s steps take longer', async () => {
  // Why (31 Oct 2026, flaky on #2699's desktop job): the engine's end was proved with Date.now() - started >= 80 after wait(80), and a timer can fire a millisecond early against the wall clock. The order of events proves it with no clock: the step is cut first, and only then is the engine let finish.
  const order = [];
  let release;
  const engineMayFinish = new Promise(resolve => { release = resolve; });
  const step = async signal => { await new Promise(resolve => signal.addEventListener('abort', () => { order.push('step cut'); release(); resolve(); }, {once: true})); return {state: 'done', jobs: 1}; };
  await withLinkedin(storage, () => {}, null, async () => { await engineMayFinish; order.push('engine done'); return {code: 0}; }, {step, deadlineMs: 20, record: () => {}});
  assert.deepEqual(order, ['step cut', 'engine done'], 'the deadline cuts the step while the engine runs on, and the press waits for the engine');
});

test('the light scoring runs after both, for the jobs LinkedIn added, only with time left and not after a Stop', async () => {
  const r = base();
  const step = fits => async () => ({state: 'done', jobs: 8, fits});
  const run = (fits, extra = {}) => withLinkedin(storage, () => {}, extra.signal || null, async () => ({code: 0}),
    {step: step(fits), score: async n => { r.scored.push(n); }, record: () => {}, deadlineMs: 500, ...extra});
  await run(5);
  assert.deepEqual(r.scored, [5]);
  await run(0);
  assert.deepEqual(r.scored, [5], 'no jobs fit: no scoring');
  let clock = 0;
  await run(4, {now: () => (clock += 100000), budgetMs: 180000});
  assert.deepEqual(r.scored, [5], 'less than 40 s left: it waits for the next search');
  const stop = new AbortController(); stop.abort();
  await run(4, {signal: stop.signal});
  assert.deepEqual(r.scored, [5], 'stopped: not scored now');
});

test('a Stop pressed after the engine\'s steps ended, while LinkedIn is still reading, still ends it', async () => {
  const stop = new AbortController();
  let endedBy = '';
  const step = async signal => { await new Promise(resolve => { signal.addEventListener('abort', () => { endedBy = 'stop'; resolve(); }, {once: true}); setTimeout(resolve, 400); }); return {state: 'stopped', jobs: 0}; };
  setTimeout(() => stop.abort(), 30);
  const started = Date.now();
  await withLinkedin(storage, () => {}, stop.signal, async () => ({code: 0}), {step, deadlineMs: 5000, record: () => {}});
  assert.equal(endedBy, 'stop');
  assert.ok(Date.now() - started < 300, 'it did not wait for the step\'s own 400 ms');
});

test('only a person\'s own Find jobs press reads LinkedIn: not the timer, a re-score or "Find more employers" (spec: scheduling LinkedIn outside Find jobs is parked)', () => {
  assert.equal(ownPress({mode: 'run', trigger: 'you'}), true, 'the Find jobs button, Telegram\'s run, a resumed press');
  assert.equal(ownPress({mode: 'run', trigger: 'first'}), true, 'the first press on this Mac');
  assert.equal(ownPress({mode: 'scheduled', trigger: 'schedule'}), false, 'the timer: nobody at the keyboard');
  assert.equal(ownPress({mode: 'run', trigger: 'schedule'}), false);
  assert.equal(ownPress({mode: 'run', trigger: 'you', employers: true}), false, 'Find more employers');
  assert.equal(ownPress({mode: 'run', trigger: 'you', note: 'Re-scoring 75 older scores'}), false, 'a re-score');
  assert.equal(ownPress({mode: 'today', trigger: 'you'}), false, 'a light scoring run');
});

test('the search task runs the LinkedIn step for a person\'s own press and for no other run (not the timer, a re-score, Find more employers or a light run)', async () => {
  const ran = [], saved = {};
  const memory = {settings: () => saved, saveSettings: patch => Object.assign(saved, patch)};
  setLinkedinStep(async () => { ran.push('step'); return {state: 'done', jobs: 0}; });
  try {
    const presses = [[{mode: 'run', trigger: 'you'}, true], [{mode: 'run', trigger: 'first'}, true], [{mode: 'scheduled', trigger: 'schedule'}, false], [{mode: 'run', trigger: 'schedule'}, false],
      [{mode: 'run', trigger: 'you', employers: true}, false], [{mode: 'run', trigger: 'you', note: 'Re-scoring 75 older scores'}, false], [{mode: 'today', trigger: 'you'}, false]];
    for (const [press, reads] of presses) {
      ran.length = 0;
      const outcome = await besideSteps(memory, () => {}, null, press, async () => ({code: 0, result: 'r'}));
      assert.deepEqual(outcome, {code: 0, result: 'r'}, 'the engine\'s result is returned as it is');
      assert.equal(ran.length === 1, reads, `${JSON.stringify(press)} ${reads ? 'reads' : 'does not read'} LinkedIn`);
    }
  } finally { setLinkedinStep(null); }
});

test('pipeline-tasks hands the whole press (mode, trigger, employers, note) to besideSteps', () => {
  const source = fs.readFileSync(new URL('../lib/pipeline-tasks.js', import.meta.url), 'utf8');
  assert.match(source, /besideSteps\(storage, onLine, signal, \{mode, trigger, employers, note\}, steps\)/);
});
