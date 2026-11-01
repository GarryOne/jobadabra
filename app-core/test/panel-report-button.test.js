// The panel's own labelled "Report this form…" button (owner, 16 Oct 2026: the corner icon alone was not found): hidden until the app says the switch is on, then it opens the report card (extension/review.js, panel-markup.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';
import { evalPanel } from './helpers/panel.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();

async function panel() {
  const { window } = openPage(JSDOM, `<form>
  <label for="a">First name *</label><input id="a" required>
  <label for="b">Last name *</label><input id="b" required>
  <label for="c">Email *</label><input id="c" type="email" required>
</form>`);
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => (message.type === 'panelAllowed' ? { ok: true } : {}), onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  window.document.documentElement.setAttribute('data-jobadabra-page', 'form');
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 60));
  return { window, button: () => window.document.getElementById('jobadabra-review-host').shadowRoot.querySelector('.foot .report-btn') };
}

test('the panel footer has one Report button, always there, opening the same card; a page script cannot press it', { skip: !JSDOM }, async () => {
  const { window, button } = await panel();
  try {
  assert.equal(button().textContent.trim(), 'Report');
  assert.equal(button().hidden, false, 'there before the app says anything');
  assert.equal(window.document.getElementById('jobadabra-review-host').shadowRoot.querySelector('.head .report-flag'), null, 'no header flag');
  let opened = 0;
  window.__jobadabraReport = { open: () => { opened += 1; } };
  button().onclick({ isTrusted: false });   // a page script's click: ignored
  assert.equal(opened, 0);
  button().onclick({ isTrusted: true });   // the person's press (jsdom cannot make a trusted click)
  assert.equal(opened, 1, 'a trusted press opens the report popup');
  } finally { window.close(); }
});

test('the header pins the close button to the right edge in every state, as the last item of a flex row', () => {
  const css = read('extension/panel-markup.js');
  assert.match(css, /\.head \{[^}]*display: flex/, 'the header is a flex row');
  assert.match(css, /\.head \.x \{[^}]*margin-left: auto/, 'the close button, not a sibling that may be removed, takes the free space');
  assert.match(css, /<div class="head">(?:(?!<\/div>).)*<button class="x"[^>]*>×<\/button><\/div>/, 'the close button is the header\'s last child');
});
