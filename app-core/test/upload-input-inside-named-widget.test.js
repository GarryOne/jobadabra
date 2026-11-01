// An upload widget whose hidden file input sits under its own "Attach" button, inside a wrapper whose class names uploading, next to more source buttons
// (Dropbox, Enter manually): ONE slot titled by the field's label, never a second slot for the same widget. Pool row "Databricks (found 2026-10-10)", 14 Oct 2026:
// the input and the wrapper's buttons were two starts that stopped each other's climb, so each Cover Letter widget gave two rows ("Dropbox Enter manually…"
// and "Cover Letter Attach…"), and the fill record counted 2 phantom upload rows as left. Guards extension/page/skeleton.js uploadSlots.
import assert from 'node:assert/strict';
import test from 'node:test';
import {loadJsdom, openPage} from './helpers/page.js';

const JSDOM = await loadJsdom();
const WIDGET = (id, title, star) => `<div class="field-wrapper"><div role="group" aria-labelledby="upload-label-${id}" aria-required="${star}" class="file-upload">`
  + `<div id="upload-label-${id}" class="label upload-label">${title}${star ? '<span class="required">*</span>' : ''}</div><div class="file-upload__wrapper"><div class="button-container">`
  + `<div class="secondary-button"><div><button type="button" class="btn">Attach</button><label class="visually-hidden" for="${id}">Attach</label><input id="${id}" class="visually-hidden" type="file" accept=".pdf"></div></div>`
  + `<div class="secondary-button"><button type="button" class="btn">Dropbox</button></div>`
  + `<div class="secondary-button"><button type="button" class="btn">Enter manually</button><label class="visually-hidden" for="${id}_text">Enter manually</label></div></div>`
  + '<p class="file-upload__filetypes">Accepted file types: pdf, doc, docx, txt, rtf</p></div></div></div>';
const PAGE = `<form><div class="field-wrapper"><label for="first">First Name*</label><input id="first"></div>${WIDGET('resume', 'Resume/CV', true)}${WIDGET('cover_letter', 'Cover Letter', false)}</form>`;

test('a file input under its own button, in a wrapper named for uploads, is one slot per widget, titled by the field\'s label', {skip: !JSDOM}, () => {
  const window = openPage(JSDOM, PAGE);
  const slots = window.__jobPilottoUpload.slots();
  assert.equal(slots.length, 2, `one slot per widget, got ${JSON.stringify(slots.map(slot => slot.title))}`);
  assert.deepEqual(JSON.parse(JSON.stringify(slots.map(slot => slot.input?.id))), ['resume', 'cover_letter'], 'each slot keeps its own file input');
  assert.match(slots[0].title, /^Resume\/CV/);
  assert.match(slots[1].title, /^Cover Letter/);
  const rows = JSON.parse(JSON.stringify(window.__jobPilottoUpload.rows().map(row => [row.field, row.required])));
  assert.deepEqual(rows, [['resume', true], ['cover_letter', false]]);
});
