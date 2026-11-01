// An upload field the page redraws after the file goes in (its buttons and input dropped, the file chip not drawn yet) is the upload step's question, never one
// "the reader missed": the fill record listed the CV's own title as a required "question on the page not read", left, beside the CV row filled (pool row
// "Databricks (found 2026-10-10)", 14 Oct 2026: 5 left where the page had 3; offline replay of its network record). The upload operator asked about the slot by its
// title (page/upload.js), so the title is read, like the questions the other operators answered (page/fill.js, the coverage read list).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const WIDGET = (id, title, star) => `<div class="field-wrapper"><div role="group" aria-labelledby="upload-label-${id}" aria-required="${star}" class="file-upload">`
  + `<div id="upload-label-${id}" class="label upload-label">${title}${star ? '<span class="required">*</span>' : ''}</div><div class="file-upload__wrapper"><div class="button-container">`
  + `<div class="secondary-button"><div><button type="button" class="btn">Attach</button><label class="visually-hidden" for="${id}">Attach</label><input id="${id}" class="visually-hidden" type="file" accept=".pdf"></div></div>`
  + '<div class="secondary-button"><button type="button" class="btn">Dropbox</button></div></div></div></div></div>';
const FORM = `<form><div class="field-wrapper"><label for="first">First Name<span class="required">*</span></label><input id="first" aria-required="true"></div>${WIDGET('resume', 'Resume/CV', true)}${WIDGET('cover_letter', 'Cover Letter', false)}</form>`;

test('a CV field the page empties while it takes the file is the CV row, filled; never a required question left unread', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  const input = window.document.getElementById('resume');
  // jsdom has no DataTransfer and its input takes only a real FileList: the smallest stand-ins, so the attach runs as in a browser.
  window.DataTransfer = class { constructor() { this.files = []; this.items = {add: file => this.files.push(file)}; } };
  let files = [];
  for (const el of window.document.querySelectorAll('input[type=file]')) Object.defineProperty(el, 'files', {get: () => (el === input ? files : []), set: list => { if (el === input) files = list; }});
  input.addEventListener('change', () => input.closest('.button-container').remove());   // the page drops its buttons and input; its file chip comes later
  const cv = {name: 'cv.pdf', type: 'application/pdf', data: 'JVBERi0xLjQK'};
  // The pass that attaches the file, then a second pass while the field is still empty (the fill passes again when the required count drops: CI replay of
  // upload-widget-counted-once-1, 14 Oct 2026, the second pass 1.8 s after the first, the live page's chip 4.5 s or more after the file).
  for (const pass of ['first', 'second']) {
    const summary = await window.__jobadabraExtensionFill([], {}, cv, '', false);
    const trace = Array.from(summary.trace).map(row => ({...row}));
    assert.deepEqual(trace.filter(row => /resume|^cv$/i.test(row.label)).map(row => [row.label, row.outcome, row.reason]), [['CV', 'filled', '']],
      `${pass} pass: the CV has one row, filled: ${JSON.stringify(trace.map(row => [row.label, row.outcome, row.reason]))}`);
    assert.deepEqual(trace.filter(row => row.type === 'file' && row.label !== 'CV').map(row => [row.label, row.required, row.outcome]), [['Cover Letter', false, 'left']], `${pass} pass`);
  }
  window.close();
});

test('a CV slot that comes back empty after a pass attached the file is filled again, never taken as still holding it', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  window.DataTransfer = class { constructor() { this.files = []; this.items = {add: file => this.files.push(file)}; } };
  let attached = 0;
  const watch = el => { let files = []; Object.defineProperty(el, 'files', {get: () => files, set: list => { files = list; attached += 1; }}); };
  for (const el of window.document.querySelectorAll('input[type=file]')) watch(el);
  const cv = {name: 'cv.pdf', type: 'application/pdf', data: 'JVBERi0xLjQK'};
  await window.__jobadabraExtensionFill([], {}, cv, '', false);
  const field = window.document.getElementById('resume').closest('.field-wrapper');
  field.outerHTML = WIDGET('resume', 'Resume/CV', true);   // the page drew the field again, empty (it refused the file)
  watch(window.document.getElementById('resume'));
  const summary = await window.__jobadabraExtensionFill([], {}, cv, '', false);
  window.close();
  assert.equal(attached, 2, 'the empty slot is given the file again');
  assert.deepEqual(Array.from(summary.trace).filter(row => row.label === 'CV').map(row => row.outcome), ['filled']);
});
