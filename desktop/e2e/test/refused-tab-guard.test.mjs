/* global chrome */
// The real-tab step with the REAL extension in a real Chromium (owner, 20 Oct 2026: it reads with no cookies or logins): a cookie sits in the browser for the fixture site,
// and the extension may open the site only in an incognito window. A fresh test Chromium does not allow the extension in incognito (a profile cannot be flipped from a test),
// so the proof here is the refusal side: the guard opens nothing, and the fixture server sees no request at all, so no Cookie header can have reached it.
// Fake data only, a local fixture server, no AI, no live site.
import assert from 'node:assert/strict';
import http from 'node:http';
import {test} from 'node:test';
import {startRealExtension} from '../lib/real-extension.mjs';
import {extensionWorker} from '../lib/own-worker.mjs';

const extensionDir = process.env.REAL_EXTENSION_DIR || undefined;

test('with no incognito access the tab step opens nothing and the fixture site sees no request, whatever cookie the browser holds', async () => {
  const seen = [];
  const site = http.createServer((request, response) => { seen.push({url: request.url, cookie: request.headers.cookie || ''}); response.writeHead(200, {'content-type': 'text/html'}); response.end('<title>Jobs</title>'); });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${site.address().port}/jobs`;
  let app;   // the launch is inside the try: a browser that will not start used to leave this server listening, and the test process never ended (every e2e.yml and harness-daily run hung from 21 Oct 2026)
  try {
    app = await startRealExtension({extensionDir, allowAllSites: true});
    await app.context.addCookies([{name: 'session', value: 'owner-login', url}]);
    const worker = await extensionWorker(app.context);
    const id = new URL(worker.url()).host;
    const page = await app.context.newPage();
    await page.goto(`chrome-extension://${id}/options.html`);
    const answer = await page.evaluate(async address => {
      const {tabReader} = await import(chrome.runtime.getURL('refused-tab.js'));
      const asked = [];
      const result = await tabReader({judge: async seenPage => { asked.push(seenPage); return {state: 'page'}; }}).read(address);
      return {result, asked: asked.length, windows: (await chrome.windows.getAll({populate: false})).length};
    }, url);
    assert.deepEqual(answer.result, {skipped: 'incognito'});
    assert.equal(answer.asked, 0);
    assert.deepEqual(seen, [], 'the site was never requested, so it never saw a Cookie header');
    // Positive control: an ordinary tab of this same browser DOES send the cookie, so the empty log above is the guard's doing, not a broken fixture.
    await page.goto(url);
    assert.match(seen[0]?.cookie || '', /session=owner-login/);
    await app.assertIsolated();
  } finally { await app?.close(); site.close(); }
});
