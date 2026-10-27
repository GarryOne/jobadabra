/* global document, location, chrome, getComputedStyle */
// The panel's two themes follow the app's setting live (no reload), and Stop is one press away mid-fill with the panel open AND minimised (real extension, fixture form, fake data).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startRealExtension} from '../lib/real-extension.mjs';

const FORM = `<!doctype html><title>Senior Site Reliability Engineer</title><form><h1>Apply</h1>
<label>Full name <input name="n" required></label><label>Email <input name="e" type="email" required></label><label>Phone <input name="p" required></label><label>City <input name="c" required></label></form>`;
const open = async () => {
  const state = {theme: 'light'};
  const app = await startRealExtension({extensionDir: process.env.REAL_EXTENSION_DIR || undefined, allowAllSites: true, answer: {
    '/extension/review': () => ({matched: 's1', theme: state.theme, session: {id: 's1', title: 'Senior Site Reliability Engineer', company: 'Acme', status: 'running', live: false, kind: 'form', url: 'https://jobs.example.test/apply'}, cv: {tailored: false, working: false}, watch: [], commands: []})}});
  await app.context.route('https://jobs.example.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: FORM}));
  await app.page.goto('https://jobs.example.test/apply');
  await app.page.evaluate(() => { location.hash = 'jobpilotto-fill'; });
  await app.page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.report-btn'), null, {timeout: 20000});
  const worker = app.context.serviceWorkers()[0];
  const step = text => worker.evaluate(async words => { const [tab] = await chrome.tabs.query({url: 'https://jobs.example.test/*'}); return chrome.tabs.sendMessage(tab.id, {type: 'panelStep', text: words}); }, text);
  const press = selector => app.page.locator('#jobpilotto-review-host').locator(selector).click();   // a trusted click, after the live control is visible and stable
  const surface = () => app.page.evaluate(() => { const jp = document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.jp'); return jp && {theme: jp.dataset.theme || '', card: getComputedStyle(jp.querySelector('.card')).backgroundColor}; });
  return {app, state, step, press, surface};
};

test('switching the app\'s theme changes an open panel without a reload', async () => {
  const t = await open();
  try {
    await t.app.page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.jp')?.dataset.theme === 'light', null, {timeout: 20000});
    await t.step('Reading the form…');
    const light = await t.surface();
    t.state.theme = 'dark';
    await t.app.page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.jp')?.dataset.theme === 'dark', null, {timeout: 20000}).catch(() => assert.fail('the panel did not follow the app to dark'));
    const dark = await t.surface();
    assert.notEqual(dark.card, light.card, 'the card is drawn in the dark tokens');
    t.state.theme = 'system';
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.jp')?.dataset.theme, null, {timeout: 20000}).catch(() => assert.fail('"system" leaves the choice to the browser'));
  } finally { await t.app.close(); }
});

for (const minimised of [false, true]) {
  test(`Stop halts a fill with the panel ${minimised ? 'minimised (on the pill)' : 'open (in the live step row)'}`, async () => {
    const t = await open();
    try {
      await t.step('Choosing dropdown answers…');
      await t.app.page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.fill.is-busy'), null, {timeout: 5000});
      if (minimised) {
        await t.press('.min');
        // A real fill keeps reporting steps after the person minimises; Stop must stay on the pill.
        await t.step('Reading another field…');
        assert.equal(await t.app.page.locator('#jobpilotto-review-host').locator('.card').evaluate(el => el.hidden), true, 'ordinary progress keeps the card minimised');
      }
      await t.press(minimised ? '.pill-stop' : '.stop-btn');
      // Stop keeps the panel, calm: "Stopped by you" with Check form again, no dim, no step row (0d0327b, owner 27 Oct 2026); it no longer removes the panel.
      await t.app.page.waitForFunction(() => { const root = document.getElementById('jobpilotto-review-host')?.shadowRoot;
        return !!root && !root.querySelector('.fill.is-busy') && !document.getElementById('jobpilotto-fill-overlay') && (root.querySelector('.card').hidden || !root.querySelector('.stopped').hidden); }, null, {timeout: 10000}).catch(() => assert.fail('Stop did not halt the fill'));
      assert.equal(await t.app.page.evaluate(() => !!document.getElementById('jobpilotto-stop-host')), false, 'the bottom-left chip is gone');
    } finally { await t.app.close(); }
  });
}
