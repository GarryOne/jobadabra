// "Read the jobs on this page", the safety journey that stays in e2e (owner, 1 Nov 2026: the beta keeps only critical journeys): a bot-check page stops the reader, nothing
// is read, the person answers it. The extension's own page function (extension/visit.js and visit-page.js: extractPage, as it runs inside a page) in a real Chromium on a
// fixture page. No app window, no Notion, no AI, no network.
// Moved to integration/extension/visit-read.test.mjs (CI · Harness tests, the same real Chromium): the list as shown, next/last page, the filters, template-code links, a list in another
// site's frame, the cookie banner, a blank page, a home page, the ways on for Claude, no id used twice, one visit's pages as one feed.
import {call, launchChromium, serveFixtures} from '../lib/visit-page.mjs';

export const name = 'visitread';
export const minutes = 2;
export const light = true;
export const needsChromium = true;   // CI installs Chromium for it (.github/workflows/e2e.yml)
export const keepGoing = true;

export async function run(ctx) {
  const {server, base} = await serveFixtures();
  let browser;
  try {
    browser = await launchChromium();
    const page = await browser.newPage();
    await ctx.run('a bot-check page stops it: nothing read, the person answers it', async () => {
      await page.goto(`${base}/check.html`);
      const seen = await call(page, 'extractPage');
      if (!seen.challenge) throw new Error('the check page was not recognised');
    });
  } finally {
    await browser?.close();
    server.close();
  }
}
