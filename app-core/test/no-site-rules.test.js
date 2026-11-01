// Local site rules are retired (PR B1, owner 28 Oct 2026: "Retire now, no replay"): the form AI reads the Profile and the standard answers,
// never an old 🧠 Form knowledge page, which stays in the store unread.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerContext } from '../src/extension.js';

test('the form AI gets the standard answers alone, never the old Form knowledge notes', async () => {
  const env = { PROFILE_TEXT: 'Retail.', ANSWERS_TEXT: 'Driving license: B', KNOWLEDGE_TEXT: Promise.resolve('[any · answer] Marital status: typed → "Single"'),
    findRow: null, store: { findJob: async () => null } };
  const { standard } = await answerContext(env, 'https://jobs.example.test/1');
  assert.equal(standard, 'Driving license: B');
});
