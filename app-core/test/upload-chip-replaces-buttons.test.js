// A file field whose buttons are replaced by a chip once the file is attached (the page redraws the field and drops its own input): one slot, answered, never an unread question
// (measuring run 38377619987 / 38377636685, 13 Oct 2026: the CV was in and the page showed it, yet the record kept a file row and an unread-question row for it). Recorded:
// upload-buttons-replaced-by-chip-1. The reader asks for no wording: a file name shown in an area whose only controls are buttons.
import assert from 'node:assert/strict';
import test from 'node:test';
import {loadJsdom, openPage} from './helpers/page.js';

const JSDOM = await loadJsdom();
const FIELD = (inner, id = 'resume') => `<div class="field" id="${id}-field"><div class="label" id="${id}-label">Resume/CV <span class="req">*</span></div><div class="upload" role="group" aria-labelledby="${id}-label">${inner}</div></div>`;
const CHIP = '<div class="chip file-chip"><span class="name">cv.pdf</span><button type="button" class="remove" aria-label="Remove file">&times;</button></div>';
const BUTTONS = '<div class="actions"><button type="button">Attach</button><button type="button">Dropbox</button><button type="button">Enter manually</button></div><div class="hint">Accepted file types: pdf, doc, docx, txt, rtf</div>';
const unread = (window, read = []) => JSON.parse(JSON.stringify(window.__jobadabraCoverage.unread(window.document, read, () => true).map(item => item.question)));

test('a required file field showing a file chip is not an unread question; the same field with its buttons still is not listed as a question either', { skip: !JSDOM }, () => {
  const chip = openPage(JSDOM, `<form><div class="field"><label for="e">Email *</label><input id="e"></div>${FIELD(CHIP)}</form>`);
  assert.deepEqual(unread(chip, ['Email']), [], 'the chip\'s remove button is not a control that answers a question');
  const buttons = openPage(JSDOM, `<form><div class="field"><label for="e">Email *</label><input id="e"></div>${FIELD(BUTTONS)}</form>`);
  assert.deepEqual(unread(buttons, ['Email']), ['Resume/CV'], 'before the attach the field still lists as before (the buttons are pressables of a question)');
});

test('a question with a text box and a remove button next to a file name stays a question', { skip: !JSDOM }, () => {
  const window = openPage(JSDOM, '<form><div class="field"><div class="label">Portfolio link *</div><input id="p"><span>see cv.pdf</span><button type="button">Clear</button></div></form>');
  assert.deepEqual(unread(window), ['Portfolio link']);
});

test('a slot of buttons only that shows the file we attached is filled, though the page redrew the field and the element mark is gone', { skip: !JSDOM }, () => {
  const shown = openPage(JSDOM, `<form>${FIELD(CHIP)}</form>`);
  assert.equal(shown.__jobadabraUpload.rows()[0].filled, false, 'a name shown that we did not attach is not proof');
  shown.__jobadabraAttached = new Set(['cv.pdf']);
  assert.equal(shown.__jobadabraUpload.rows()[0].filled, true, 'the name we attached is shown in the slot: it holds the file');
  const hidden = openPage(JSDOM, `<form>${FIELD(BUTTONS)}</form>`);
  hidden.__jobadabraAttached = new Set(['cv.pdf']);
  assert.equal(hidden.__jobadabraUpload.rows()[0].filled, false, 'our mark alone, with no file shown, is not a file');
});

test('a second pass over a slot that shows our file presses nothing and says it holds the file', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, `<form>${FIELD(CHIP)}</form>`);
  window.__jobadabraAttached = new Set(['cv.pdf']);
  let pressed = 0;
  window.document.querySelector('.remove').addEventListener('click', () => { pressed += 1; });
  const results = await window.__jobadabraUpload.fill({resume: {data: 'AAAA', name: 'cv.pdf'}, coverLetter: null});
  assert.deepEqual(JSON.parse(JSON.stringify(results.map(row => [row.meaning, row.ok, row.why]))), [['resume', true, 'already holds a file']]);
  assert.equal(pressed, 0, 'the remove button is never pressed');
});
