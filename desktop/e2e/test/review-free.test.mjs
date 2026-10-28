// The screenshot review on Free AI (lib/review-free.mjs): Claude's request goes to Workers AI in its own shape, with CI's token, and comes back in Claude's.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildRequest} from '../lib/vision.mjs';
import {FREE_MODEL, askFree, freeCost, toWorkersAi} from '../lib/review-free.mjs';

const open = async () => ({capped: false, neurons: 0});   // the day's cap is tested in ai-cap.test.mjs
const request = buildRequest({view: 'focus', pngBase64: 'iVBORw0KGgo=', rules: 'Rule one.', facts: {page: 'focus'}});

test('the request keeps the instructions, the picture and the words', () => {
  const asked = toWorkersAi(request);
  assert.equal(asked.messages[0].role, 'system');
  assert.match(asked.messages[0].content, /You are a person using the Jobadabra desktop app[\s\S]*Rule one\./);
  assert.deepEqual(asked.messages[1].content[0], {type: 'image_url', image_url: {url: 'data:image/png;base64,iVBORw0KGgo='}});
  assert.match(asked.messages[1].content[1].text, /Page: focus[\s\S]*FACTS/);
});

test('asks Cloudflare with CI\'s token and answers in Claude\'s shape, with its cost', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = {url, init}; return {ok: true, status: 200, json: async () => ({success: true, result: {response: '{"findings":[]}', usage: {prompt_tokens: 2000, completion_tokens: 20}}})}; };
  const answer = await askFree(request, {token: 'cf', account: 'acct', fetchImpl, cap: open});
  assert.equal(seen.url, `https://api.cloudflare.com/client/v4/accounts/acct/ai/run/${FREE_MODEL}`);
  assert.equal(seen.init.headers.authorization, 'Bearer cf');
  assert.deepEqual(answer.message.content, [{type: 'text', text: '{"findings":[]}'}]);
  assert.equal(answer.message.stop_reason, 'end_turn');
  assert.equal(answer.usd, freeCost(FREE_MODEL, {prompt_tokens: 2000, completion_tokens: 20}));
  assert.ok(answer.usd > 0 && answer.usd < 0.001);
});

test('an already-parsed answer, a cut-off answer, a refusal and no token', async () => {
  const reply = result => async () => ({ok: true, status: 200, json: async () => ({success: true, result})});
  assert.equal((await askFree(request, {token: 'cf', account: 'a', cap: open, fetchImpl: reply({response: {findings: []}})})).message.content[0].text, '{"findings":[]}');
  assert.equal((await askFree(request, {token: 'cf', account: 'a', cap: open, fetchImpl: reply({response: '{"fi', usage: {completion_tokens: 1500}})})).message.stop_reason, 'max_tokens');
  const refused = await askFree(request, {token: 'cf', account: 'a', cap: open, fetchImpl: async () => ({ok: false, status: 403, json: async () => ({success: false, errors: [{message: 'not allowed'}]})})});
  assert.deepEqual([refused.ok, refused.status], [false, 403]);
  assert.match(refused.detail, /not allowed/);
  assert.equal((await askFree(request, {token: '', account: 'a'})).status, 'no-token');
});
