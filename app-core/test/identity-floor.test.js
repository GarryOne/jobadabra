// A run with no applicant profile cannot type the signed-in account's identity (12 Oct 2026: on the plan path, with no profile sent, the model filled the
// account holder's country, city and surname into a test form). The answer step types a contact or home-location answer only when its value is in what the
// ask was given; otherwise it is proposed (shown, never typed). Stand-in account values below are invented; the applicant is the fake one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerForm } from '../src/extension.js';
import { floorUngrounded } from '../src/answer-facts.js';

const reply = (answers) => ({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, billing: 'subscription' },
  content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers }) }] });
const client = (answers) => ({ messages: { create: async () => reply(answers) } });
const fields = ['first', 'last', 'email', 'phone', 'country', 'city', 'street'].map((field) => ({ field, label: field, type: 'text', required: true }));
// What a model signed in as the stand-in account would answer: every identity field from the account, each claimed as a saved fact.
const STAND_IN = { first: 'Zorana', last: 'Vrabcova', email: 'zorana.vrabcova@stand-in.test', phone: '+99 555 010 2030', country: 'Atlantis', city: 'Port Vale', street: '12 Harbour Lane' };
const asAccount = Object.entries(STAND_IN).map(([field, value]) => ({ field, value, use: 'fill', fact: ['country', 'city', 'street'].includes(field) ? 'home_location' : 'contact', category: 'contact', confidence: 'high' }));

test('with an empty profile, no identity field is typed: the account\'s name, e-mail, phone, country, city and street are at most proposed', async () => {
  const env = { PROFILE_TEXT: '', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '' };
  const { answers } = await answerForm(env, { url: 'https://example.test/job/1', fields }, client(asAccount));
  const typed = answers.filter((a) => a.use === 'fill' && a.value);
  assert.deepEqual(typed.map((a) => a.field), [], 'nothing of the account is typed');
});

test('the fake applicant\'s own details, given in the profile, are still typed (also when the form wants a part of them)', async () => {
  const env = { PROFILE_TEXT: '## 📇 Contact details\n- Full name: Test Candidate\n- Email: test.candidate@example.com\n- Phone: +41 00 000 00 00\n- Location: Zürich, Switzerland', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '' };
  const own = { first: 'Test', last: 'Candidate', email: 'test.candidate@example.com', phone: '+41000000000', country: 'Switzerland', city: 'Zurich' };
  const { answers } = await answerForm(env, { url: 'https://example.test/job/1', fields }, client(Object.entries(own).map(([field, value]) => ({ field, value, use: 'fill', fact: 'contact', category: 'contact' }))));
  assert.deepEqual(answers.filter((a) => a.use === 'fill').map((a) => a.field).sort(), Object.keys(own).sort());
});

test('floor: only contact and home-location answers are checked; test mode and other facts are left as they were', () => {
  const given = 'Location: Geneva';
  assert.equal(floorUngrounded({ use: 'fill', fact: 'home_location', category: 'knockout', value: 'Atlantis' }, given).use, 'propose');
  assert.equal(floorUngrounded({ use: 'fill', fact: 'other_saved', category: 'contact', value: 'Zorana' }, given).use, 'propose', 'a contact field, whatever fact it names');
  assert.equal(floorUngrounded({ use: 'fill', fact: 'home_location', category: 'knockout', value: 'Geneva' }, given).use, 'fill');
  assert.equal(floorUngrounded({ use: 'fill', fact: 'work_permit', category: 'knockout', value: 'No' }, given).use, 'fill');
  assert.equal(floorUngrounded({ use: 'fill', fact: 'contact', category: 'contact', value: 'Zorana' }, given, { test: true }).use, 'fill', 'test mode invents on purpose');
});
