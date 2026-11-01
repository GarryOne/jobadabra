// The fill's record counts EVERY required control the page has (13 Oct 2026, the Recruitee form on Channable, #507 after-run 38325169221: the page had 6 required controls empty, the
// record 4): a required upload that is not the CV (a motivation letter) had no row, and a required video-recorder widget (a group with a button and no input of its own) was traced
// "filled". Same class as the Ashby undercount (a110501): a required control the fill has no answer kind for is still a row, left, with its own reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const FORM = `<form>
  <div class="field"><label for="first" class="required">First name *</label><input id="first" name="first" required></div>
  <div class="field"><label for="resume">CV *</label><input type="file" id="resume" required></div>
  <div class="field"><label for="letter">Can you please attach your motivational letter? *</label><input type="file" id="letter" required></div>
  <div class="field"><label for="photo">Photo (optional)</label><input type="file" id="photo"></div>
  <div class="field"><div id="intro" role="group" aria-required="true" aria-labelledby="intro-title"><h3 id="intro-title">Tell us about yourself in a short video *</h3><button type="button">Record video</button></div></div>
</form>`;

async function traceOf() {
  const window = openPage(JSDOM, FORM);
  const summary = await window.__jobPilottoExtensionFill([], {}, null, '', false);
  window.close();
  return Array.from(summary.trace).map(row => ({...row}));
}

test('a required upload that is not the CV is a row: left, "upload: no file for this question"', { skip: !JSDOM }, async () => {
  const row = (await traceOf()).find(one => /motivational letter/i.test(one.label));
  assert.ok(row, 'the record has a row for it');
  assert.deepEqual([row.required, row.type, row.outcome, row.reason], [true, 'file', 'left', 'upload: no file for this question']);
});

test('an optional upload with nothing for it is a row too, never counted as missing (required: false)', { skip: !JSDOM }, async () => {
  const row = (await traceOf()).find(one => /^photo/i.test(one.label));
  assert.ok(row);
  assert.deepEqual([row.required, row.outcome], [false, 'left']);
});

test('a required group with no control the fill can answer (a recorder) is left for the person, never filled by another question\'s box', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  window.document.getElementById('first').value = 'Ada';   // another question's box holds a value: the recorder's area is shared with it
  const summary = await window.__jobPilottoExtensionFill([], {}, null, '', false);
  const row = Array.from(summary.trace).find(one => /short video/i.test(one.label));
  window.close();
  assert.ok(row, 'the record has a row for it');
  assert.deepEqual([row.required, row.outcome, row.reason], [true, 'left', 'question on the page not read']);
});

test('the CV keeps its one row (the CV slot is not counted twice)', { skip: !JSDOM }, async () => {
  const rows = (await traceOf()).filter(one => one.type === 'file' && /^cv$/i.test(one.label));
  assert.equal(rows.length, 1);
});
