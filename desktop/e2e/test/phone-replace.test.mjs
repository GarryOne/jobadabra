// Real debugger typing must replace a prefilled telephone number and stay idempotent.
/* global window, document, chrome */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {PAGE_FILES} from '../../../extension/page-files.js';
import {typeNotTakenForReal} from '../../../extension/fill-verify.js';
import {startRealExtension} from '../lib/real-extension.mjs';

const FIXTURE_URL = 'https://phone.example.test/fixture';
const FORM = `<!doctype html><title>Telephone control fixture</title>
<label>Country <select id="country"><option value="+44">+44</option><option value="+41">+41</option></select></label>
<label>Phone <input id="phone" type="tel" value="+442079460123"></label>
<label>Unrelated <input id="other" value="Keep my text"></label>
<script>window.changes = []; document.querySelector("#phone").addEventListener("change", e => window.changes.push(e.target.value)); window.inputs = []; const phone = document.querySelector('#phone');
// A controlled mask restores its caret after a key gesture, including Select All's keyup.
phone.addEventListener('keyup', () => phone.setSelectionRange(phone.value.length, phone.value.length)); document.querySelector('#phone').addEventListener('input', e => window.inputs.push({value: e.target.value, trusted: e.isTrusted}));</script>`;

test('real retyping replaces a different existing phone beside a country selector, including Fill again', async () => {
  const app = await startRealExtension({offline: true, cv: false, allowAllSites: true});
  try {
    await app.context.route(FIXTURE_URL, route => route.fulfill({contentType: 'text/html', body: FORM}));
    await app.page.goto(FIXTURE_URL);
    await app.page.addScriptTag({path: new URL('../../../extension/page/fill-verify.js', import.meta.url).pathname});
    const cdp = await app.context.newCDPSession(app.page);
    for (let pass = 0; pass < 2; pass++) {
      await app.page.evaluate(() => window.__jobPilottoNoteNotTaken('phone', '+41795550123'));
      const result = await typeNotTakenForReal({
        page: (func, args = []) => app.page.evaluate(({source, args}) => (0, eval)(`(${source})`)(...args), {source: func.toString(), args}),
        send: (method, params) => cdp.send(method, params),
      });
      assert.equal(await app.page.locator('#phone').inputValue(), '+41795550123', `pass ${pass + 1}: only the intended number remains`);
      assert.equal(await app.page.locator('#other').inputValue(), 'Keep my text');
      assert.equal(await app.page.locator('#country').inputValue(), '+44');
      assert.equal(result.taken, pass ? 0 : 1);
    }
    assert.ok((await app.page.evaluate(() => window.inputs)).some(e => e.trusted && e.value === '+41795550123'), 'real input reaches widget validation');
    assert.ok((await app.page.evaluate(() => window.changes)).includes('+41795550123'), 'widget change validation receives the intended replacement');
    await app.assertIsolated();
  } finally { await app.close(); }
});

test('post-country phone writer replaces the existing number on every pass', async () => {
  const app = await startRealExtension({offline: true, cv: false, allowAllSites: true});
  try {
    await app.context.route(FIXTURE_URL, route => route.fulfill({contentType: 'text/html', body: FORM}));
    await app.page.goto(FIXTURE_URL);
    for (const file of PAGE_FILES) await app.page.addScriptTag({content: fs.readFileSync(new URL(`../../../extension/${file}`, import.meta.url), 'utf8')});
    // Isolate the post-menu writer: the country is already selected, so there is no menu work left.
    await app.page.evaluate(() => {
      document.querySelector('#country').setAttribute('data-jobpilotto-armed', 'Country');
      window.__jobPilottoNextCombo = () => null;
      window.__jobPilottoPhone = {field: 'phone', national: '+41795550123'};
    });
    const driver = await app.context.newPage();
    const base = app.context.serviceWorkers()[0].url().split('/').slice(0, 3).join('/');
    await driver.goto(`${base}/options.html`);
    for (let pass = 0; pass < 2; pass++) {
      const results = await driver.evaluate(async url => {
        const {clickCombos} = await import('./flow.js');
        const [tab] = await chrome.tabs.query({url});
        await chrome.storage.session.set({[`armed:${tab.id}`]: true});
        return clickCombos(tab.id);
      }, FIXTURE_URL);
      assert.equal(results.find(r => r.label === 'Phone (typed for real)').picked, true);
      assert.equal(await app.page.locator('#phone').inputValue(), '+41795550123', `post-country pass ${pass + 1}`);
      assert.equal(await app.page.locator('#country').inputValue(), '+44');
      assert.equal(await app.page.locator('#other').inputValue(), 'Keep my text');
    }
    assert.ok((await app.page.evaluate(() => window.inputs)).every(e => e.trusted), 'widget sees actual trusted input');
    await app.page.evaluate(() => {
      const other = document.querySelector('#other'); other.focus();
      document.querySelector('#phone').addEventListener('focus', () => other.focus(), {once: true});
    });
    const refused = await driver.evaluate(async url => {
      const {clickCombos} = await import('./flow.js');
      const [tab] = await chrome.tabs.query({url});
      return clickCombos(tab.id);
    }, FIXTURE_URL);
    assert.equal(refused.find(r => r.label === 'Phone (typed for real)').picked, false, 'a widget stealing focus cannot report successful typing');
    assert.equal(await app.page.locator('#phone').inputValue(), '+41795550123');
    assert.equal(await app.page.locator('#other').inputValue(), 'Keep my text', 'never select or type over a different focused field');

    await app.assertIsolated();
  } finally { await app.close(); }
});
