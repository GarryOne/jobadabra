// A factual declaration about the applicant (a public official, a criminal record, a need for accommodation) is a knockout question, not a legal one (owner, 20 Oct 2026):
// filled from a saved answer, otherwise only proposed so the app asks once and remembers; legal stays a consent or certification. Guards the ask's wording and the floors it rests on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DECLARATION_RULE } from '../src/answer-declarations.js';
import { ANSWER_EXAMPLES } from '../src/answer-examples.js';
import { answerForm } from '../src/extension.js';

let seen;
const ask = async (fields, answers) => {
  const client = { messages: { create: async (request) => { seen = request; return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', pay_asks: [], answers }) }] }; } } };
  const env = { PROFILE_TEXT: '# Alex', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '', SEARCH_TEXT: '', CV_FACTS_TEXT: '', store: { findJob: async () => null, kit: async () => null } };
  return (await answerForm(env, { url: 'https://example.com/j', fields, page_text: 'x' }, client)).answers;
};
const answer = (over) => ({ field: 'a', value: 'No', confidence: 'high', note: '', category: 'knockout', use: 'fill', fact: 'none', ...over });
const question = { field: 'a', label: 'Have you been a public official in the last 5 years?', type: 'combobox', required: true, options: ['Yes', 'No'] };

test('the ask says a declaration of fact is a knockout question, never legal, and shows an example', async () => {
  await ask([question], []);
  const system = JSON.stringify(seen.system);
  assert.ok(system.includes(JSON.stringify(DECLARATION_RULE).slice(1, 80)));
  assert.match(DECLARATION_RULE, /never "legal"/);
  assert.ok(ANSWER_EXAMPLES.includes('public official'));
});

test('a declaration with no saved fact behind it is only proposed; one resting on a saved fact is typed; a legal one stays an empty kind', async () => {
  assert.equal((await ask([question], [answer({ fact: 'none' })]))[0].use, 'propose');
  assert.equal((await ask([question], [answer({ fact: 'work_permit' })]))[0].use, 'fill');
  const legal = await ask([{ ...question, type: 'checkbox' }], [answer({ category: 'legal', fact: 'work_permit' })]);
  assert.deepEqual(legal.map((a) => [a.value, a.category, a.use]), [['', 'legal', 'kind']]);
});
