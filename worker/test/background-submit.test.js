// Final action uses the server's exact control and the same local value seal; missing/changed/unsafe forms are never clicked.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {submissionPage} from '../../extension/background-submit.js';

test('final click requires one visible named control, valid fields, unchanged seal and no password/unfinished draft', async () => {
  let clicks = 0;
  const field = {tagName: 'INPUT', type: 'text', name: 'first', id: 'first', value: 'Fictional', required: true, disabled: false, checked: false, getClientRects: () => [1], checkValidity: () => true};
  const button = {tagName: 'BUTTON', textContent: 'Send application', disabled: false, getClientRects: () => [1], getBoundingClientRect: () => ({left: 0, top: 0, width: 20, height: 20}), contains: el => el === button, click: () => { clicks++; }};
  globalThis.location = {href: 'https://jobs.example.test/app'};
  globalThis.getComputedStyle = () => ({visibility: 'visible', display: 'block'});
  globalThis.document = {querySelectorAll: query => query.startsWith('button') ? [button] : query.startsWith('input') ? [field] : [], elementFromPoint: () => button, documentElement: {dataset: {}}, title: 'Apply', body: {innerText: 'Apply Send application'}};
  const proof = await submissionPage('inspect', {control: 'Send application'});
  assert.equal(proof.factsOnly, false, 'a site-preselected value with no saved-fact evidence is unknown');
  field.getAttribute = name => name === 'data-jobpilotto-grounding' ? 'known' : null;
  assert.equal((await submissionPage('inspect', {control: 'Send application'})).factsOnly, true);
  assert.equal(proof.requiredComplete, true);
  assert.equal(proof.safe, true);
  assert.equal((await submissionPage('press', {control: 'Send application', seal: proof.seal})).pressed, true);
  assert.equal(clicks, 1);
  field.value = 'Changed';
  assert.equal((await submissionPage('press', {control: 'Send application', seal: proof.seal})).pressed, false);
  field.type = 'password';
  assert.equal((await submissionPage('inspect', {control: 'Send application'})).safe, false);
  field.type = 'text'; field.checkValidity = () => false;
  assert.equal((await submissionPage('inspect', {control: 'Send application'})).requiredComplete, false);
  assert.equal(clicks, 1);
});
