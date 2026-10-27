// Answers from saved facts (worker/src/answer-facts.js, 12 Oct 2026): every answer names the saved fact it rests on, a typed answer that names
// none is only proposed, and on this Mac's store the ask gets the job and its drafted kit (before, a SQLite user's ask got neither).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACT_KEYS, FACT_RULE, typeGuess } from '../src/answer-facts.js';

const reply = (answers) => ({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, billing: 'subscription' },
  content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers }) }] });
const fakeClient = (answers, seen = []) => ({ messages: { create: async (request) => { seen.push(request); return reply(answers); } } });
const env = { PROFILE_TEXT: 'Work permit: EU citizen', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '' };
const fields = [{ field: 'permit', label: 'Do you need sponsorship to work in Switzerland?', type: 'radio', options: ['Yes', 'No'], required: true },
  { field: 'heard', label: 'How did you hear about us?', type: 'select', options: ['Website', 'Friend'], required: true }];

test('the fact list is closed, ends with "none", and the schema requires one of it on every answer', async () => {
  const { ANSWER_SCHEMA_FOR_TESTS: schema } = await import('../src/extension.js');
  const item = schema.properties.answers.items;
  assert.ok(item.required.includes('fact'));
  assert.deepEqual(item.properties.fact.enum, FACT_KEYS);
  assert.equal(FACT_KEYS.at(-1), 'none');
  assert.equal(new Set(FACT_KEYS).size, FACT_KEYS.length);
});

test('the prompt sets an answer that follows from a saved fact and proposes only what no saved fact settles', async () => {
  const seen = [];
  const { answerForm } = await import('../src/extension.js');
  await answerForm(env, { url: 'https://example.test/job/1', fields }, fakeClient([], seen));
  const system = seen[0].system[0].text;
  assert.ok(system.includes(FACT_RULE));
  assert.match(FACT_RULE, /follows from what they state/);
  assert.match(FACT_RULE, /use: "propose" and fact "none"/);
  assert.match(FACT_RULE, /place typed into a free-text box is written in the applicant's own saved words, never translated/);   // the identity floor types a place only in the saved words (a French form's "Zurich, Suisse" was proposed, 14 Oct 2026)
  assert.match(FACT_RULE, /a number box that names no currency asks in the currency of the job's country; a free-text box whose question names neither a currency nor a period is asked in the stated target's own/);   // fair round form 106, 27 Oct 2026: a free-text salary box was left empty, held for a conversion it did not need
  assert.match(FACT_RULE, /settled only when the job's text or the form names that place; when neither does, it is a proposal/);
  assert.match(FACT_RULE, /hands-on experience with a skill, tool, language or technology[^;]*when the CV or Profile lists it \(answer yes[^)]*not a no: it is a proposal\)/);   // a CV-listed skill answers its yes/no and "which tools" questions (bake-off 15 Oct 2026: Python/Go and CI/CD tools were proposed)
  assert.match(FACT_RULE, /referred or recommended them[^.]*when the saved facts state how they heard of the job/);
});

test('a guess is typed and marked (owner, 14 Oct 2026); a low-confidence, knockout, contact, link or preference guess stays a proposal', () => {
  const typed = (a) => typeGuess(a);
  for (const a of [{ use: 'propose', fact: 'none', value: '120000', category: 'normal' }, { use: 'fill', fact: 'none', value: 'Yes', category: 'normal' },
    { use: 'propose', fact: 'years_experience', value: '8', category: 'normal' }]) {
    assert.deepEqual([typed(a).use, typed(a).guess], ['fill', true], JSON.stringify(a));
  }
  assert.equal(typed({ use: 'fill', fact: 'work_permit', value: 'No', category: 'knockout' }).use, 'fill', 'a knockout that follows from a saved fact is typed');
  assert.equal(typed({ use: 'fill', fact: 'work_permit', value: 'No' }).guess, undefined, 'a fact-backed answer is not a guess');
  assert.equal(typed({ use: 'fill', value: 'No' }).use, 'fill', 'an older reply shape with no fact is left as it was');
  for (const a of [{ category: 'knockout' }, { category: 'contact' }, { category: 'preference' }, { fact: 'contact' }, { fact: 'home_location' },
    { fact: 'links' }, { value: 'https://github.com/ada' }, { confidence: 'low' }]) {
    for (const use of a.fact ? ['propose'] : ['propose', 'fill']) {   // a typed answer resting on a contact, home or link fact: the identity and link floors decide
      const out = typed({ use, fact: 'none', value: 'x', category: 'normal', ...a });
      assert.deepEqual([out.use, out.guess], ['propose', undefined], `${use} ${JSON.stringify(a)}`);
    }
  }
  for (const category of ['legal', 'demographic', 'written']) {
    assert.deepEqual(typed({ use: 'fill', fact: 'none', value: 'Decline to self-identify', category }), { use: 'fill', fact: 'none', value: 'Decline to self-identify', category }, `${category}: its own rule decides`);
    assert.equal(typed({ use: 'propose', fact: 'none', value: 'Female', category }).use, 'propose', `${category}: its own floor decides`);
  }
  assert.equal(typed({ use: 'propose', fact: 'none', value: '', category: 'normal' }).use, 'propose', 'an empty answer is not typed');
});

