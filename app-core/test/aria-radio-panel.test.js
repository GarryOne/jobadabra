// The panel counts an ARIA radio group whose options hold an aria-hidden native input (Workable's Yes/No questions on Starling Bank: role=radiogroup > role=radio > input type=radio aria-hidden):
// one required question each, left until an option is chosen. 17 Oct 2026, the Starling recording: the fill listed 8 required left, the panel "4 left" (the radios were never counted), so only
// the AI's veto kept the ending from saying ready. Markup shaped like the recorded page (apply.workable.com), reduced. Guard for panel-form.js fields().
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';
import { evalPanel } from './helpers/panel.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();


// The markup of one question as the recorded page has it (classes and styles dropped): the title carries the star, each option wraps a hidden input and names itself by the title and its own word.
const RADIO = (id, label, checked = '') => `<div><div><span><span><strong>*</strong></span><span><span id="${id}_label"><strong>${label}</strong></span></span></span><div><fieldset role="radiogroup" data-ui="${id}" aria-labelledby="${id}_label">` +
  ['YES', 'NO'].map((word) => `<div data-ui="option" aria-labelledby="${id}_label ${id}_${word}" id="wrapper_${id}_${word}" role="radio" aria-checked="${checked === word ? 'true' : 'false'}" aria-required="true" tabindex="0"><label><input aria-required="true" required="" id="${id}_in_${word}" tabindex="-1" aria-hidden="true" type="radio" name="${id}" dir="auto"${checked === word ? ' checked' : ''}><div><div><span id="${id}_${word}">${word}</span></div></div></label></div>`).join('') + '</fieldset></div></div></div>';
const FORM = (radios) => `<form>
  <label for="a">First name *</label><input id="a" required value="Ada">
  <label for="b">Last name *</label><input id="b" required value="Tester">
  ${radios}</form>`;

async function panel(html, after) {
  const { window } = openPage(JSDOM, html);
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => (message.type === 'panelAllowed' ? { ok: true } : {}), onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  window.document.documentElement.setAttribute('data-jobpilotto-page', 'form');
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const pill = () => window.document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.pill b')?.textContent;
  const before = pill();
  if (after) { after(window.document); await new Promise((resolve) => setTimeout(resolve, 3500)); }
  const result = { before, after: after ? pill() : null };
  window.close();
  return result;
}

test('required ARIA radio groups with hidden inputs are counted as left, not ready', { skip: !JSDOM }, async () => {
  const { before } = await panel(FORM(RADIO('g1', 'Will you require sponsorship?') + RADIO('g2', 'Have you worked here before?')));
  assert.equal(before, '2 left');
});

test('an answered group is no longer left, on the next read', { skip: !JSDOM }, async () => {
  const { before, after } = await panel(FORM(RADIO('g1', 'Will you require sponsorship?')), (doc) => {
    const option = doc.querySelectorAll('[role=radio]')[1];
    option.setAttribute('aria-checked', 'true');
    option.querySelector('input').checked = true;
  });
  assert.equal(before, '1 left');
  assert.equal(after, 'Ready to submit');
});
