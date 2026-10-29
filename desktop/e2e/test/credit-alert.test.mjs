// The credit-zero alert (credit-alert.mjs): only a credit message sends, the message names provider, workflow and the next action.
import test from 'node:test';
import assert from 'node:assert/strict';
import {alertCreditOut, creditMessage, isCreditOut} from '../credit-alert.mjs';

const env = {CI_ALERTS_TELEGRAM_BOT_TOKEN: 'T', CI_ALERTS_TELEGRAM_CHAT_ID: 'C', GITHUB_WORKFLOW: 'CI · AI code review', GITHUB_RUN_ID: '7', GITHUB_REPOSITORY: 'o/r'};

test('the providers\' empty-balance wordings are credit messages; other failures are not', () => {
  for (const text of ['HTTP 400: Credit balance is too low', 'You exceeded your current quota', '{"code":"insufficient_quota"}']) assert.ok(isCreditOut(text), text);
  for (const text of ['HTTP 401 invalid x-api-key', 'rate limit', '']) assert.ok(!isCreditOut(text), text);
});

test('a credit message sends one Telegram message that names the provider, the workflow, the run and what to do; anything else sends nothing', async () => {
  const sent = [];
  const fetcher = async (url, init) => { sent.push({url, body: JSON.parse(init.body)}); return {ok: true}; };
  assert.equal(await alertCreditOut({provider: 'anthropic', text: 'HTTP 401', env, fetcher}), 'credit-alert: not a credit message, nothing sent');
  assert.equal(sent.length, 0);
  assert.equal(await alertCreditOut({provider: 'anthropic', text: 'Credit balance is too low', env, fetcher}), 'ci-alert: sent');
  assert.match(sent[0].url, /botT\/sendMessage/);
  assert.match(sent[0].body.text, /AI credit is 0/);
  assert.match(sent[0].body.text, /anthropic/);
  assert.match(sent[0].body.text, /CI · AI code review/);
  assert.match(sent[0].body.text, /actions\/runs\/7/);
  assert.match(sent[0].body.text, /Codex plan/);
});

test('a capped Codex broker alerts without a credit wording, with the Codex advice', async () => {
  const sent = [];
  await alertCreditOut({provider: 'codex', text: 'broker: scheduled lane over its share', always: true, env, fetcher: async (_, init) => { sent.push(JSON.parse(init.body).text); return {ok: true}; }});
  assert.match(sent[0], /weekly reset/);
});

test('no secrets: one line, no send, and the message never carries the token', async () => {
  assert.match(await alertCreditOut({provider: 'anthropic', text: 'Credit balance is too low', env: {}, fetcher: async () => { throw new Error('must not call'); }}), /not sent \(CI_ALERTS_TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(creditMessage({provider: 'anthropic', text: 'x', env}).text, /botT|"T"/);
});
