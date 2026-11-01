// An answer the AI gave for a field id that is gone (the page re-created its controls between the ask and the second pass: SAP UI5 gives each a new generated id) goes to the ONE row with the
// same question, and the fill says how many answers reached a row (counts only). 15 Oct 2026, the owner's SuccessFactors fill: the newsletter and talent-pool selects were proposed
// but their rows read "no answer in the kit". Never two rows with one question: then it is lost, not guessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadJsdom, openPage} from './helpers/page.js';

const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom is not installed here (run npm install in worker/)';
const PAGE = `<form><label for="__input31-inner">Team name *</label><input id="__input31-inner" type="text" required>
  <label for="__input32-inner">Project code *</label><input id="__input32-inner" type="text" required></form>`;

const rowOf = (summary, label) => Array.from(summary.trace).find((row) => row.label === label);

test('an answer for a gone id is typed in the row with the same question; a proposal reads as proposed', {skip}, async () => {
  const window = openPage(JSDOM, PAGE);
  const summary = await window.__jobadabraExtensionFill([
    {field: '__input1-inner', value: 'Platform', question: 'Team name', source: 'Claude (on the page)', use: 'fill'},
    {field: '__input2-inner', value: 'P4711', question: 'Project code', source: 'Claude (on the page)', use: 'propose'},
  ], {}, null, '', false);
  assert.equal(rowOf(summary, 'Team name').outcome, 'filled');
  assert.equal(window.document.getElementById('__input31-inner').value, 'Platform');
  assert.equal(rowOf(summary, 'Project code').reason, 'proposed for you to confirm');
  assert.deepEqual({...summary.reach}, {asked: 2, matched: 0, byQuestion: 2, lost: 0});
  window.close();
});

test('two rows with one question are not told apart: the answer is lost, never guessed', {skip}, async () => {
  const window = openPage(JSDOM, PAGE.replace('Project code', 'Team name'));
  const summary = await window.__jobadabraExtensionFill([{field: '__input1-inner', value: 'Platform', question: 'Team name', source: 'Claude (on the page)', use: 'fill'}], {}, null, '', false);
  assert.equal(window.document.getElementById('__input31-inner').value, '');
  assert.deepEqual({...summary.reach}, {asked: 1, matched: 0, byQuestion: 0, lost: 1});
  window.close();
});

test('an answer whose id is still on the page is matched by id, as before', {skip}, async () => {
  const window = openPage(JSDOM, PAGE);
  const summary = await window.__jobadabraExtensionFill([{field: '__input31-inner', value: 'Platform', question: 'Project code', source: 'Claude (on the page)', use: 'fill'}], {}, null, '', false);
  assert.equal(window.document.getElementById('__input31-inner').value, 'Platform');
  assert.deepEqual({...summary.reach}, {asked: 1, matched: 1, byQuestion: 0, lost: 0});
  window.close();
});
