// Engine answer identities, validation and recording for the enrich question family.
import {familyTests} from './ai-answers-engine-fixtures.mjs';
familyTests(["enrich", "enrich retry", "enrich role"]);

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {questionOf} from '../lib/ai-answers.mjs';
import {engineCases, askOf, bodyOf} from './ai-answers-engine-fixtures.mjs';
test('full extraction, narrowed retry and role refinement cannot borrow rows', () => {
  const cases = engineCases.filter(c => c.operation === 'app.enrich');
  assert.deepEqual(cases.map(c => questionOf(askOf(c), {}).items[0].key), ['default/app.enrich/4adb0a78f6a6472194fb31f117b30922a2e4b5e06a4ac809243ffee49a376e09/full', 'default/app.enrich/4adb0a78f6a6472194fb31f117b30922a2e4b5e06a4ac809243ffee49a376e09/retry-seniority,technologies', 'default/app.enrich/4adb0a78f6a6472194fb31f117b30922a2e4b5e06a4ac809243ffee49a376e09/role']);
  const bad = bodyOf(cases[0]); bad.messages[0].content = bad.messages[0].content.replace('E2E Quality Labs', 'Other employer');
  assert.match(questionOf(askOf(cases[0], bad), {}).unkeyable, /exactly one golden row/);
});
