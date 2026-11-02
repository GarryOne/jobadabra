// The panel on a form the night filled, opened in the morning (owner, 18 Oct 2026, Open in Chrome: "Last night's fill is back"; extension/ready-handoff.js marks the page):
// while the fill puts the night's answers back it says so instead of "Reading this page", and afterwards its subtitle says the fill is last night's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';
import { evalPanel } from './helpers/panel.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();

async function panel({ night, mark }) {
  const { window } = openPage(JSDOM, `<form>
  <label for="a">First name *</label><input id="a" required value="Ada">
  <label for="b">Email *</label><input id="b" type="email" required value="ada@example.com">
  <label for="c">Why us? *</label><textarea id="c" required></textarea>
</form>`);
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => (message.type === 'panelAllowed' ? { ok: true } : {}), onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  if (night) window.document.documentElement.setAttribute('data-jobadabra-night', '1');
  window.document.documentElement.setAttribute('data-jobadabra-page', mark);
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const root = window.document.getElementById('jobadabra-review-host').shadowRoot;
  return { window, pill: () => root.querySelector('.pill b').textContent, sub: () => root.querySelector('.pill small').textContent };
}

test('the night\'s page: "Putting back last night\'s fill" while it fills, then "Last night\'s fill is back"; any other page as before', { skip: !JSDOM }, async () => {
  for (const [night, mark, pill, sub] of [[true, 'reading', /Putting back last night.s fill/, null], [true, 'form', null, /^Last night.s fill is back/], [false, 'reading', /^Reading this page/, null], [false, 'form', null, /^(?!Last night)/]]) {
    const { window, pill: pillOf, sub: subOf } = await panel({ night, mark });
    try {
      if (pill) assert.match(pillOf(), pill, `${night ? 'night' : 'normal'} ${mark}`);
      if (sub) assert.match(subOf(), sub, `${night ? 'night' : 'normal'} ${mark}`);
    } finally { window.close(); }
  }
});
