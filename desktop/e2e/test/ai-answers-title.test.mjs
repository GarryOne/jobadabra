// Engine answer identities, validation and recording for the title question family.
import {familyTests} from './ai-answers-engine-fixtures.mjs';
familyTests(["title", "title recheck"]);

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {questionOf} from '../lib/ai-answers.mjs';
import {contextCase, engineCases, askOf} from './ai-answers-engine-fixtures.mjs';
contextCase('title', body => { body.messages[0].content = body.messages[0].content.replace('senior', 'junior'); });
test('first sort and second look have separate item keys', () => {
  const sort = engineCases.find(c => c.name === 'title'), recheck = engineCases.find(c => c.name === 'title recheck');
  assert.notEqual(questionOf(askOf(sort), {}).items[0].key, questionOf(askOf(recheck), {}).items[0].key);
});
