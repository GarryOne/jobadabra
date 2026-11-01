// A UI5 radio group (sap.m.RadioButtonGroup of sap.m.RadioButton): the panel counts it by the choice that is selected, and the fill's pick selects one the panel then reads as answered.
// 15 Oct 2026, the owner's real SuccessFactors fill: the work-permit question was logged "filled" and the panel still listed it as left. Markup written from OpenUI5's
// sap.m.RadioButtonRenderer code (the renderer that site ships), NOT captured from a live page: a div role=radio (aria-checked) holding a native radio input (name = the group's name)
// and its label, inside a role=radiogroup that names the question.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadJsdom, openPage} from './helpers/page.js';
import {evalPanel} from './helpers/panel.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();

const RB = (id, group, text, selected) => `<div id="${id}" class="sapMRb${selected ? ' sapMRbSel' : ''}" role="radio" aria-checked="${selected}" aria-labelledby="${id}-label" tabindex="0"><div class="sapMRbB">` +
  `<input id="${id}-RB" type="radio" tabindex="-1" name="${group}"${selected ? ' checked' : ''}></div><label id="${id}-label" for="${id}-RB">${text}</label></div>`;
const GROUP = (picked) => `<form>
  <label for="a">First name *</label><input id="a" required value="Ada">
  <label for="b">Last name *</label><input id="b" required value="Tester">
  <label for="c">Email *</label><input id="c" type="email" required value="ada@example.test">
  <span id="q">To be eligible to work in Switzerland, which applies to you? *</span>
  <div id="g" class="sapMRbG" role="radiogroup" aria-labelledby="q" aria-required="true">
    ${RB('r1', 'g', 'I am a Swiss or EU citizen', picked === 1)}${RB('r2', 'g', 'I need a work permit', picked === 2)}
  </div></form>`;

async function panel(html, after) {
  const {window} = openPage(JSDOM, html);
  window.chrome = {runtime: {id: 'test', sendMessage: async (message) => (message.type === 'panelAllowed' ? {ok: true} : {}), onMessage: {addListener() {}}}};
  window.document.documentElement.setAttribute('data-jobadabra-page', 'form'); // the fill flow judged this page a form (extension/page-mark.js): only then may the panel say Ready
  window.eval(read('extension/page/skeleton.js'));
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const pill = () => window.document.getElementById('jobadabra-review-host')?.shadowRoot?.querySelector('.pill b')?.textContent;
  const before = pill();
  if (after) { after(window.document); await new Promise((resolve) => setTimeout(resolve, 3500)); }
  const result = {before, after: after ? pill() : null};
  window.close();
  return result;
}

test('a UI5 radio group with a selected choice is answered, with none selected it is one left', {skip: !JSDOM}, async () => {
  assert.equal((await panel(GROUP(1))).before, 'Ready to submit');
  assert.equal((await panel(GROUP(0))).before, '1 left');
});

test('the person\'s own pick clears the row on the next read', {skip: !JSDOM}, async () => {
  const {before, after} = await panel(GROUP(0), (doc) => {
    const radio = doc.getElementById('r2-RB'); radio.checked = true;   // what UI5 does on a tap: the input and the div both say selected
    doc.getElementById('r2').setAttribute('aria-checked', 'true');
  });
  assert.equal(before, '1 left');
  assert.equal(after, 'Ready to submit');
});
