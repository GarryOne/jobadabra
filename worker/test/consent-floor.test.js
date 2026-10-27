// A consent is never typed from the AI's answer alone (16 Oct 2026): a legal answer is an empty kind whatever its use, and a box with no saved fact behind it is a proposal.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerForm } from '../src/extension.js';
import {loadJsdom, openPage} from './helpers/page.js';
const JSDOM = await loadJsdom();

const ask = async (fields, answers) => {
  const client = { messages: { create: async () => ({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', pay_asks: [], answers }) }] }) } };
  const env = { PROFILE_TEXT: '# Alex', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '', SEARCH_TEXT: '', CV_FACTS_TEXT: '', store: { findJob: async () => null, kit: async () => null } };
  return (await answerForm(env, { url: 'https://example.com/j', fields, page_text: 'x' }, client)).answers;
};
const answer = (over) => ({ field: 'a', value: 'checked', confidence: 'high', note: '', category: 'normal', use: 'fill', fact: 'none', ...over });

test('a legal answer comes back as an empty kind for a tick or typed text, every use (a choice among options: legal-choice.test.js)', async () => {
  for (const type of ['checkbox', 'text', 'textarea']) for (const use of ['fill', 'propose']) {
    const got = await ask([{ field: 'a', label: 'Consent', type, required: true, options: ['Yes', 'No'] }], [answer({ category: 'legal', use, value: 'Yes' })]);
    assert.deepEqual(got.map((a) => [a.value, a.category, a.use]), [['', 'legal', 'kind']], `${type} ${use}`);
  }
});

test('a box with no saved fact behind it is only proposed; one resting on a saved fact is typed; other field types are unchanged', async () => {
  const box = { field: 'a', label: 'I am happy with this', type: 'checkbox', required: true };
  assert.equal((await ask([box], [answer({ fact: 'none' })]))[0].use, 'propose');
  assert.equal((await ask([box], [answer({ fact: 'work_permit' })]))[0].use, 'fill');
  const text = { field: 'a', label: 'Anything else', type: 'text', required: false };
  const guessed = (await ask([text], [answer({ value: 'x', fact: 'none' })]))[0];
  assert.equal(guessed.use, 'fill');
  assert.equal(guessed.guess, true);
});

test('an explicit high-confidence consent decision survives as a gated kind, never an ordinary answer', async () => {
  for (const type of ['select', 'combobox', 'checkbox']) {
    const got = await ask([{field: 'a', label: 'Privacy notice', type, options: ['I agree', 'I decline']}],
      [answer({category: 'consent', value: type === 'checkbox' ? 'checked' : type === 'combobox' ? '' : 'I agree'})]);
    assert.deepEqual(got.map(a => [a.category, a.use, a.consent, a.value]), [['legal', 'kind', true, type === 'select' ? 'I agree' : 'checked']], type);
  }
});

test('uncertain, proposed, unlisted and text consent decisions cannot authorize a choice', async () => {
  for (const over of [{confidence: 'low'}, {use: 'propose'}, {value: 'invented'}]) {
    const got = await ask([{field: 'a', label: 'Privacy notice', type: 'select', options: ['I agree']}], [answer({category: 'consent', value: 'I agree', ...over})]);
    assert.ok(!got.some(a => a.consent === true));
  }
  const got = await ask([{field: 'a', label: 'Signature', type: 'text'}], [answer({category: 'consent'})]);
  assert.ok(!got.some(a => a.consent === true));
});

test('a rejected or personal-review AI reading cannot fall through to the legacy legal checkbox tick', {skip:!JSDOM}, async () => {
  for (const over of [{category:'consent',confidence:'low'}, {category:'consent',use:'propose'}, {category:'legal'}]) {
    const fields = [{field:'a',label:'Aviso de datos personales',type:'checkbox',required:true,filled:false}];
    const decisions = await ask(fields,[answer({value:'checked',...over})]);
    const page = openPage(JSDOM,'<form><label><input id="a" type="checkbox" required>Aviso de datos personales</label></form>');
    try {
      await page.__jobPilottoExtensionFill(decisions,{},null,'',true);
      assert.equal(page.document.getElementById('a').checked,false,JSON.stringify(over));
    } finally {page.close();}
  }
});
