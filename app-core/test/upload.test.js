// page/upload.js keeps a plain-script copy of fileKind and the floor of extension/alias-schema.js (a content script cannot import a module):
// they must agree on every wording, with and without the service's phrases. Also the page rows: an upload slot is a file row named by its meaning.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileKind } from '../../extension/alias-schema.js';
import { loadJsdom, openPage } from './helpers/page.js';

const module = { exports: {} };
new Function('module', 'window', fs.readFileSync(new URL('../../extension/page/upload.js', import.meta.url), 'utf8'))(module, {});
const copy = module.exports;

const LABELS = ['CV', 'Upload your CV *', 'Resume/CV', 'Lebenslauf hochladen', 'Charger un CV', 'Curriculum vitae', 'Cover letter (optional)', 'Anschreiben',
  'Lettre de motivation, certificats', 'Lettera di presentazione', 'Carta de presentación', 'CV / cover letter', 'Add a document', 'Dossier principal', 'Fichier joint', '', '   ',
  'Please attach 2 files', 'Portfolio', 'Diplomas', 'Mein Lebenslauf (PDF)', 'Ajouter un document'];
const PACKS = [[], [{ key: 'resume', phrase: 'dossier principal' }, { key: 'cover_letter', phrase: 'fichier joint' }], [{ key: 'resume', phrase: 'cover letter' }]];

test('the plain-script copy in page/upload.js means the same as alias-schema.js for every wording', () => {
  for (const aliases of PACKS) for (const label of LABELS) assert.equal(copy.fileKind(label, aliases), fileKind(label, aliases), `${JSON.stringify(label)} with ${aliases.length} phrases`);
});

test('an upload slot is a file row named by its meaning, required by the page\'s star, filled once a file is in it', async () => {
  const JSDOM = await loadJsdom();
  if (!JSDOM) return;
  const { window } = openPage(JSDOM, '<div class="field"><label>* Lebenslauf <input type="file" id="a"></label></div><div class="field"><label>Zeugnisse <input type="file" id="b"></label></div><input id="e">');
  const rows = window.__jobPilottoUpload.rows();
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map(row => [row.field, row.type, row.required, row.filled]))), [['resume', 'file', true, false], ['upload_2', 'file', false, false]]);
});

test('with no AI pick among the slots, a slot the page marks required takes the file before an optional one; otherwise page order', () => {
  // flow-checks' replay checks (#531, 13 Oct 2026; recorded cv-to-required-slot-1): an optional "Autofill from resume" box came first and took the CV; the required CV slot stayed empty.
  const slots = [{id: 'autofill', required: false}, {id: 'cv', required: true}, {id: 'letter', required: false}, {id: 'other', required: true}];
  assert.deepEqual(copy.fillOrder(slots).map(slot => slot.id), ['cv', 'other', 'autofill', 'letter']);
  assert.deepEqual(slots.map(slot => slot.id), ['autofill', 'cv', 'letter', 'other'], 'the page\'s own list is not reordered');
});
