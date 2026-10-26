// Guards lib/review-checklist.mjs: the checklist request a Claude model gets, and which checklist answers become findings.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CHECKS, CHECK_SYSTEM, checklistRequest, checksToFindings} from '../lib/review-checklist.mjs';

test('the checklist request names every check and carries the picture, the page and the effort', () => {
  const request = checklistRequest({view: 'jobs', pngBase64: 'x', lessons: 'LESSON', model: 'claude-haiku-5-5', effort: 'high'});
  assert.equal(request.model, 'claude-haiku-5-5');
  assert.deepEqual(request.output_config, {effort: 'high'});
  assert.ok(request.max_tokens >= 12000);
  for (const [id] of CHECKS) assert.ok(CHECK_SYSTEM.includes(id), id);
  const [picture, text] = request.messages[0].content;
  assert.equal(picture.type, 'image');
  assert.match(text.text, /Page: jobs[\s\S]*LESSON[\s\S]*Go through every check/);
  assert.equal(checklistRequest({view: 'jobs', pngBase64: 'x', model: 'm'}).output_config, undefined);
});

test('only a "yes" with quoted evidence becomes a finding', () => {
  const answer = JSON.stringify({checks: [
    {id: 'count-mismatch', answer: 'yes', where: 'header', evidence: '"6 recent" but 3 rows listed'},
    {id: 'cut-off', answer: 'yes', where: 'chip', evidence: ''},
    {id: 'raw-technical', answer: 'no', where: '', evidence: 'nothing technical shown'}]});
  assert.deepEqual(checksToFindings(`Here: ${answer}`), [{title: 'count-mismatch: header', detail: '"6 recent" but 3 rows listed'}]);
  assert.deepEqual(checksToFindings('not json'), []);
});
