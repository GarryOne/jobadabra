// The owner guard (owner, 14 Oct 2026): an AI answer that is one of the owner's own values (the tripwire's list) is never typed, for every kind of value, whatever the
// answer's category or fact, in test mode or not. The owner below is invented; the field stays empty and only kind + field id are reported.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerForm } from '../src/extension.js';
import { matchesOwner, parseOwnerValues, withholdOwner } from '../src/owner-guard.js';

// In the tripwire's order: the saved e-mail and phone first, then the places and the name words, the account e-mail last.
const OWNER = new Map([['zorana.vrabcova@stand-in.test', 'email'], ['995550102030', 'phone'], ['port vale', 'location'], ['atlantis', 'location'],
  ['zorana', 'name'], ['zoranav88@stand-in.test', 'account']]);
// One answer per kind, each as a model with no saved profile would type it (a guess: category normal, fact none, no contact claim).
const CASES = [
  ['name', 'Preferred name', 'Zorana'], ['location', 'City', 'Port Vale'], ['location', 'Country', 'Atlantis'], ['email', 'Contact email', 'Zorana.Vrabcova@stand-in.test'],
  ['phone', 'Mobile', '+99 555 010 20 30'], ['account', 'Notification email', 'zoranav88@stand-in.test'], ['location', 'Where are you based?', 'I live in Port Vale, Atlantis'],
];
const fields = CASES.map(([, label], i) => ({ field: `f${i}`, label, type: 'text', required: true }));
const reply = (answers) => ({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, billing: 'subscription' },
  content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers }) }] });
const asked = CASES.map(([, , value], i) => ({ field: `f${i}`, value, use: 'fill', fact: 'none', category: 'normal', confidence: 'high' }));

for (const test_ of [false, true]) {
  test(`every kind of owner value is withheld (test mode ${test_}): nothing typed, the run says field + kind`, async () => {
    const seen = [];
    const env = { PROFILE_TEXT: '', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '', ownerValues: OWNER, onAnswer: (trace) => seen.push(trace) };
    const { answers } = await answerForm(env, { url: 'https://example.test/job/1', fields, test: test_ }, { messages: { create: async () => reply(asked) } });
    assert.deepEqual(answers.filter((a) => a.value), [], 'no owner value is typed');
    assert.deepEqual(seen[0].withheld.map((w) => w.kind), CASES.map(([kind]) => kind), 'each kind named');
    assert.ok(!JSON.stringify(seen[0]).toLowerCase().includes('vale'), 'never the value');
  });
}

test('without a list, nothing changes (a user\'s app); the fake applicant\'s values pass with a list', () => {
  const answers = [{ field: 'a', value: 'Test Candidate' }, { field: 'b', value: 'Zürich' }];
  assert.deepEqual(withholdOwner(answers, {}, null), { answers, withheld: [] });
  assert.deepEqual(withholdOwner(answers, {}, OWNER).withheld, []);
});

test('the list travels as JSON pairs and matches like the tripwire\'s', () => {
  const back = parseOwnerValues(JSON.stringify([...OWNER]));
  assert.deepEqual([...back], [...OWNER]);
  assert.equal(parseOwnerValues('nonsense'), null);
  assert.equal(parseOwnerValues('[]'), null);
  assert.deepEqual(matchesOwner([{ label: 'x', value: 'Portvale road' }], OWNER), [], 'whole words only');
});
