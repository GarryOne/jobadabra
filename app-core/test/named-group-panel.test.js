// The panel counts a group named only by a label link (hybrid fill move 1, owner 26 Oct 2026; widget zoo chips-no-aria-1) once the fill's reader has read it: one question,
// left until an option is chosen, then no longer left. One reader per control: the fill reads the group (page/radios.js), the panel counts the same group (panel-form.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';
import { evalPanel } from './helpers/panel.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();
const FORM = `<form><label for="a">First name *</label><input id="a" required value="Ada">
  <label for="b">Last name *</label><input id="b" required value="Tester"><label for="c">Email *</label><input id="c" type="email" required value="ada@example.com">
  <label id="model-label">Work model *</label>
  <div class="chips" aria-labelledby="model-label"><span class="chip" tabindex="0">Office</span><span class="chip" tabindex="0">Remote</span></div></form>`;

test('a required group named by aria-labelledby, read by the fill, is counted as left until the fill chose an option', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  for (const chip of window.document.querySelectorAll('.chip')) chip.addEventListener('click', () => chip.classList.toggle('is-on'));
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => (message.type === 'panelAllowed' ? { ok: true } : {}), onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  window.document.documentElement.setAttribute('data-jobpilotto-page', 'form');
  const field = (await window.__jobPilottoDescribeForm()).find((row) => row.label === 'Work model').field;
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const pill = () => window.document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.pill b')?.textContent;
  try { assert.equal(pill(), '1 left'); } catch (error) { window.close(); throw error; }
  await window.__jobPilottoExtensionFill([{ field, value: 'Remote', source: 'kit' }], {}, null, '', false);
  await new Promise((resolve) => setTimeout(resolve, 3500));
  assert.notEqual(pill(), '1 left');
  window.close();
});
