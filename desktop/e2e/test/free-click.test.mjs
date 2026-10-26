// Guards the person's click on a sign-up page: it waits for the fill overlay and tries again when the overlay came back.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ticked, pressed, whenFree} from '../lib/free-click.mjs';

const fakeTab = failures => {
  const calls = {waits: 0, checks: 0, clicks: 0};
  return {calls, waitForFunction: async () => { calls.waits += 1; },
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
