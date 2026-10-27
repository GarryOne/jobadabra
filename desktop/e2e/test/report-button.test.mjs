/* global document, window, chrome */
// The panel's Report button on a fixture form with the REAL extension: pressing it opens the popup ON the panel (owner, 19 Oct 2026), never silently and never in another corner; it works after a Stop and
// on a stuck page. (The recording itself is not available in this headless harness: the Send path is pinned in desktop/test/report-after-stop.test.js.) No report is ever sent.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startRealExtension} from '../lib/real-extension.mjs';

const FORM = `<!doctype html><title>Senior Site Reliability Engineer</title><form><h1>Apply</h1>
<label>Full name <input name="n" required></label><label>Email <input name="e" type="email" required></label><label>Phone <input name="p" required></label><label>City <input name="c" required></label></form>`;
const extensionDir = process.env.REAL_EXTENSION_DIR || undefined;

async function start(answer = {}) {
  const app = await startRealExtension({extensionDir, allowAllSites: true, answer: {'/extension/report-form': () => ({ok: true, enabled: true}), ...answer}});
  await app.context.route('https://jobs.example.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: FORM}));
  await app.page.goto('https://jobs.example.test/apply#jobpilotto-fill');   // the app opens the tab with the mark: the recording starts as it loads
  await app.page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.report-btn'), null, {timeout: 20000});
  // The page's own first fill runs first: while it works, Report is not drawn (owner, 27 Oct 2026: a button that cannot act while working is hidden); its end brings it back.
  await app.page.waitForFunction(() => !document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.jp.working'), null, {timeout: 30000});
  await app.page.waitForTimeout(1000);
  return app;
}
const openPanel = page => page.evaluate(() => { const root = document.getElementById('jobpilotto-review-host').shadowRoot; if (root.querySelector('.card').hidden) root.querySelector('.pill').click(); });
const pressReport = async page => {
  const box = await page.evaluate(() => { const b = document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.report-btn').getBoundingClientRect(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; });
  await page.mouse.click(box.x, box.y);   // a real click: the popup ignores a script's
};
const popup = page => page.evaluate(() => { const pop = document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.report-pop'); const r = pop.getBoundingClientRect(); return {hidden: pop.hidden, text: pop.textContent.replace(/\s+/g, ' ').trim(), right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom, left: r.left}; });
const popupText = async (page, pattern) => { await page.waitForFunction(source => new RegExp(source).test(document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.report-pop').textContent), pattern.source, {timeout: 8000}).catch(() => {}); return popup(page); };

test('pressing the panel\'s Report opens a popup on the panel, bottom right, and the old bottom-left ⚑ and Stop-side card are gone', async () => {
  const app = await start();
  try {
    await openPanel(app.page);
    assert.equal((await popup(app.page)).hidden, true, 'positive control: the popup is closed before the press');
    await pressReport(app.page);
    const shown = await popupText(app.page, /Never sent|Nothing to send|Nothing was sent/);
    assert.equal(shown.hidden, false, 'the Report press opened no popup');
    assert.ok(shown.right < 40 && shown.left > 200, `the popup is over the panel on the right, not another corner: ${JSON.stringify(shown)}`);
    assert.match(shown.text, /Send this form's recording\?|Nothing to send/);
    assert.equal(await app.page.evaluate(() => !!document.getElementById('jobpilotto-report-host')), false, 'no separate ⚑ chip host any more');
    await app.page.screenshot({path: process.env.SHOT || undefined});
  } finally { await app.close(); }
});

// Report -> Stop -> Report (the owner's order): the popup opens after a Stop too, and says what is there.
test('after Stop, the panel\'s Report still opens the popup', async () => {
  const app = await start();
  try {
    await app.context.serviceWorkers()[0].evaluate(async () => { await new Promise(resolve => chrome.runtime.sendMessage({type: 'stop', reason: 'test'}, resolve)); });
    await app.page.waitForTimeout(1500);
    await openPanel(app.page);
    await pressReport(app.page);
    const shown = await popupText(app.page, /Never sent|Nothing to send|Nothing was sent/);
    assert.equal(shown.hidden, false, 'after Stop, the Report press opened no popup');
  } finally { await app.close(); }
});
