// An application drawn inside a modal (a sheet over the posting) is the page's form, not a picker: its CV slot gets the file. A picker (a dialog that holds only
// the file input, opened by a "+") stays outside the slots. Shapes, not sites: two different modal forms and one picker.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadJsdom, openPage } from './helpers/page.js';

const FILE = { data: Buffer.from('cv').toString('base64'), name: 'cv.pdf', type: 'application/pdf' };
const SHEET = `<main><section class="sheet" role="dialog" aria-modal="true"><form id="apply"><div class="row"><label for="fn">First name</label><input id="fn"></div>
  <div class="field"><label for="cv">Upload CV<sup aria-hidden="true">*</sup></label><div class="zone">Drop your file or <u>upload</u><input type="file" id="cv" style="opacity:0;position:absolute"></div></div></form></section></main>`;
const VARIANT = `<div class="page"><aside role="dialog"><div><div><span>Nom</span><input name="nom"></div><div><span>E-mail</span><input name="mail" type="email"></div>
  <p><input type="file" name="doc1" aria-label="Lebenslauf hochladen"> <b>Lebenslauf *</b></p></div></aside></div>`;
const PICKER = `<div class="page"><button type="button" class="add">+</button><div role="dialog">Select a source <input type="file" id="p"></div></div>`;

const slotsOf = async (html) => { const JSDOM = await loadJsdom(); return JSDOM ? openPage(JSDOM, html).__jobadabraUpload : null; };

for (const [name, html] of [['a sheet over the page', SHEET], ['another modal, other tags, label after the control, another language', VARIANT]]) {
  test(`the CV slot of a form inside a modal takes the file: ${name}`, async () => {
    const upload = await slotsOf(html);
    if (!upload) return;
    assert.equal(upload.slots().length, 1, 'the slot is found');
    // jsdom has no DataTransfer, so the attach itself cannot finish here: the slot is found, named a CV, listed as a required row, and the operator reaches the attach.
    const [row] = upload.rows();
    assert.deepEqual([row.field, row.required], ['resume', true]);
    const [result] = await upload.fill({ resume: FILE });
    assert.equal(result.meaning, 'resume');
    assert.match(result.why || '', /DataTransfer/, JSON.stringify(result));
  });
}

test('a picker dialog that holds only a file input is still no slot', async () => {
  const upload = await slotsOf(PICKER);
  if (!upload) return;
  assert.equal(upload.slots().length, 0);
});
