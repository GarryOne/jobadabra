// "Read the jobs on this page", the safety journey that stays in e2e (owner, 1 Nov 2026: the beta keeps only critical journeys): a bot-check page stops the reader, nothing
// is read, the person answers it. The extension's own page function (extension/visit.js and visit-page.js: extractPage, as it runs inside a page) in a real Chromium on a
// fixture page. No app window, no Notion, no AI, no network.
// Moved to integration/extension/visit-read.test.mjs (CI · Harness tests, the same real Chromium): the list as shown, next/last page, the filters, template-code links, a list in another
// site's frame, the cookie banner, a blank page, a home page, the ways on for Claude, no id used twice, one visit's pages as one feed.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright-core';

export const name = 'visitread';
export const minutes = 2;
export const light = true;
export const needsChromium = true;   // CI installs Chromium for it (.github/workflows/e2e.yml)
export const keepGoing = true;

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const fixtures = path.join(import.meta.dirname, '..', 'fixtures', 'visits');
// The page functions as the extension injects them: their own source, nothing re-written for the test (split over two files since 25ed270).
const source = ['visit.js', 'visit-page.js'].map(file => fs.readFileSync(path.join(repo, 'extension', file), 'utf8')).join('\n');
const fn = name => { const match = new RegExp(`export (?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`).exec(source); if (!match) throw new Error(`${name} not found in extension/visit.js or visit-page.js`); return match[0].replace('export ', ''); };
const call = (page, name) => page.evaluate(`(${fn(name).replace(`function ${name}`, 'function')})()`);

export async function run(ctx) {
  const server = http.createServer((req, res) => {
    const file = path.join(fixtures, path.basename(req.url.split('?')[0]) || 'list-1.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(fs.readFileSync(file));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  // The full Chromium in its new headless mode, as the extension suites run it: CI installs that one, not the separate headless shell.
  let browser;
  try {
    browser = await chromium.launch({headless: false, args: [...(process.env.E2E_HEADED ? [] : ['--headless=new'])]});
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
