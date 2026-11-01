// A Stop press is judged by what the panel shows, never by whether the click call returned in time; the budget is spent on an injected clock (pure: a fake page, no Chromium).
// Why (1 Nov 2026, a8; harness run 41265375751 on #2766, which reaches none of these files, so flaky): the panel read `Stopping… (disabled)` (the press landed) while
// the click call had timed out on a loaded runner, and the press was judged "never pressable". 5 patches (#2746) had tuned the click's clock; the verdict now comes from the panel.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pressStop} from '../lib/panel-stop.mjs';

const idle = {busy: true, overlay: true, cardHidden: false, stoppedShown: false, stopButtons: ['Stop', 'Stop'], panelClass: 'jp working'};
const pressed = {...idle, stopButtons: ['Stopping… (disabled)', 'Stop']};
const halted = {busy: false, overlay: false, cardHidden: false, stoppedShown: true, stopButtons: ['Stopping… (disabled)', 'Stop'], panelClass: 'jp'};

/** A fake page and clock: `click(timeout, clock)` plays the click call, `show(clock)` is what the panel shows now; pause() moves the clock. */
function fake({click, show}) {
  const clock = {ms: 0, clicks: 0, timeouts: []};
  const page = {
    locator: () => ({locator: () => ({click: async ({timeout}) => { clock.clicks += 1; clock.timeouts.push(timeout); await click(timeout, clock); }})}),
    evaluate: async () => show(clock),
  };
  return {page, clock, options: {now: () => clock.ms, pause: async ms => { clock.ms += ms; }, log: () => {}}};
}

test('a click call that times out after the press landed is judged pressed, and the halt that follows passes', async () => {
  const {page, clock, options} = fake({
    click: async (timeout, c) => { c.ms += timeout; throw new Error('locator.click: Timeout 1500ms exceeded.'); },
    show: c => (c.ms >= 1000 ? halted : pressed),   // the press landed at once, the panel halted at 1000 ms; the click call only gave up at the 1500 ms guard
  });
  const {state} = await pressStop(page, {capMs: 1500, ...options});
  assert.equal(state.stoppedShown, true);
  assert.equal(clock.clicks, 1, 'a press that landed is never repeated');
});

test('a halted panel whose labels went back to "Stop" and whose dim stays is judged pressed, and the dim stage is named (Gitar on #2779; extension/review.js stoppedHere calls stopsBack)', async () => {
  const dimStays = {...halted, overlay: true, stopButtons: ['Stop', 'Stop']};
  const {page, clock, options} = fake({click: async (timeout, c) => { c.ms += timeout; throw new Error('locator.click: Timeout 1500ms exceeded.'); }, show: () => dimStays});
  await assert.rejects(pressStop(page, {capMs: 1500, ...options}), error => /^Stop did not halt the fill: the dim over the page lifted did not finish/.test(error.message) && /"overlay":true/.test(error.message));
  assert.equal(clock.clicks, 1);
});

test('a click call that returns is not a verdict either: a panel that never shows the press fails naming the panel, not the click', async () => {
  const {page, options} = fake({click: async () => {}, show: () => idle});
  await assert.rejects(pressStop(page, {capMs: 1000, ...options}), error => {
    assert.match(error.message, /^Stop was clicked but the panel never showed it pressed/);
    assert.match(error.message, /"busy":true/);
    return true;
  });
});

test('only a Stop that was never seen pressable says "never pressable", with the panel it saw', async () => {
  const {page, options} = fake({click: async (timeout, c) => { c.ms += timeout; throw new Error('locator.click: Timeout 1000ms exceeded.'); }, show: () => idle});
  await assert.rejects(pressStop(page, {capMs: 1000, ...options}), error => /^Stop was never pressable \(locator\.click: Timeout 1000ms exceeded\.\); the panel showed .*"busy":true/.test(error.message));
});

test('the wait for a pressable Stop and the stages spend one budget: the click gets all of it, the stages what is left (injected clock)', async () => {
  const {page, clock, options} = fake({
    click: async (timeout, c) => { c.ms += 900; },   // the Stop became pressable 900 ms into the budget
    show: () => pressed,   // pressed, never halts
  });
  await assert.rejects(pressStop(page, {capMs: 1500, ...options}), /^Error: Stop did not halt the fill: the fill's step row ended/);
  assert.deepEqual(clock.timeouts, [1500], 'the click may spend the whole budget');
  assert.ok(clock.ms <= 1500, `the stages ended at the one deadline, not a fresh budget after the click (${clock.ms} ms of 1500)`);
});

test('a halt that shows late is waited for until the one deadline, not judged once right after the press', async () => {
  const {page, options} = fake({click: async () => {}, show: c => (c.ms >= 1200 ? halted : pressed)});
  const {state, ms} = await pressStop(page, {capMs: 5000, ...options});
  assert.equal(state.stoppedShown, true);
  assert.ok(ms >= 1200, `the verdict came after the panel changed (${ms} ms on the fake clock)`);
});
