// A failed read of the open questions must say why and offer Retry (UI loop #135; since insights PR 1c a row of the Jobs bar and Focus, no longer a card).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {questionEntries} from '../renderer/question-entries.js';

const page = fs.readFileSync(new URL('../renderer/pages/focus-suggestions.js', import.meta.url), 'utf8');

test('a failed read shows one row that says why and has a Retry wired to loadQuestions', () => {
  const rows = questionEntries({error: 'notion 500'});
  assert.deepEqual(rows.map(row => row.kind), ['questions-error'], 'one row, no counts beside it');
  assert.match(rows[0].detail, /Couldn't read your questions/);
  assert.deepEqual(rows[0].actions.map(action => [action.label, action.do]), [['Retry', 'retry_questions']]);
  assert.match(page, /retry_questions: \(\) => loadQuestions\(\{force: true\}\)/);
  assert.deepEqual(questionEntries({error: 'Connect Notion first'}), [], 'the store not connected yet: nothing to retry');
});
