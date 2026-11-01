// Ready to send, the night's AI answers (hosted/ready-fill/night-ai.mjs): the Worker's own answer engine runs on the batch's facts, every model call goes through the site with the night token and no key,
// a capped or failing night answers nothing instead of stopping the fill, and the stand-in serves it on /extension/answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {answerForm} from '../src/extension.js';
import {answererFor, answerEnv, createAnswerer, siteClient} from '../../hosted/ready-fill/night-ai.mjs';
import {createStandIn} from '../../hosted/ready-fill/stand-in.mjs';

const batch = (facts = {profile: 'Alex Example lives in Zurich and has 8 years of SRE work.', standard: 'Notice period: two months'}) => ({contact: {name: 'Alex Example', email: 'alex@example.invalid'}, facts,
  jobs: [{id: 'j1', url: 'https://boards.example.com/acme/jobs/1', title: 'SRE', company: 'Acme', kit: {answers: []}, letter: 'Dear Acme'}]});
const fields = [{field: 'notice', label: 'Notice period', type: 'text', required: true}];
// A fake of the site's /api/ready/ai: an Anthropic-shaped reply that answers the notice period.
const site = (seen, status = 200) => async (url, init) => {
  seen.push({url, init});
  if (status !== 200) return new Response('{}', {status});
  const answer = {eligible: true, eligibility_note: '', pay_asks: [], answers: [{field: 'notice', value: 'Two months', confidence: 'high', note: '', category: 'normal', use: 'fill', fact: 'none'}]};
  return Response.json({content: [{type: 'text', text: JSON.stringify(answer)}], stop_reason: 'end_turn', model: 'claude-sonnet-5-5', usage: {input_tokens: 900, output_tokens: 80}});
};

test('the Worker engine answers from the batch facts through the site, with the night token and no key', async () => {
  const seen = [];
  const answer = createAnswerer({batch: batch(), site: 'https://site.test', token: 'RR1.b.t', answerForm, fetchImpl: site(seen), log: {error() {}}});
  const done = await answer({url: 'https://boards.example.com/acme/jobs/1', fields, page_text: 'SRE at Acme'});
  assert.equal(done.answers.find(a => a.field === 'notice')?.value, 'Two months');
  assert.equal(done.usd, 0);   // the site counts each call's cost toward the cap
  assert.equal(seen[0].url, 'https://site.test/api/ready/ai');
  assert.equal(seen[0].init.headers.authorization, 'Bearer RR1.b.t');
  assert.ok(!JSON.stringify(seen[0].init.headers).includes('x-api-key'));
  const prompt = JSON.parse(seen[0].init.body);
  assert.ok(JSON.stringify(prompt.system).includes('two months'), 'the standard answers are in the prompt');
  assert.ok(JSON.stringify(prompt.messages).includes('Dear Acme'), 'the job\'s kit and letter are in the prompt');
});

test('a capped night, a failing site or a batch without facts answers nothing and never throws', async () => {
  for (const status of [402, 502, 503]) {
    const answer = createAnswerer({batch: batch(), site: 'https://site.test', token: 't', answerForm, fetchImpl: site([], status), log: {error() {}}});
    assert.deepEqual(await answer({url: 'https://boards.example.com/acme/jobs/1', fields}), {answers: [], usd: 0}, `status ${status}`);
  }
  const seen = [];
  const none = createAnswerer({batch: batch({}), site: 'https://site.test', token: 't', answerForm, fetchImpl: site(seen)});
  assert.deepEqual(await none({url: 'https://boards.example.com/acme/jobs/1', fields}), {answers: [], usd: 0});
  assert.equal(seen.length, 0, 'no facts, no model call');
  const client = siteClient({site: 'https://site.test', token: 't', fetchImpl: site([], 402)});
  await assert.rejects(client.messages.create({}), error => error.aiLimit === true);
  assert.deepEqual(await createAnswerer({batch: batch(), site: 'https://site.test', token: 't', answerForm, fetchImpl: site([])})({url: 'x'}), {answers: [], usd: 0});   // no fields
});

test('the engine env is the batch: facts as text, the job and its kit from the batch, nothing from a store or a key', async () => {
  const env = answerEnv(batch());
  assert.equal(env.PROFILE_TEXT.startsWith('Alex Example'), true);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal((await env.store.findJob('https://boards.example.com/acme/jobs/1#x')).company, 'Acme');
  assert.equal((await env.store.kit('j1')).cover_letter, 'Dear Acme');
  assert.equal(await env.store.findJob('https://other.example.com/'), null);
});

test('the stand-in serves the AI on /extension/answer and answers nothing without it', async () => {
  const seen = [];
  const answer = await answererFor({batch: batch(), site: 'https://site.test', token: 't', fetchImpl: site(seen), log: {error() {}}});
  const app = await createStandIn(batch(), {answer});
  try {
    const reply = await (await fetch(`http://127.0.0.1:${app.port}/extension/answer`, {method: 'POST', body: JSON.stringify({url: 'https://boards.example.com/acme/jobs/1', fields, page_text: ''})})).json();
    assert.equal(reply.answers[0].value, 'Two months');
  } finally { await app.close(); }
  const quiet = await createStandIn(batch());
  try { assert.deepEqual(await (await fetch(`http://127.0.0.1:${quiet.port}/extension/answer`, {method: 'POST', body: '{}'})).json(), {answers: [], usd: 0}); } finally { await quiet.close(); }
});
