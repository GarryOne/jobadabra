// The service worker's lag probe (extension/sw-lag.js), played with an injected clock and timer: no Chromium, no waiting (#2608).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createLagProbe, LATE_NOTE_MS, TICK_MS} from '../../extension/sw-lag.js';

// A probe on a fake clock; `run(ms, every)` plays ticks as the worker's interval would, `stall(ms)` is a loop that ran nothing for that long.
function probe() {
  let at = 5000;
  const lines = [], ticks = [];
  const p = createLagProbe({now: () => at, onLate: fields => lines.push({...fields})});
  p.start((tick, ms) => ticks.push({tick, ms}));
  return {p, lines, ticks, advance: ms => { at += ms; }, tick() { at += TICK_MS; p.tick(); }, stall(ms) { at += ms; p.tick(); }, clock: () => at};
}

test('start schedules exactly one interval of 1 s', () => {
  const {ticks} = probe();
  assert.deepEqual(ticks.map(item => item.ms), [TICK_MS]);
});

test('ticks on time write no line, and the worst lag over a quiet stretch is 0', () => {
  const x = probe();
  for (let i = 0; i < 30; i++) x.tick();
  assert.deepEqual(x.lines, []);
  assert.equal(x.p.worstSince(5000), 0);
});

test('a tick 11 s late writes one line with its lag; the next on-time tick writes none and ends the burst', () => {
  const x = probe();
  x.tick();
  x.stall(TICK_MS + 11000);
  assert.deepEqual(x.lines, [{lagMs: 11000, burstTicks: 1}]);
  x.tick();
  assert.equal(x.lines.length, 1);
});

test('late ticks in a row count the burst; an on-time tick starts the count again', () => {
  const x = probe();
  x.stall(TICK_MS + 3000); x.stall(TICK_MS + 2500); x.stall(TICK_MS + 4000);
  assert.deepEqual(x.lines.map(line => line.burstTicks), [1, 2, 3]);
  x.tick();
  x.stall(TICK_MS + 2000);
  assert.equal(x.lines.at(-1).burstTicks, 1, 'the on-time tick ended the burst');
});

test('a tick under the 2 s line is not written, though worstSince still reports it', () => {
  const x = probe();
  x.stall(TICK_MS + LATE_NOTE_MS - 1);
  assert.deepEqual(x.lines, []);
  assert.equal(x.p.worstSince(0), LATE_NOTE_MS - 1);
});

test('jitter under 100 ms is not kept', () => {
  const x = probe();
  x.stall(TICK_MS + 99);
  assert.equal(x.p.worstSince(0), 0);
});

test('worstSince counts the tick that is overdue right now, before it has run', () => {
  const x = probe();
  x.tick();
  x.advance(12000);
  assert.equal(x.p.worstSince(0), 11000);
  assert.deepEqual(x.lines, [], 'the tick has not run, so no line yet');
});

test('worstSince counts only the part of a stall inside the window', () => {
  const x = probe();
  x.tick();
  const from = x.clock() + 4000;   // the cycle began 4 s into a stall that ends 11 s after the last tick
  x.stall(11000);
  assert.equal(x.p.worstSince(from), x.clock() - from, 'the stall began before the window: only its 7 s inside count');
  assert.equal(x.p.worstSince(x.clock() + 1), 0, 'a window that opens after the stall sees nothing');
});

test('worstSince forgets late ticks older than two minutes', () => {
  const x = probe();
  x.stall(TICK_MS + 5000);
  for (let i = 0; i < 130; i++) x.tick();
  assert.equal(x.p.worstSince(0), 0);
});

test('a probe that was never started says nothing (undefined, not 0)', () => {
  const p = createLagProbe({now: () => 1, onLate: () => assert.fail('no tick should run')});
  assert.equal(p.worstSince(0), undefined);
});

test('a worker that wakes after a long sleep starts from a fresh baseline: no lag for the time it was not running', () => {
  let at = 1000;
  const lines = [];
  const p = createLagProbe({now: () => at, onLate: fields => lines.push(fields)});
  at += 600000;   // Chrome ended the idle worker; this is the new one starting
  p.start(() => {});
  at += TICK_MS; p.tick();
  assert.deepEqual(lines, []);
  assert.equal(p.worstSince(0), 0);
});
