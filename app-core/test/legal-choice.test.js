// A question the AI calls legal that the form answers with a choice among options (a select, radio group or dropdown) goes the Answer-once way (owner, 20 Oct 2026: "Ask once, remember"):
// typed from a saved answer, otherwise asked once; only a lone tick (a checkbox) or typed text stays the person's. Structure only: the field's type, never its words.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerForm } from '../src/extension.js';
import { LEGAL_CHOICE_RULE } from '../src/answer-declarations.js';

let seen;
const ask = async (fields, answers) => {
  const client = { messages: { create: async (request) => { seen = request; return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', pay_asks: [], answers }) }] }; } } };
  const env = { PROFILE_TEXT: '# Alex', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '', SEARCH_TEXT: '', CV_FACTS_TEXT: '', store: { findJob: async () => null, kit: async () => null } };
  return (await answerForm(env, { url: 'https://example.com/j', fields, page_text: 'x' }, client)).answers;
};
const answer = (over) => ({ field: 'a', value: 'No', confidence: 'high', note: '', category: 'legal', use: 'fill', fact: 'other_saved', ...over });
const field = (type) => ({ field: 'a', label: 'Do you hold a public office?', type, required: true, options: type === 'combobox' ? [] : ['Yes', 'No'] });
const CHOICES = ['select', 'radio', 'combobox'];

test('the ask tells the AI a legal-looking choice is answered only from saved answers', async () => {
  await ask([field('select')], []);
  assert.ok(JSON.stringify(seen.system).includes(JSON.stringify(LEGAL_CHOICE_RULE).slice(1, 80)));
});

test('a legal answer on a choice field rests on the saved answer: typed with one, never guessed', async () => {
  for (const type of CHOICES) {
    const saved = await ask([field(type)], [answer()]);
    assert.deepEqual(saved.map((a) => [a.value, a.use]), [['No', 'fill']], `${type} saved`);
    const guess = await ask([field(type)], [answer({ fact: 'none' })]);
    assert.ok(guess.every((a) => a.category !== 'legal' && a.use !== 'fill'), `${type} guess`);
  }
});

test('a legal choice with no answer is not a held kind: it is left unmarked, so the fill says "no answer" and the app asks once', async () => {
  for (const type of CHOICES) {
    const got = await ask([field(type)], [answer({ value: '', fact: 'none' })]);
    assert.ok(!got.some((a) => a.category === 'legal' && a.use === 'kind'), type);
  }
});

test('a lone tick or typed text called legal stays an empty kind, whatever the use', async () => {
  for (const type of ['checkbox', 'text', 'textarea']) for (const use of ['fill', 'propose']) {
    const got = await ask([field(type)], [answer({ use })]);
    assert.deepEqual(got.map((a) => [a.value, a.category, a.use]), [['', 'legal', 'kind']], `${type} ${use}`);
  }
});
