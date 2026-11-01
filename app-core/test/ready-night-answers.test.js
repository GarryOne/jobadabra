// Ready to send's Open in Chrome (owner, 18 Oct 2026: "It should be all cached, every read and filled... instant"): on a form the night filled, the app's
// /extension/answer gives the night's answers (env.nightAnswers, desktop/lib/ready-handoff.js) with no AI call, and asks the AI only what the night did not see.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';

const URL_ = 'https://boards.example.com/acme/jobs/1';
const FIELDS = [{ field: 'q_why', label: 'Why us?', type: 'textarea' }, { field: 'q_country', label: 'Country', type: 'select', options: ['France', 'Switzerland'] }];
const NIGHT = { q_why: { field: 'q_why', value: 'Because', use: 'fill', category: 'written' }, q_country: { field: 'q_country', value: 'Switzerland', use: 'fill', category: 'contact' } };

function envWith(night) {
  const seen = [], counted = [];
  const aiClient = { messages: { create: async (request) => {
    seen.push(request);
    return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, billing: 'subscription' },
      content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers: [{ field: 'q_new', value: 'Yes', confidence: 'high', note: '' }] }) }] };
  } } };
  const nightAnswers = (url, fields) => {
    if (!night) return null;
    const answers = fields.filter((f) => night[f.field]).map((f) => ({ ...night[f.field], field: f.field }));
    return { answers, rest: fields.filter((f) => !night[f.field]) };
  };
  return { seen, counted, env: { EXTENSION_TOKEN: 'ext-secret', aiClient, PROFILE_TEXT: 'SRE', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '', store: { findJob: async () => null },
    nightAnswers, onNightAnswers: (counts) => counted.push(counts) } };
}
const ask = (env, fields) => worker.fetch(new Request('https://bot.test/extension/answer', { method: 'POST',
  headers: { Authorization: 'Bearer ext-secret', 'content-type': 'application/json' }, body: JSON.stringify({ url: URL_, fields }) }), env, {});

test('every question the night answered (a written one and a menu): its answers come back, and the AI is never asked', async () => {
  const { seen, counted, env } = envWith(NIGHT);
  const body = await (await ask(env, FIELDS)).json();
  assert.deepEqual(body.answers.map((a) => [a.field, a.value]), [['q_why', 'Because'], ['q_country', 'Switzerland']], 'the menu comes back as the night chose it');
  assert.equal(body.usd, 0);
  assert.equal(body.night, true);
  assert.equal(seen.length, 0, 'no AI call');
  assert.deepEqual(counted, [{ fields: 2, fromNight: 2, asked: 0 }]);
});

test('a question the night did not see (the page changed): only that one goes to the AI, the rest from the night', async () => {
  const { seen, env } = envWith(NIGHT);
  const body = await (await ask(env, [...FIELDS, { field: 'q_new', label: 'Relocate?', type: 'text' }])).json();
  assert.equal(seen.length, 1);
  assert.ok(JSON.stringify(seen[0].messages).includes('q_new'), 'the new question is asked');
  assert.ok(!JSON.stringify(seen[0].messages).includes('q_why'), 'a question the night answered is not');
  assert.deepEqual(body.answers.map((a) => a.field).sort(), ['q_country', 'q_new', 'q_why']);
});

test('a form the night did not fill: the AI answers as before', async () => {
  const { seen, env } = envWith(null);
  const body = await (await ask(env, [{ field: 'q_new', label: 'Relocate?', type: 'text' }])).json();
  assert.equal(seen.length, 1);
  assert.equal(body.night, undefined);
});
