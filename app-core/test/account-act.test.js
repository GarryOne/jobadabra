// The closer look's two hands (extension/account-act.js): a listed empty text box gets a value, a listed dropdown gets one of its own options; never a password or a box that holds something.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {chooseOption, fillControl} from '../../extension/account-act.js';

function page(html) {
  const {window} = new JSDOM(`<body>${html}</body>`);
  window.HTMLElement.prototype.getClientRects = function () { return this.hasAttribute('hidden') ? [] : [{}]; };   // jsdom has no layout
  Object.assign(globalThis, {document: window.document, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement, Event: window.Event});
  return window.document;
}

test('fill: one empty visible text box found by its label; a password, a filled, a read-only or an unknown box is left alone', () => {
  const doc = page('<label for="e">E-Mail</label><input id="e" type="email"><label for="p">Passwort</label><input id="p" type="password"><label for="v">Vorname</label><input id="v" value="Ada"><input id="r" aria-label="Nur lesen" readonly>');
  let changed = 0; doc.getElementById('e').addEventListener('input', () => { changed += 1; });
  assert.equal(fillControl('e-mail', 'ada@example.test'), 'filled');
  assert.deepEqual([doc.getElementById('e').value, changed], ['ada@example.test', 1]);
  assert.equal(fillControl('Passwort', 'secret'), 'not-a-text-box');
  assert.equal(doc.getElementById('p').value, '');
  assert.equal(fillControl('Vorname', 'Bob'), 'not-empty');
  assert.equal(doc.getElementById('v').value, 'Ada');
  assert.equal(fillControl('Nur lesen', 'x'), 'not-a-text-box');
  assert.equal(fillControl('Nirgends', 'x'), 'not-found');
  assert.equal(fillControl('E-Mail', ''), 'nothing-to-fill');
});

test('choose: a listed native dropdown gets one of its own options; an unknown option or dropdown is refused', () => {
  const doc = page('<label for="c">Land</label><select id="c"><option value="">Bitte wählen</option><option value="CH">Schweiz</option><option value="DE">Deutschland</option></select>');
  assert.equal(chooseOption('land', 'Atlantis'), 'no-such-option');
  assert.equal(doc.getElementById('c').value, '');
  assert.equal(chooseOption('Land', ' schweiz '), 'chosen');
  assert.equal(doc.getElementById('c').value, 'CH');
  assert.equal(chooseOption('Sprache', 'Deutsch'), 'not-found');
});
