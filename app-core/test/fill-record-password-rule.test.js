// A password field is never typed (a safety rule): the fill's record says so, never "no answer in the kit" (a made-up account step; 14 Oct 2026, a pool row whose two
// password boxes read as unexplained and kept a form red although every empty field was left by a rule). The runner's verdict reads the type (desktop/e2e/lib/record-sites.mjs verdictOf).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const FORM = `<form>
  <div class="field"><label for="email">Email *</label><input id="email" type="email" required></div>
  <div class="field"><label for="pw">Choose Password *</label><input id="pw" type="password" required></div>
  <div class="field"><label for="pw2">Retype Password *</label><input id="pw2" type="password" required></div>
</form>`;

test('a required password box is left by the rule, never typed, and its record names the rule', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  const summary = await window.__jobPilottoExtensionFill([], { email: 'ada.tester@example.test' }, null, '', false);
  const rows = Array.from(summary.trace).filter(row => /password/i.test(row.label)).map(row => [row.label, row.outcome, row.reason]);
  const typed = ['pw', 'pw2'].map(id => window.document.getElementById(id).value);
  window.close();
  assert.deepEqual(rows, [['Choose Password', 'left', 'password: never typed, yours to set'], ['Retype Password', 'left', 'password: never typed, yours to set']]);
  assert.deepEqual(typed, ['', ''], 'nothing typed into a password box');
});
