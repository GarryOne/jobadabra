// A choice a saved fact answers is filled from the Profile in the form's own wording (owner, 17 Oct 2026: "Why 'A choice (visa, relocation, demographic,
// any knockout)' is left for me? We should have this information in the Profile, as a standard/base."). A country menu offers only its own language
// ("Suisse"), so the identity floor's same-words check could never pass it: the code now compares the country, not the words, and only for one of the
// form's listed options. Free-text places keep the applicant's own words (9fbbb4a). Unsure stays proposed; a certification is never answered.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerForm } from '../src/extension.js';
import { floorUngrounded } from '../src/answer-facts.js';
import { sameCountry } from '../src/country-names.js';

const reply = (answers) => ({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, billing: 'subscription' },
  content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers }) }] });
const client = (answers) => ({ messages: { create: async () => reply(answers) } });
const env = { PROFILE_TEXT: '## 📇 Contact details\n- Full name: Test Candidate\n- Location: Zurich, Switzerland', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '' };
const menu = (field, label, options) => ({ field, label, type: 'select', required: true, options });

test('the same country, in any language, by the standard country names', () => {
  for (const name of ['Suisse', 'Schweiz', 'Svizzera', 'Suiza', 'Switzerland']) assert.ok(sameCountry(name, 'Location: Zurich, Switzerland'), name);
  assert.ok(sameCountry('Allemagne', 'Wohnort: Berlin, Deutschland'));
  assert.equal(sameCountry('Suisse', 'Location: Berlin, Germany'), false, 'another country');
  assert.equal(sameCountry('Zurich', 'Location: Zurich, Switzerland'), false, 'a city is not a country: the words decide it');
  assert.equal(sameCountry('Niger', 'Location: Lagos, Nigeria'), false, 'whole names only');
});

test('a country menu in the form\'s language is filled from the saved country (fact -> option across languages)', async () => {
  const fields = [menu('pays', 'Pays de résidence', ['France', 'Allemagne', 'Suisse', 'Italie']), menu('land', 'Wohnsitzland', ['Deutschland', 'Österreich', 'Schweiz'])];
  const { answers } = await answerForm({ ...env }, { url: 'https://example.test/job/1', fields }, client([
    { field: 'pays', value: 'Suisse', use: 'fill', fact: 'home_location', category: 'contact', confidence: 'high', note: '' },
    { field: 'land', value: 'Schweiz', use: 'fill', fact: 'home_location', category: 'knockout', confidence: 'high', note: '' }]));
  assert.deepEqual(answers.filter((a) => a.use === 'fill').map((a) => [a.field, a.value]), [['pays', 'Suisse'], ['land', 'Schweiz']]);
});

test('unsure stays proposed: another country, a value not among the options, a free-text box, an answer the AI only proposed', () => {
  const given = 'Location: Zurich, Switzerland';
  const options = ['France', 'Suisse'];
  const at = (value, more = {}) => floorUngrounded({ use: 'fill', fact: 'home_location', category: 'contact', value, ...more }, given, { options });
  assert.equal(at('France').use, 'propose', 'not the saved country');
  assert.equal(floorUngrounded({ use: 'fill', fact: 'home_location', category: 'contact', value: 'Schweiz' }, given, { options }).use, 'propose', 'not one of this form\'s options');
  assert.equal(floorUngrounded({ use: 'fill', fact: 'home_location', category: 'contact', value: 'Suisse' }, given).use, 'propose', 'a free-text box keeps the applicant\'s own words');
  assert.equal(at('Suisse', { use: 'propose' }).use, 'propose', 'an unsure answer is never promoted');
  assert.equal(at('Suisse').use, 'fill');
});

test('a certification tick is never answered, even where a saved fact seems to cover it', async () => {
  // Owner, 20 Oct 2026 ("Ask once, remember"): only a single tick stays the person's; a legal-looking choice among options rests on a saved answer (legal-choice.test.js).
  const fields = [{ field: 'cert', label: 'Je certifie résider en Suisse', type: 'checkbox', required: true }];
  const { answers } = await answerForm({ ...env }, { url: 'https://example.test/job/1', fields }, client([
    { field: 'cert', value: 'Oui', use: 'fill', fact: 'home_location', category: 'legal', confidence: 'high', note: '' }]));
  assert.deepEqual(answers.map((a) => [a.field, a.value, a.use]), [['cert', '', 'kind']]);
});
