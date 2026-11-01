// Engine answer identities, validation and recording for the places question family.
import {familyTests} from '../ai-answers-engine-fixtures.mjs';
familyTests(["places"]);

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {questionOf} from '../../lib/ai-answers.mjs';
import {engineCases, askOf, bodyOf} from '../ai-answers-engine-fixtures.mjs';
test('places keys are the normalized words themselves and ambiguous aliases refuse', () => {
  const c = engineCases.find(c => c.name === 'places');
  assert.deepEqual(questionOf(askOf(c), {}).items.map(item => item.key), ['zurich', 'paris']);
  const alias = bodyOf({...c, user: 'Place words (JSON): ["\\bz[uü]rich area\\b"]'});
  // Construct JSON so regex wrappers are real backslash characters on the wire.
  alias.messages[0].content = 'Place words (JSON): ' + JSON.stringify(['\\bz[uü]rich area\\b']);
  assert.equal(questionOf(askOf(c, alias), {}).items[0].key, 'zurich area');
  assert.match(questionOf(askOf(c, bodyOf({...c, user: 'Place words (JSON): ["Zürich", "Zurich"]'})), {}).unkeyable, /duplicate/);
});
