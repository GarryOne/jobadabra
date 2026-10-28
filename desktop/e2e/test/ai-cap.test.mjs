// The day's $1 cap on CI's Workers AI (lib/ai-cap.mjs): over it a live Free AI ask is refused and named grey; under it, unreadable or not Free AI, nothing changes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CAP_NEURONS, capMessage, capReached, noteCapped, resetCap} from '../lib/ai-cap.mjs';
import {askFree} from '../lib/review-free.mjs';
import {startAiProxy} from '../lib/ai-proxy.mjs';

const env = {CI_CF_ANALYTICS_TOKEN: 'an', CI_FREE_AI_CF_ACCOUNT_ID: 'acct'};
const analytics = neurons => async () => ({json: async () => ({data: {viewer: {accounts: [{aiInferenceAdaptiveGroups: [{sum: {totalNeurons: neurons}}]}]}}})});

test('under the cap it is open, at the cap it is closed, and stays closed for the day', async () => {
  resetCap();
  assert.deepEqual(await capReached({env, fetchImpl: analytics(CAP_NEURONS - 1), now: Date.parse('2026-10-28T10:00:00Z')}), {capped: false, neurons: CAP_NEURONS - 1});
  const over = await capReached({env, fetchImpl: analytics(CAP_NEURONS), now: Date.parse('2026-10-28T10:02:00Z')});
  assert.equal(over.capped, true);
  let asked = 0;
  assert.equal((await capReached({env, fetchImpl: async () => { asked++; return analytics(0)(); }, now: Date.parse('2026-10-28T23:00:00Z')})).capped, true, 'over once, over for the day');
  assert.equal(asked, 0);
  assert.equal((await capReached({env, fetchImpl: analytics(5), now: Date.parse('2026-10-29T00:01:00Z')})).capped, false, 'a new UTC day opens it');
});

test('an unreadable count fails closed, with the cause and the fix in the grey line', async () => {
  resetCap();
  assert.deepEqual(await capReached({env: {}, fetchImpl: analytics(1e9)}), {capped: true, neurons: null, unreadable: true}, 'no analytics token');
  resetCap();
  assert.equal((await capReached({env, fetchImpl: async () => { throw new Error('down'); }})).capped, true, 'Cloudflare unreachable');
  resetCap();
  assert.equal((await capReached({env, fetchImpl: async () => ({json: async () => ({errors: [{message: 'not authorized for that account'}]})})})).unreadable, true, 'a token without the scope');
  assert.match(capMessage(null), /CI_CF_ANALYTICS_TOKEN/);
  const lines = [], log = console.log;
  console.log = line => lines.push(line);
  try { noteCapped(null, {E2E_SUITE: 'quality'}); } finally { console.log = log; }
  assert.match(lines[0], /^grey: quality \(AI capped: neuron count unreadable, set CI_CF_ANALYTICS_TOKEN/);
});

test('the screenshot review is refused past the cap and spends nothing', async () => {
  resetCap();
  let ai = 0;
  const fetchImpl = async url => (/graphql/.test(url) ? analytics(CAP_NEURONS + 5)() : (ai++, {ok: true, json: async () => ({})}));
  const answer = await askFree({messages: []}, {token: 'cf', account: 'acct', fetchImpl, cap: () => capReached({env, fetchImpl})});
  assert.equal(answer.ok, false);
  assert.equal(answer.status, 'capped');
  assert.match(answer.detail, new RegExp(capMessage(CAP_NEURONS + 5).slice(0, 30)));
  assert.equal(ai, 0);
});

test('the app\'s proxy on Free AI answers 503 ai-capped for a question replay cannot answer', async () => {
  resetCap();
  Object.assign(process.env, env, {E2E_SUITE: 'x'});
  const real = globalThis.fetch;
  let forwarded = 0;
  globalThis.fetch = async (url, init) => (/graphql/.test(String(url)) ? analytics(CAP_NEURONS + 1)() : (forwarded++, real(url, init)));
  const proxy = await startAiProxy({target: 'http://127.0.0.1:9', kind: 'app-free'});
  try {
    const answer = await real(`${proxy.url}/v1/messages`, {method: 'POST', body: '{"messages":[]}'});
    assert.equal(answer.status, 503);
    assert.match((await answer.json()).error.message, /^ai-capped:/);
    assert.equal(forwarded, 0, 'nothing went on to the relay');
  } finally { globalThis.fetch = real; await proxy.close(); delete process.env.CI_CF_ANALYTICS_TOKEN; delete process.env.CI_FREE_AI_CF_ACCOUNT_ID; delete process.env.E2E_SUITE; }
});
