// A typed guess is marked "read it before submitting" at any confidence (owner, 14 Oct 2026: guesses are typed, app-core/src/answer-facts.js typeGuess):
// before, only an answer below high confidence or a long one got the mark, so a guess the AI rated high looked like a stated fact on the page and in the panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const FORM = `<form>
  <label for="s">Desired salary (USD)</label><input id="s" name="salary" required>
  <label for="y">Years with Terraform</label><input id="y" name="years" required>
  <label for="p">Do you have hands-on Python?</label><input id="p" name="python" required>
</form>`;
const claude = (field, value, extra) => ({ field, value, source: 'Claude (on the page)', category: 'normal', use: 'fill', ...extra });

test('a typed guess carries the AI mark at any confidence; a high-confidence answer from a saved fact does not', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  await window.__jobadabraExtensionFill([
    claude('s', '120000', { confidence: 'high', fact: 'none', guess: true }),
    claude('y', '8', { confidence: 'high', fact: 'years_experience' }),
    claude('p', 'Yes', { confidence: 'medium', fact: 'none', guess: true }),
  ], {}, null, '', false);
  const marked = (id) => window.document.getElementById(id).hasAttribute('data-jobadabra-ai');
  assert.deepEqual([marked('s'), marked('y'), marked('p')], [true, false, true]);
  assert.equal(window.document.getElementById('s').value, '120000', 'the guess is typed');
});