test('answerForm: the saved-fact answer is typed, the guess is typed and marked', async () => {
  const { answerForm } = await import('../src/extension.js');
  const out = await answerForm(env, { url: 'https://example.test/job/1', fields }, fakeClient([
    { field: 'permit', value: 'No', confidence: 'high', note: '', category: 'knockout', use: 'fill', fact: 'sponsorship' },
    { field: 'heard', value: 'Website', confidence: 'medium', note: 'guess', category: 'normal', use: 'fill', fact: 'none' }]));
  const use = Object.fromEntries(out.answers.map((a) => [a.field, a.use]));
  assert.deepEqual(use, { permit: 'fill', heard: 'fill' });
  assert.equal(out.answers.find((a) => a.field === 'heard').guess, true);
  assert.equal(out.answers.find((a) => a.field === 'permit').fact, 'sponsorship');
});

test('with the data on this Mac (env.store) the ask gets the job and its drafted kit, and returns the job', async () => {
  const seen = [];
  const store = {
    findJob: async (url) => (url === 'https://example.test/job/1' ? { id: 'a1', title: 'SRE', company: 'Acme', stage: 'To apply', url, notion_url: '' } : null),
    kit: async (id) => (id === 'a1' ? { answers: [{ field: 'why', question: 'Why us?', answer: 'Your platform.' }], cover_letter: 'Dear Acme' } : null),
  };
  const { answerForm } = await import('../src/extension.js');
  const out = await answerForm({ ...env, store }, { url: 'https://example.test/job/1', fields }, fakeClient([], seen));
  const user = seen[0].messages[0].content;
  assert.match(user, /SRE at Acme/);
  assert.match(user, /<drafted_kit>[\s\S]*Your platform\./);
  assert.deepEqual(out.job, { title: 'SRE', company: 'Acme', stage: 'To apply', url: 'https://example.test/job/1', notion_url: '' });
  assert.equal(out.cover_letter, 'Dear Acme');
});

test('a knockout answered from the person\'s own saved fact is typed; a knockout no saved fact answers stays proposed (owner, 15 Oct 2026)', () => {
  // Lever, bake-off 15 Oct: "able to work in the office this role is advertised in?" for a London posting, answered from the saved relocation fact: typed, and right.
  const fromFact = typeGuess({ use: 'fill', fact: 'relocation', value: 'Yes, open to relocating within Europe', category: 'knockout', confidence: 'medium' });
  assert.equal(fromFact.use, 'fill', 'a saved fact answers it: typed');
  assert.notEqual(fromFact.guess, true, 'a fact is not a guess');
  for (const unbacked of [{ use: 'propose', fact: 'none' }, { use: 'fill', fact: 'none' }, { use: 'propose', fact: 'relocation' }]) {
    const out = typeGuess({ ...unbacked, value: 'Yes', category: 'knockout', confidence: 'high' });
    assert.equal(out.use, 'propose', `no saved fact answers it (${JSON.stringify(unbacked)}): proposed, never typed`);
  }
});

test('a multiple-choice field is flagged to the AI and the rule says to list every choice that applies', async () => {
  const { answerForm } = await import('../src/extension.js');
  const seen = [];
  await answerForm(env, { url: 'https://example.test/job/1', fields: [{ field: 'lang', label: 'Which languages do you speak?', type: 'combobox', required: true, multiple: true }] }, fakeClient([], seen));
  assert.match(seen[0].system[0].text, /multiple: true[^\n]*joined by " && "/);
  assert.match(JSON.stringify(seen[0].messages), /\\"multiple\\":true/);
});
