// A step that opens a form tab and leaves it is red, naming the step; with the cleanup the tab is closed by the step that opened it and the count is back to its baseline.
// Why (31 Oct 2026, a8; coordinator, beta 41242762348 apply-2of3): form tabs of finished steps piled up in the real Chrome (7 forms open at 21:40:48; storage reads 7 s -> 37 s on the slow Mac).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tabGuard} from '../lib/tab-guard.mjs';

// A fake browser: a list of tabs that can be opened and closed, as playwright's context.pages() shows them.
function fakeBrowser(urls = ['about:blank']) {
  const list = [];
  const open = url => { const page = {url: () => url, closed: false, isClosed() { return this.closed; }, async close() { this.closed = true; list.splice(list.indexOf(page), 1); }}; list.push(page); return page; };
  urls.forEach(open);
  return {open, context: {pages: () => [...list]}, count: () => list.length};
}
// The runner's run, reduced to what the guard needs: it runs fn and passes its result (or error) on.
const plainRun = async (name, fn) => fn();

test('a step that leaves its form tab open is red and names the step and the tab (the guard on today\'s steps)', async () => {
  const browser = fakeBrowser();
  const ctx = {browser};
  const run = tabGuard(ctx, plainRun, {close: false});
  await assert.rejects(run('a Lever-like form: a field rendered late is filled', async () => { browser.open('https://jobs.lever.co/acme/1'); }),
    /the step "a Lever-like form: a field rendered late is filled" left 1 browser tab\(s\) open \(https:\/\/jobs\.lever\.co\/acme\/1\)/);
  assert.equal(browser.count(), 2, 'it only reports');
});

test('with the cleanup the step closes the tab it opened, and the count is back at its baseline', async () => {
  const browser = fakeBrowser();
  const run = tabGuard({browser}, plainRun);
  const before = browser.count();
  await run('a Lever-like form', async () => { browser.open('https://jobs.lever.co/acme/1'); browser.open('https://jobs.lever.co/acme/2'); });
  assert.equal(browser.count(), before);
});

test('a step that opens nothing passes, and the tabs that were open before it stay', async () => {
  const browser = fakeBrowser(['about:blank', 'https://x.test/earlier']);
  await tabGuard({browser}, plainRun)('a read-only step', async () => {});
  assert.equal(browser.count(), 2);
});

test('a failed step still closes its tabs, and its own error is the error', async () => {
  const browser = fakeBrowser();
  const run = tabGuard({browser}, plainRun);
  await assert.rejects(run('a step', async () => { browser.open('https://x.test/f'); throw new Error('the fill never finished'); }), /the fill never finished/);
  assert.equal(browser.count(), 1);
});

test('the step that launches the browser has no baseline: nothing is compared or closed', async () => {
  const ctx = {};
  const run = tabGuard(ctx, plainRun);
  await run('the app has an applicant and a browser', async () => { ctx.browser = fakeBrowser(['about:blank', 'https://x.test/a']); });
  assert.equal(ctx.browser.count(), 2);
});

test('a step can hand its tab to a later step on purpose; that step closes it, and no other step touches it', async () => {
  const browser = fakeBrowser();
  const run = tabGuard({browser}, plainRun);
  await run('opens the unknown form', async () => { browser.open('https://x.test/unknown'); }, {keepsTabs: 'unknown'});
  assert.equal(browser.count(), 2, 'kept for the next named step');
  await run('an unrelated step', async () => { browser.open('https://x.test/other'); });
  assert.equal(browser.count(), 2, 'the unrelated step closed only its own tab');
  await run('another pair closes its own key', async () => {}, {closesTabs: 'other'});
  assert.equal(browser.count(), 2, 'a different key does not close the unknown form\'s tab');
  await run('reads the unknown form', async () => {}, {closesTabs: 'unknown'});
  assert.equal(browser.count(), 1);
});

test('a tab that will not close is red on the success path, naming it', async () => {
  const browser = fakeBrowser();
  const run = tabGuard({browser}, plainRun);
  await assert.rejects(run('a stubborn step', async () => { const page = browser.open('https://x.test/stuck'); page.close = async () => { throw new Error('gone'); }; }), /left 1 browser tab\(s\) open \(https:\/\/x\.test\/stuck\)/);
});

test('a step that hung past its cap and ends while the next step runs does not close the next step\'s tabs (Gitar on #2745)', async () => {
  const browser = fakeBrowser();
  const run = tabGuard({browser}, plainRun);
  let release;
  const hung = new Promise(resolve => { release = resolve; });
  // The runner gives up on the hung step and moves on; its body is still running.
  const first = run('a step that hangs', async () => { browser.open('https://hung.test/form'); await hung; });
  let next;
  await run('the next step', async () => { next = browser.open('https://next.test/form'); release(); await first.catch(() => {}); assert.equal(next.closed, false, 'the next step\'s tab is still open while the hung step ends'); });
  assert.equal(next.closed, true, 'the next step closes its own tab at its end');
  assert.equal(browser.count(), 2, 'the blank tab and the hung step\'s tab (left for the runner\'s red) remain');
});
