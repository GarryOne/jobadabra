/* global chrome */
// Integration test (layer 1, owner 1 Nov 2026): "Find jobs using your browser" reads a marked tab by itself even when the site redirects by script and drops the mark (Fust-style, 7 Oct 2026).
// The REAL extension (a copy that talks to a stand-in app) in a real Chromium on a fixture list served over HTTPS; no app, no Notion, no AI, no real site. Moved here from the visitsauto
// e2e suite (its other steps stay there: they go through the permission page and the app's reports). The rig is lib/visits-auto-rig.mjs; Chrome's one-time "all sites" grant is simulated.
// Why this folder (1 Nov 2026, owner: integration tests live in desktop/integration/<layer>/): CI · Harness tests (npm test in desktop/e2e) runs ../integration/extension/*.test.mjs.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {ALLOWED, startRig, until} from '../../e2e/lib/visits-auto-rig.mjs';

let rig;
before(async () => { rig = await startRig(); });
after(async () => { await rig?.close(); });

test('a marked tab whose site redirects by script and drops the mark is still read by itself, reported with its ticket', async () => {
  const {app, context, worker} = rig;
  await worker.evaluate(() => { chrome.permissions.contains = async () => true; });   // the one-time grant, simulated
  const tab = await context.newPage();
  await tab.goto(`https://${ALLOWED}/redirect.html#jp-read-c0ffee12`);
  const reported = await until(() => app.calls.some(call => call.path === '/extension/visit-done'), 60000);
  assert.ok(reported, `no done report after the redirect; the tab is at ${tab.isClosed() ? '(closed)' : tab.url()}; calls: ${app.calls.map(call => call.path).join(', ')}`);
  const report = app.calls.find(call => call.path === '/extension/visit-done').payload;
  assert.equal(report.ticket, 'c0ffee12', 'the app could not match the report to the run');
  assert.equal(report.jobs, 3);
});
