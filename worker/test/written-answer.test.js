import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerForm } from '../src/extension.js';
import worker from '../src/index.js';
import { WRITTEN_RULE, REVIEW_SCHEMA, splitReminders } from '../src/written-answer.js';

// Written questions are DRAFTED from the person's facts (owner, 16 Oct 2026, reversing the 11 Oct "expected hold"): typed and marked, an outline when the facts are thin.
const QUESTIONS = ['What is your hands-on experience operating container-orchestrated infrastructure?', 'Describe cloud infrastructure you have built.',
  'Walk us through how you make a change to production safely.', 'Describe a production incident you personally root-caused.'];
const fields = QUESTIONS.map((label, i) => ({ field: `q${i}`, label, type: 'textarea', required: true }));
const reply = (answers) => ({ stop_reason: 'end_turn', usage: { billing: 'subscription' }, content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers }) }] });
const env = { PROFILE_TEXT: 'Name: Ada\nSRE at Acme', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '', CV_FACTS_TEXT: 'done at Acme: ran Kubernetes clusters' };
const one = (value, confidence, i = 0, extra = {}) => ({ field: `q${i}`, value, confidence, note: '', category: 'written', use: 'fill', fact: 'none', ...extra });

test('a drafted written question is typed and marked draft; a thin-facts one is an outline; an empty one stays a kind', async () => {
  const out = await answerForm(env, { url: 'https://example.test/job/1', fields },
    { messages: { create: async () => reply([one('I ran the Kubernetes clusters at Acme.', 'medium', 0), one('• Add: which incident, what the root cause was', 'low', 3), one('', 'low', 1),
      one('I built the Terraform platform at Acme.\n• Add: how many teams used it\n• Add: one number', 'low', 2)]) } });
  const by = Object.fromEntries(out.answers.map((a) => [a.field, a]));
  assert.deepEqual([by.q0.use, by.q0.draft, by.q0.value, by.q0.remind], ['fill', 'draft', 'I ran the Kubernetes clusters at Acme.', undefined]);
  assert.deepEqual([by.q2.use, by.q2.draft, by.q2.value, by.q2.remind], ['fill', 'outline', 'I built the Terraform platform at Acme.', ['how many teams used it', 'one number']],
    'low confidence: an outline to complete; only its finished sentences go in the box, the reminders beside it');
  assert.deepEqual([by.q3.use, by.q3.value, by.q3.remind], ['kind', '', ['which incident, what the root cause was']], 'only reminders: nothing is typed, they are shown beside the box (owner, 27 Oct 2026)');
  assert.deepEqual([by.q1.use, by.q1.value, by.q1.draft], ['kind', '', undefined], 'no text at all: the old kind');
  assert.equal(out.answers.filter((a) => a.field === 'q1').length, 1, 'one row per field');
  assert.ok(!JSON.stringify(out.answers.map((a) => a.value)).includes('Add:'), 'no value holds a reminder line');
});

test('splitReminders: every "• Add:" piece leaves the text, on its own line or inline', () => {
  assert.deepEqual(splitReminders('I once traced a failing rollout. • Add: the root cause'), { text: 'I once traced a failing rollout.', remind: ['the root cause'] });
  assert.deepEqual(splitReminders('First.\n\n• Add: a number\n\nSecond paragraph.'), { text: 'First.\n\nSecond paragraph.', remind: ['a number'] });
  assert.deepEqual(splitReminders('• Add: one • Add: two'), { text: '', remind: ['one', 'two'] });
  assert.deepEqual(splitReminders('No reminder here.'), { text: 'No reminder here.', remind: [] });
});

test('a draft the AI called a proposal is typed as a draft anyway (the person reviews it in the box)', async () => {
  const out = await answerForm(env, { url: 'https://example.test/job/1', fields }, { messages: { create: async () => reply([one('Draft text', 'medium', 0, { use: 'propose' })]) } });
  assert.deepEqual([out.answers[0].use, out.answers[0].draft], ['fill', 'draft']);
});

test('the prompt tells the AI to draft from the given facts only and never to invent', () => {
  for (const part of [/never invent an employer, project, tool, number, date or incident/, /• Add:/, /first person/, /never leave it as a bare empty box/, /answers the question that is asked/, /never fill the box with facts unrelated to the question/, /never leave the question.s subject only to the/]) assert.match(WRITTEN_RULE, part);
});

test('/extension/review-answer: one AI read, the form is never touched; needs a question and text', async () => {
  const seen = [];
  const aiClient = { messages: { create: async (args) => { seen.push(args); return { stop_reason: 'end_turn', usage: { billing: 'subscription' }, content: [{ type: 'text', text: JSON.stringify(
    { answers_it: false, verdict: 'No incident named.', missing: ['one incident'], improved: 'I once traced a failing rollout. • Add: the root cause' }) }] }; } } };
  const call = (body) => worker.fetch(new Request('https://w.test/extension/review-answer', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(body) }), { ...env, EXTENSION_TOKEN: 't', aiClient });
  const bad = await call({ url: 'https://example.test/job/1', question: QUESTIONS[3], text: '' });
  assert.equal(bad.status, 400);
  const ok = await (await call({ url: 'https://example.test/job/1', question: QUESTIONS[3], text: 'Once I fixed a thing.' })).json();
  assert.deepEqual([ok.answers_it, ok.missing, ok.usd], [false, ['one incident', 'the root cause'], 0], 'a reminder in the improved text joins what is missing');
  assert.equal(ok.improved, 'I once traced a failing rollout.', '"Use this version" types finished sentences only (owner, 27 Oct 2026)');
  assert.equal(seen.length, 1);
  assert.ok(JSON.stringify(seen[0]).includes('Once I fixed a thing.') && JSON.stringify(seen[0]).includes('ran Kubernetes clusters'), 'the text and the person\'s facts reach the AI');
  assert.deepEqual(REVIEW_SCHEMA.required, ['answers_it', 'verdict', 'missing', 'improved']);
});
