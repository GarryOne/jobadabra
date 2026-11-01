/* global chrome */
// "Find jobs using your browser" from the Actions card (7 Oct 2026): the REAL extension (a copy that talks to a stand-in app on a free port) in a real
// Chromium, on fixture job lists served over HTTPS. A page the app did not mark is left alone; a marked tab without the one-time permission waits
// (and is read nowhere); a marked tab on a site the extension may read is read by itself, page after page, reported to the app and closed.
// Simulated: Chrome's one-time "all sites" grant cannot be given from a script, so for the read step the extension's check of it is stubbed in its
// worker; the reading itself runs on a job-system host the extension is already allowed on. No Notion, no AI, no real site.
import {ALLOWED, OTHER, startRig, until, wait} from '../lib/visits-auto-rig.mjs';

export const name = 'visitsauto';
export const minutes = 4;
export const light = true;
export const needsChromium = true;   // CI installs Chromium for it (.github/workflows/e2e.yml)
export const keepGoing = true;

// The redirect-by-script step moved to integration/extension/visits-auto.test.mjs (1 Nov 2026); the rig is lib/visits-auto-rig.mjs.
export async function run(ctx) {
  const {app, appPort, worker, context, reads, close} = await startRig();
  try {
    await ctx.run('the extension starts and reaches the stand-in app, never the user\'s own (a different port)', async () => {
      if (!worker) throw new Error('the extension\'s worker did not start');
      if (appPort === 47111) throw new Error('the test app must not use the live app\'s port');
    });

    await ctx.run('a page the app did not mark is left alone: nothing read, nothing sent', async () => {
      const tab = await context.newPage();
      await tab.goto(`https://${ALLOWED}/list-1.html`);
      await wait(3000);
      if (reads().length) throw new Error(`${reads().length} pages were read without the app's mark`);
      await tab.close();
    });

    await ctx.run('a marked tab waiting on the person says so: the Allow page opens beside it and the app is told it waits (owner\'s rule), nothing is read', async () => {
      const tab = await context.newPage();
      await tab.goto(`https://${OTHER}/list-1.html#jp-read`);
      const waiting = await until(async () => Object.keys(await worker.evaluate(() => chrome.storage.session.get(null))).some(key => key.startsWith('waiting:')), 10000);
      if (!waiting) throw new Error('the tab is not waiting for the permission');
      const allowPage = await until(() => context.pages().some(page => /\/allow\.html$/.test(page.url())), 10000);
      if (!allowPage) throw new Error('no Allow page opened: the person would not know they must act');
      const told = await until(() => app.calls.some(call => call.path === '/extension/visit-waiting' && call.payload.url === `https://${OTHER}/list-1.html`), 10000);
      if (!told) throw new Error('the app was not told the site waits on the person');
      if (reads().length) throw new Error('a page was read before the person allowed it');
      for (const page of context.pages().filter(page => /\/allow\.html$/.test(page.url()))) await page.close();
      await tab.close();
      await worker.evaluate(async () => { const all = await chrome.storage.session.get(null); await chrome.storage.session.remove(Object.keys(all).filter(key => key.startsWith('waiting:'))); });
    });

    await ctx.run('a marked tab, once allowed, is read by itself over its pages, reported to the app as done, and closed', async () => {
      await worker.evaluate(() => { chrome.permissions.contains = async () => true; });   // the one-time grant, simulated (see the top of this file)
      const tab = await context.newPage();
      const closed = new Promise(resolve => tab.once('close', resolve));
      await tab.goto(`https://${ALLOWED}/list-1.html#jp-read`);
      const reported = await until(() => app.calls.some(call => call.path === '/extension/visit-done'), 60000);
      if (!reported) throw new Error(`no done report; calls: ${app.calls.map(call => call.path).join(', ')}`);
      const report = app.calls.find(call => call.path === '/extension/visit-done').payload;
      console.log(`    done: ${JSON.stringify({url: report.url, pages: report.pages, jobs: report.jobs, stopped: report.stopped})}`);
      if (report.url !== `https://${ALLOWED}/list-1.html`) throw new Error(`reported for ${report.url}, without the mark expected`);
      if (report.pages !== 2 || report.jobs !== 3) throw new Error(`read ${report.pages} pages and ${report.jobs} jobs, expected 2 and 3`);
      const gone = await Promise.race([closed.then(() => true), wait(10000).then(() => false)]);
      if (!gone) throw new Error('the tab stayed open: the app could not open the next site in its place');
    });
  } finally {
    await close();
  }
}
