// An answer to a question asked in several wordings is saved for every wording, in every place an answer is given (owner, 17 Oct 2026): the drawer, the one
// place since 28 Oct 2026 (the Jobs cards and Profile → What we learned only open it). A place that saves without these functions fails the source check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {alsoKeys} from '../renderer/question-wordings.js';

const row = {key: 'k1', item: {id: 'i1'}, question: 'When can you start?', also: [{key: 'k2', item: {id: 'i2'}}, {key: 'k3', item: {id: 'i3'}}]};
const lone = {key: 'k9', item: {id: 'i9'}, question: 'Visa?'};

const PLACES = {
  'the drawer': r => alsoKeys(r),
};
for (const [place, others] of Object.entries(PLACES)) {
  test(`${place}: every other wording gets the answer; a lone question none`, () => {
    assert.deepEqual(others(row), ['k2', 'k3']);
    assert.deepEqual(others(lone), []);
  });
}

test('the places that save an answer use the shared functions', () => {
  const pages = path.join(path.dirname(fileURLToPath(import.meta.url)), '../renderer/pages');
  assert.match(fs.readFileSync(path.join(pages, 'question-review.js'), 'utf8'), /alsoKeys\(/);
  // the Jobs cards and What we learned's New rows never save an open question: they only open the drawer
  assert.doesNotMatch(fs.readFileSync(path.join(pages, 'jobs-questions.js'), 'utf8'), /answerQuestion|setAnswer/);
  assert.doesNotMatch(fs.readFileSync(path.join(pages, 'application-answers.js'), 'utf8'), /answerQuestion/);
});
