// The AI's reading of what a contact box means wins over the quick step's label pattern (owner, 27 Oct 2026, "AI reads contact boxes"; benchmark fair round,
// form 103: "Preferred First & Last Name" was typed "Tester", the pattern matched "Last Name" in the label). Contact boxes ride along in the answers call made
// anyway (extension/flow.js openQuestions); page/fill.js types the AI's answer where it disagrees with the pattern's value, in the same pass or over the box the
// quick step typed earlier; an agreeing answer changes nothing, and a box the person edited is never retyped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const PROFILE = {first_name: 'Ada', last_name: 'Tester', full_name: 'Ada Tester', email: 'ada.tester@example.test'};
const FORM = `<form>
  <label for="legal-first">Legal First Name</label><input id="legal-first" name="legal-first" required>
  <label for="preferred">Preferred First &amp; Last Name</label><input id="preferred" name="preferred">
  <label for="email">Email</label><input id="email" name="email" type="email" required>
</form>`;
const ai = (field, value) => ({field, value, use: 'fill', confidence: 'high', category: 'contact', fact: 'contact', source: 'Claude (on the page)'});
const valueOf = (window, id) => window.document.getElementById(id).value;

test('the AI\'s reading wins in the same pass where it disagrees; an agreeing answer leaves the pattern\'s value', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  await window.__jobPilottoExtensionFill([ai('preferred', 'Ada Tester'), ai('legal-first', 'Ada'), ai('email', 'ada.tester@example.test')], PROFILE, null, '', false);
  assert.equal(valueOf(window, 'preferred'), 'Ada Tester');
  assert.equal(valueOf(window, 'legal-first'), 'Ada');
  assert.equal(valueOf(window, 'email'), 'ada.tester@example.test');
});

test('the AI\'s later answer replaces what the quick step typed (the answers come after the first fill)', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  await window.__jobPilottoExtensionFill([], PROFILE, null, '', false);
  assert.equal(valueOf(window, 'preferred'), 'Tester', 'the quick step alone reads the label pattern (the old behaviour this fixes)');
  const summary = await window.__jobPilottoExtensionFill([ai('preferred', 'Ada Tester'), ai('email', 'ada.tester@example.test')], {}, null, '', false);
  assert.equal(valueOf(window, 'preferred'), 'Ada Tester');
  assert.equal(valueOf(window, 'email'), 'ada.tester@example.test');
  assert.equal(summary.trace.find((row) => row.label === 'Preferred First & Last Name')?.outcome, 'filled');
});

test('a box the person edited after the quick step is never retyped by the AI\'s answer', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  await window.__jobPilottoExtensionFill([], PROFILE, null, '', false);
  const box = window.document.getElementById('preferred');
  box.value = 'Ada T.';
  box.removeAttribute('data-jobpilotto-typed');   // what the person's own typing does (browser-form-fastpath.js follow: a trusted input event)
  await window.__jobPilottoExtensionFill([ai('preferred', 'Ada Tester')], {}, null, '', false);
  assert.equal(valueOf(window, 'preferred'), 'Ada T.');
});
