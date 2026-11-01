// Guards the person's click on a sign-up page: it waits for the fill overlay and tries again when the overlay came back.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ticked, pressed, whenFree} from '../../lib/free-click.mjs';

const fakeTab = failures => {
  const calls = {waits: 0, checks: 0, clicks: 0};
  return {calls, url: () => 'https://jobs.example/e2e/signup#jobpilotto-fill', evaluate: async () => false, waitForFunction: async () => { calls.waits += 1; },
    check: async () => { calls.checks += 1; if (calls.checks <= failures) throw new Error('Clicking the checkbox did not change its state'); },
    click: async () => { calls.clicks += 1; }};
};

test('a tick lost under a returning overlay is made again after it lifts', async () => {
  const tab = fakeTab(2);
  await ticked(tab, '#robot');
  assert.equal(tab.calls.checks, 3);
  assert.equal(tab.calls.waits, 3);   // the overlay is waited for before every attempt
});

test('a click waits for the overlay once when nothing goes wrong', async () => {
  const tab = fakeTab(0);
  await pressed(tab, '#create_account', {landed: async () => tab.calls.clicks >= 1, step: 1});
  assert.deepEqual(tab.calls, {waits: 1, checks: 0, clicks: 1});
});

// 26 Oct 2026, beta 40275152602: the overlay came back between its lift and the click; the click threw nothing and the sign-up page never left.
test('a click the overlay ate without an error is made again until what it does shows', async () => {
  const tab = fakeTab(0);
  await pressed(tab, '#create_account', {landed: async () => tab.calls.clicks >= 3, landMs: 5, step: 1});
  assert.equal(tab.calls.clicks, 3);
  assert.equal(tab.calls.waits, 3, 'the overlay is waited for before every click');
});

test('a press with no way to see it land is refused, and one that never lands fails after its tries', async () => {
  await assert.rejects(() => pressed(fakeTab(0), '#create_account'), /needs landed/);
  const tab = fakeTab(0);
  await assert.rejects(() => pressed(tab, '#create_account', {landed: async () => false, tries: 2, landMs: 2, step: 1}), /never took effect after 2 tries/);
  assert.equal(tab.calls.clicks, 2);
});

test('a click that never lands still fails, with the page error', async () => {
  const tab = fakeTab(99);
  await assert.rejects(() => whenFree(tab, options => tab.check('#robot', options), {tries: 3}), /did not change its state/);
  assert.equal(tab.calls.checks, 3);
});

// 1 Nov 2026, red 41267492981: a held overlay ended the step with a bare "Timeout 30000ms exceeded". It now waits for the step's clock and says what it saw.
test('an overlay that never lifts fails naming the overlay, the fill state and the address, not a bare timeout', async () => {
  const overlayUp = fn => String(fn).includes('getElementById');   // liftState reads the overlay; fillState reads the page's fill mark
  const tab = {...fakeTab(0), evaluate: async fn => (overlayUp(fn) ? true : {state: 'running', error: 'No tab with id: 7'}),
    waitForFunction: async () => { throw new Error('page.waitForFunction: Timeout 30000ms exceeded.\nCall log: ...'); }};
  await assert.rejects(() => ticked(tab, '#robot'), error => {
    assert.match(error.message, /the fill overlay did not lift \(last state/);
    assert.match(error.message, /"overlay":"up"/);
    assert.match(error.message, /"error":"No tab with id: 7"/);
    assert.match(error.message, /"url":"https:\/\/jobs\.example\/e2e\/signup"/);
    assert.match(error.message, /Timeout 30000ms exceeded/);
    return true;
  });
});

test('the wait for the overlay borrows the step\'s remaining time', async () => {
  const waited = [];
  const tab = {...fakeTab(0), waitForFunction: async (fn, arg, options) => { waited.push(options.timeout); }};
  const {stepClock} = await import('../../lib/wait-on-state.mjs');
  stepClock(12000);
  try { await ticked(tab, '#robot'); } finally { stepClock(null); }
  assert.ok(waited[0] > 0 && waited[0] <= 12000, `waited ${waited[0]} ms, not the fixed 30000`);
});

test('outside a step the wait has no bound of its own; a spent step clock says so instead of blaming the overlay', async () => {
  const seen = [];
  const tab = {...fakeTab(0), waitForFunction: async (fn, arg, options) => { seen.push(options); }};
  await ticked(tab, '#robot');
  assert.deepEqual(seen, [{}], 'no step: Playwright\'s own default, not a constant here');
  const {stepClock} = await import('../../lib/wait-on-state.mjs');
  stepClock(1);   // the report margin (REPORT_MS) is taken off, so the time left is already 0
  try {
    await assert.rejects(() => ticked(tab, '#robot'), /the step's clock ran out before the fill overlay lifted/);
  } finally { stepClock(null); }
  assert.equal(seen.length, 1, 'a spent clock never starts a wait');
});
