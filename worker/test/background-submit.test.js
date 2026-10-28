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

// Found by the Full automation e2e (28 Oct 2026): extension/page/upload.js marks the input it filled as dataset.jobPilottoFile (attribute data-job-pilotto-file) and only the slot with
// data-jobpilotto-file, so a check that read the second attribute on the input itself called every attached CV "not a saved fact" and handed every application over.
test('a CV the extension attached is a saved fact, by the input mark upload.js writes', async () => {
  const button = {tagName: 'BUTTON', textContent: 'Send application', disabled: false, getClientRects: () => [1], getBoundingClientRect: () => ({left: 0, top: 0, width: 20, height: 20}), contains: el => el === button, click: () => {}};
  const file = {tagName: 'INPUT', type: 'file', name: 'resume', id: 'resume', value: '', required: true, disabled: false, checked: false, files: [{name: 'cv.pdf', size: 3, lastModified: 1}],
    dataset: {jobPilottoFile: 'cv.pdf'}, getClientRects: () => [1], checkValidity: () => true, getAttribute: () => null, closest: () => null};
  globalThis.location = {href: 'https://jobs.example.test/app'};
  globalThis.getComputedStyle = () => ({visibility: 'visible', display: 'block'});
  globalThis.document = {querySelectorAll: query => query.startsWith('button') ? [button] : query.startsWith('input') ? [file] : [], elementFromPoint: () => button, documentElement: {dataset: {}}, title: 'Apply', body: {innerText: 'Apply'}};
  assert.equal((await submissionPage('inspect', {control: 'Send application'})).factsOnly, true, 'the input carries upload.js\'s mark for this very file');
  file.dataset = {jobPilottoFile: 'other.pdf'};
  assert.equal((await submissionPage('inspect', {control: 'Send application'})).factsOnly, false, 'a file the extension did not attach is the person\'s or the page\'s: not a saved fact');
  file.dataset = {};
  assert.equal((await submissionPage('inspect', {control: 'Send application'})).factsOnly, false, 'no mark, no fact');
});
