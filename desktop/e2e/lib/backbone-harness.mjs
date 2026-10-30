// Share isolated stored-answer AI guards across backbone tests.
// Job: serve stored answers
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {contextAiKeys, contextAiProxies} from './context.mjs';
import {assertNoRealAi} from './no-real-ai.mjs';

/** Shared stored-answer table path for the backbone harness and its tests. */
export const answersTableFile = fileURLToPath(new URL('../fixtures/golden/ai-answers.json', import.meta.url));

/** Isolate a backbone suite with stored answers; fail if any call selects an engine or live transport. */
export async function backboneHarness(t, suite, family = 'claude') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${suite}-backbone-`));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const env = {CI: 'true', E2E_AI_ANSWERS: 'backbone', E2E_AI_ANSWERS_FILE: answersTableFile, E2E_ARTIFACTS: dir,
    E2E_SUITE: suite, E2E_AI_REPLAY: '1', E2E_AI_CACHE: dir, E2E_QUALITY_PERSONA: '', E2E_AI_PROVIDER: 'codex'};
  const saved = {...process.env};
  for (const key of Object.keys(process.env)) if (/^(E2E_|CI_AI_PROVIDER)/.test(key)) delete process.env[key];
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, saved); });
  let networkCalls = 0, engines = 0;
  const localFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', () => { networkCalls++; assert.fail('backbone must never reach a transport or relay'); });
  const keys = await contextAiKeys({offlineAi: true, family, engine: 'api'});
  assert.deepEqual(keys.needsKey, []);
  const proxies = await contextAiProxies({offlineAi: true, family});
  t.after(async () => { await proxies.openaiProxy?.close(); await proxies.proxy.close(); });
  assert.equal(proxies.proxy.canned(), null, 'backbone must consult the table rather than the blanket offline stand-in');
  return {...proxies, env, localFetch, options: {env, engine: () => { engines++; assert.fail('must not select an engine'); }},
    assertNoLive: () => {
      assert.equal(networkCalls, 0); assert.equal(engines, 0);
      assert.equal(proxies.proxy.stats.paid || 0, 0);
      assertNoRealAi(proxies);
    }};
}
