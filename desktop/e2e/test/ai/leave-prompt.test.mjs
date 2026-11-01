// lib/leave-prompt.mjs goTo: when leaving opens a save bar's unsaved-edits prompt it presses Discard and waits for the page; otherwise it only clicks the nav.
import assert from 'node:assert/strict';
import test from 'node:test';
import {LEAVE_DIALOG, goTo} from '../../lib/leave-prompt.mjs';

function fakePage({prompt, delayedPrompt = false}) {
  const done = [];
  const locator = selector => ({
    count: async () => (selector === LEAVE_DIALOG && prompt ? 1 : 0),
    locator: inner => ({click: async () => done.push(`click ${selector} ${inner}`)}),
    waitFor: async () => done.push(`wait ${selector}`),
    first: () => ({isVisible: async () => true}),   // goView: the menu button is shown, so it is clicked
  });
  return {done, click: async selector => done.push(`click ${selector}`), locator,
    waitForFunction: async (_fn, selector, options) => {
      assert.ok(selector.includes(LEAVE_DIALOG));
      assert.ok(selector.includes('.view[data-view='));
      assert.equal(options.timeout, 2000);
      done.push('wait navigation');
      if (delayedPrompt) prompt = true;
    }};
}

test('a leave prompt is answered with Discard, then the page is waited for', async () => {
  const page = fakePage({prompt: true}), said = [];
  assert.equal(await goTo(page, 'jobs', line => said.push(line)), true);
  assert.deepEqual(page.done, ['click .nav[data-view="jobs"]', 'wait navigation', `click ${LEAVE_DIALOG} button[value="discard"]`, 'wait .view[data-view="jobs"]:not([hidden])']);
  assert.match(said[0], /discarded, on to jobs/);
});

test('without a prompt it only clicks the nav', async () => {
  const page = fakePage({prompt: false});
  assert.equal(await goTo(page, 'focus', () => assert.fail('nothing to say')), false);
  assert.deepEqual(page.done, ['click .nav[data-view="focus"]', 'wait navigation']);
});

test('a prompt appearing after the nav click is still discarded', async () => {
  const page = fakePage({prompt: false, delayedPrompt: true});
  assert.equal(await goTo(page, 'jobs', () => {}), true);
  assert.ok(page.done.includes(`click ${LEAVE_DIALOG} button[value="discard"]`));
});

test('navigation that reaches neither a dialog nor the page fails at the hang cap', async () => {
  const page = fakePage({prompt: false});
  page.waitForFunction = async () => { throw new Error('navigation timeout'); };
  await assert.rejects(goTo(page, 'jobs'), /navigation timeout/);
});
