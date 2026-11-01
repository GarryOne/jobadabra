// The panel counts a select-only combobox that is no input (a <div role=combobox> holding the shown choice, OpenUI5's sap.m.Select) by the choice it shows: a shown choice is answered, the
// placeholder item ("No Selection", empty key) is left, and the person's own pick clears the row on the panel's next read. 15 Oct 2026, the owner's real fill of a SuccessFactors career
// site: Country showed Switzerland, the newsletter select No, and the panel still listed both as "left for you". Markup written from OpenUI5's sap.m.SelectRenderer code (the
// renderer that site ships), NOT captured from a live page. Guard for page/read-back.js selectOnly and panel-form.js fields().
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';
import { evalPanel } from './helpers/panel.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();

const UI5 = (id, label, text, key) => `<label id="${id}-l">${label} *</label><div id="${id}" class="sapMSlt sapMSltDefault"><div id="${id}-hiddenSelect" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-required="true" aria-labelledby="${id}-l" class="sapUiPseudoInvisibleText sapMSltHiddenSelect" tabindex="0">${text}</div>` +
  `<input id="${id}-hiddenInput" name="${id}" value="${key}" aria-readonly="true" tabindex="-1" aria-hidden="true" class="sapUiPseudoInvisibleText"><span id="${id}-label" aria-hidden="true" class="sapMSltLabel"><span class="sapMSelectListItemText">${text}</span></span></div>`;
const FORM = (selects) => `<form>
  <label for="a">First name *</label><input id="a" required value="Ada">
  <label for="b">Last name *</label><input id="b" required value="Tester">
  ${selects}</form>`;

async function panel(html, after) {
  const { window } = openPage(JSDOM, html);
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => (message.type === 'panelAllowed' ? { ok: true } : {}), onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  window.document.documentElement.setAttribute('data-jobpilotto-page', 'form');   // judged a form by the fill flow (extension/page-mark.js)
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const pill = () => window.document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.pill b')?.textContent;
  const before = pill();
  if (after) { after(window.document); await new Promise((resolve) => setTimeout(resolve, 3500)); }   // the panel re-reads the page every few seconds
  const result = { before, after: after ? pill() : null };
  window.close();
  return result;
}

test('two shown choices are answered: the panel is "Ready to submit"', { skip: !JSDOM }, async () => {
  const { before } = await panel(FORM(UI5('country', 'Country', 'Switzerland', 'CH') + UI5('news', 'Newsletter', 'No', 'false')));
  assert.equal(before, 'Ready to submit');
});

test('the placeholder item is one left, and the person\'s own pick clears it on the next read', { skip: !JSDOM }, async () => {
  const { before, after } = await panel(FORM(UI5('title', 'Title', 'No Selection', '')), (doc) => {
    doc.getElementById('title-hiddenSelect').textContent = 'Ms.';
    doc.getElementById('title-hiddenInput').value = 'F';
  });
  assert.equal(before, '1 left');
  assert.equal(after, 'Ready to submit');
});
