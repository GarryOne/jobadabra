/* global chrome */
// Integration test (layer 1, owner 1 Nov 2026): "Find jobs using your browser" (7 Oct 2026) as the extension does it in a real Chromium, no app, no Notion, no AI, no real site.
// The REAL extension (a copy that talks to a stand-in app on a free port) reads fixture job lists served over HTTPS under two host names. Moved here from the visitsauto e2e suite,
// which is gone (owner, 1 Nov 2026: "'Find jobs using your browser' this is not critical", "Move all 3 to integration"; J3 left the registry): the extension starts on the stand-in's
// port and never the user's own; a page the app did not mark is left alone; a marked tab waiting on the person says so; a marked tab, once allowed, is read page after page, reported
// as done and closed; a site that redirects by script and drops the mark is still read, reported with its ticket. The rig is lib/visits-auto-rig.mjs. Chrome's one-time "all sites"
// grant cannot be given from a script: a test that needs it stubs the extension's check of it (withGrant) and puts the real check back.
// Why this folder (1 Nov 2026, owner: integration tests live in desktop/integration/<layer>/): CI · Harness tests (npm test in desktop/e2e) runs ../integration/extension/*.test.mjs.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {ALLOWED, OTHER, startRig, until} from '../../e2e/lib/visits-auto-rig.mjs';

const LIVE_APP_PORT = 47111;   // lib/server-listen.js DEFAULT_PORT: the owner's own app
let rig;
before(async () => { rig = await startRig(); });
after(async () => { await rig?.close(); });

/** Runs `body` with the extension's check of the one-time "all sites" grant answering yes, then puts the real check back (a test never leaves a stub for the next). */
async function withGrant(body) {
  const {worker} = rig;
  await worker.evaluate(() => { globalThis.__realContains = chrome.permissions.contains; chrome.permissions.contains = async () => true; });
  try { return await body(); } finally { await worker.evaluate(() => { chrome.permissions.contains = globalThis.__realContains; }); }
}
const doneCalls = () => rig.app.calls.filter(call => call.path === '/extension/visit-done');

test('the extension starts and reaches the stand-in app, never the user\'s own (a different port)', async () => {
  assert.notEqual(rig.appPort, LIVE_APP_PORT, 'the test app must not use the live app\'s port');
  const address = await rig.worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  assert.ok(!new RegExp(`(?:127\\.0\\.0\\.1|localhost):${LIVE_APP_PORT}(?!\\d)`).test(address), `the extension's storage holds the live app's address: ${address.slice(0, 300)}`);
});

test('a page the app did not mark is left alone: nothing read, nothing sent', async () => {
  const {app, context, reads} = rig;
  app.calls.length = 0;
  await withGrant(async () => {
    // The unmarked tab loads first; a marked tab is read after it (the positive control: the same extension, the same grant, reads what the app marks). Page 1 + its Next page are
    // the marked tab's two reads; a third read, or any call from the unmarked tab, is the extension reading a page nobody marked.
    const unmarked = await context.newPage();
    await unmarked.goto(`https://${ALLOWED}/list-2.html`, {waitUntil: 'load'});
    const marked = await context.newPage();
    await marked.goto(`https://${ALLOWED}/list-1.html#jp-read`);
    assert.ok(await until(() => doneCalls().length > 0, 60000), `the marked tab was never reported done (the control); calls: ${app.calls.map(call => call.path).join(', ')}`);
    assert.equal(reads().length, doneCalls()[0].payload.pages, `${reads().length} pages were read, the marked tab read ${doneCalls()[0].payload.pages}: a page nobody marked was read`);
    assert.ok(!unmarked.isClosed(), 'the unmarked tab was closed by the extension');
    await unmarked.close();
  });
});

test('a marked tab waiting on the person says so: the Allow page opens beside it and the app is told it waits, nothing is read', async () => {
  const {app, context, worker, reads} = rig;
  app.calls.length = 0;
  const tab = await context.newPage();
  const waiting = () => worker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).filter(key => key.startsWith('waiting:')));
  try {
    await tab.goto(`https://${OTHER}/list-1.html#jp-read`);
    assert.ok(await until(async () => (await waiting()).length > 0, 10000), 'the tab is not waiting for the permission');
    assert.ok(await until(() => context.pages().some(page => /\/allow\.html$/.test(page.url())), 10000), 'no Allow page opened: the person would not know they must act');
    assert.ok(await until(() => app.calls.some(call => call.path === '/extension/visit-waiting' && call.payload.url === `https://${OTHER}/list-1.html`), 10000), 'the app was not told the site waits on the person');
    assert.equal(reads().length, 0, 'a page was read before the person allowed it');
  } finally {
    for (const page of context.pages().filter(page => /\/allow\.html$/.test(page.url()))) await page.close();
    await tab.close();
    await worker.evaluate(async () => { const all = await chrome.storage.session.get(null); await chrome.storage.session.remove(Object.keys(all).filter(key => key.startsWith('waiting:'))); });
  }
});

test('a marked tab, once allowed, is read by itself over its pages, reported to the app as done, and closed', async () => {
  const {app, context} = rig;
  app.calls.length = 0;
  await withGrant(async () => {
    const tab = await context.newPage();
    await tab.goto(`https://${ALLOWED}/list-1.html#jp-read`);
    assert.ok(await until(() => doneCalls().length > 0, 60000), `no done report; calls: ${app.calls.map(call => call.path).join(', ')}`);
    const report = doneCalls()[0].payload;
    assert.equal(report.url, `https://${ALLOWED}/list-1.html`, 'reported for another address than the one marked');
    assert.deepEqual([report.pages, report.jobs], [2, 3], 'pages and jobs read');
    assert.ok(await until(() => tab.isClosed(), 10000), 'the tab stayed open: the app could not open the next site in its place');
  });
});

test('a marked tab whose site redirects by script and drops the mark is still read by itself, reported with its ticket', async () => {
  const {app, context} = rig;
  app.calls.length = 0;
  await withGrant(async () => {
    const tab = await context.newPage();
    await tab.goto(`https://${ALLOWED}/redirect.html#jp-read-c0ffee12`);
    const reported = await until(() => doneCalls().length > 0, 60000);
    assert.ok(reported, `no done report after the redirect; the tab is at ${tab.isClosed() ? '(closed)' : tab.url()}; calls: ${app.calls.map(call => call.path).join(', ')}`);
    const report = doneCalls()[0].payload;
    assert.equal(report.ticket, 'c0ffee12', 'the app could not match the report to the run');
    assert.equal(report.jobs, 3);
  });
});
