// The fill's per-field record settled at the end (extension/trace-settle.js): what the page holds once every pass is done (8 Oct 2026, the live
// twin: Coop's "Formule d'appel" logged "left" twice while the page held the chosen "Monsieur").
import test from 'node:test';
import assert from 'node:assert/strict';
import { settleTrace } from '../../extension/trace-settle.js';

const row = (label, outcome, extra = {}) => ({ label, type: 'combobox', outcome, source: 'kit', reason: outcome === 'left' ? 'dropdown that opens only on a real click' : '', ...extra });

test('one row per field; a fill is not undone by a later pass saying "left"', () => {
  const settled = settleTrace([row('Formule', 'filled'), row('Formule', 'left', { source: 'Claude (on the page)' }), row('SMS', 'left')]);
  assert.equal(settled.length, 2);
  assert.equal(settled.find((r) => r.label === 'Formule').outcome, 'filled');
});

test('the page at the end decides: filled meanwhile (a menu picked) is filled, empty again is left', () => {
  const settled = settleTrace([row('Formule', 'left'), row('Pays', 'filled', { type: 'select' })],
    [{ label: 'Formule', filled: true }, { label: 'Pays', filled: false }]);
  assert.deepEqual(settled.map((r) => [r.label, r.outcome, r.reason]),
    [['Formule', 'filled', 'filled by the end of the fill'], ['Pays', 'left', 'empty again at the end of the fill']]);
});

test('passwords and files keep their own outcome; no final read leaves the rows to decide', () => {
  const settled = settleTrace([row('Mot de passe', 'filled', { type: 'password' }), row('CV', 'filled', { type: 'file' })],
    [{ label: 'Mot de passe', filled: false }, { label: 'CV', filled: false }]);
  assert.ok(settled.every((r) => r.outcome === 'filled'));
  assert.equal(settleTrace([row('A', 'left')], null)[0].outcome, 'left');
});

test('a box the page kept emptying says so in its reason', () => {
  const settled = settleTrace([row('Prénom', 'filled', { type: 'text' }), row('Nom', 'filled', { type: 'text' })],
    [{ label: 'Prénom', field: 'first', filled: false }, { label: 'Nom', field: 'last', filled: false }], [{ field: 'first', times: 5 }]);
  assert.match(settled[0].reason, /^empty again at the end of the fill: the page emptied it after we typed it 5 times/);
  assert.equal(settled[1].reason, 'empty again at the end of the fill');
});
