// Always on shares the free trial with the app (16 Oct 2026): a Free AI install's runs use its own key and lane; any install sends its trial key, first-run day and license to the repo.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FREE_BASE, TRIAL_KEY, ensureTrialKey} from '../lib/ai-free.js';
import * as github from '../lib/github.js';

const FREE = 'JPF1.install-0001.abcd', OWN = 'sk-ant-own', OLD = 'JP1.old.credit';
const store = (settings, secrets) => ({settings: () => settings, saveSettings: () => {}, readText: () => '', secret: name => secrets[name] || '', setSecret(name, value) { secrets[name] = value; }});

test('a Free AI install sends its key, the Free AI address and the first-run day: the runs debit the same install budget', () => {
  const {secrets, variables} = github.payload(store({aiFree: true, firstRunAt: '2026-10-01T00:00:00.000Z'}, {ANTHROPIC_API_KEY: FREE}));
  assert.equal(secrets.ANTHROPIC_API_KEY, FREE);
  assert.equal(secrets.JOB_PILOTTO_TRIAL_KEY, FREE);
  assert.equal(variables.JOB_PILOTTO_AI_BASE_URL, FREE_BASE);
  assert.equal(variables.JOB_PILOTTO_FIRST_RUN, '2026-10-01T00:00:00.000Z');
  assert.ok(variables.JOB_PILOTTO_SCORE_MODEL, 'scoring is on: the runs have an AI now');
});

test('an own key goes to Anthropic directly; the trial key and license still go, so the wall holds', () => {
  const {secrets, variables, removed} = github.payload(store({license: {key: 'JP1.a.b'}}, {ANTHROPIC_API_KEY: OWN, [TRIAL_KEY]: FREE}));
  assert.equal(secrets.ANTHROPIC_API_KEY, OWN);
  assert.equal(secrets.JOB_PILOTTO_TRIAL_KEY, FREE);
  assert.equal(secrets.JOB_PILOTTO_LICENSE_KEY, 'JP1.a.b');
  assert.equal(variables.JOB_PILOTTO_AI_BASE_URL, undefined);
  assert.ok(removed.includes('JOB_PILOTTO_AI_BASE_URL') && removed.includes('JOB_PILOTTO_FIRST_RUN'));
});

test('the older credit key (JP1.…) is still never sent as an Anthropic key', () => {
  assert.equal(github.payload(store({}, {ANTHROPIC_API_KEY: OLD})).secrets.ANTHROPIC_API_KEY, undefined);
});

test('ensureTrialKey mints once for an own-key install and never for a Free AI one', async () => {
  const secrets = {ANTHROPIC_API_KEY: OWN}, asked = [];
  const fetcher = async (url, init) => { asked.push([url, JSON.parse(init.body).purpose]); return Response.json({token: 'tok'}); };
  const st = store({}, secrets);
  await ensureTrialKey(st, fetcher);
  await ensureTrialKey(st, fetcher);
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0][1], 'ai');
  assert.match(secrets[TRIAL_KEY], /^JPF1\..+\.tok$/);
  await ensureTrialKey(store({}, {ANTHROPIC_API_KEY: FREE}), () => assert.fail('asked'));
});
