// CI on Free AI's checks: the gate's one look at CI's Workers AI token (free, no model call), and each suite's look at the relay on its runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkFreeToken, checkRelay} from '../lib/free-ai-check.mjs';

const json = (status, body) => async () => ({status, ok: status < 400, json: async () => body});

test('the token check passes an active token and stops on any other answer, naming the secret and never printing the token', async () => {
  await checkFreeToken({token: 'cf-secret', fetchImpl: json(200, {success: true, result: {status: 'active'}})});
  for (const answer of [json(200, {success: true, result: {status: 'disabled'}}), json(401, {success: false}), json(403, {success: false})]) {
    await assert.rejects(checkFreeToken({token: 'cf-secret', fetchImpl: answer}), error => /CI_FREE_AI_CF_TOKEN/.test(error.message) && !/cf-secret/.test(error.message));
  }
  let seen = '';
  await checkFreeToken({token: 'cf-secret', fetchImpl: async url => { seen = url; return {status: 200, ok: true, json: async () => ({success: true, result: {status: 'active'}})}; }});
  assert.equal(new URL(seen).host, 'api.cloudflare.com', 'the token goes to Cloudflare only');
  await checkFreeToken({token: 'cf-secret', fetchImpl: async () => { throw new Error('offline'); }});   // a down network is not a verdict on the token
});

test('the relay check asks the relay once in the app\'s own shape and stops when it refuses or is not there', async () => {
  let asked = null;
  await checkRelay({url: 'http://127.0.0.1:8787/api/ai', key: 'JPF1.ci-e2e-x.t', fetchImpl: async (url, init) => { asked = {url, init}; return {status: 200, ok: true, json: async () => ({content: [{type: 'text', text: 'ok'}]})}; }});
  assert.equal(asked.url, 'http://127.0.0.1:8787/api/ai/v1/messages');
  assert.equal(asked.init.headers['x-api-key'], 'JPF1.ci-e2e-x.t');
  await assert.rejects(checkRelay({url: 'http://127.0.0.1:8787/api/ai', key: 'k', fetchImpl: json(401, {error: {message: 'bad key'}})}), /Free AI relay refused.*401.*bad key/);
  await assert.rejects(checkRelay({url: 'http://127.0.0.1:8787/api/ai', key: 'k', fetchImpl: async () => { throw new Error('ECONNREFUSED'); }}), /Free AI relay.*not answering/);
});
