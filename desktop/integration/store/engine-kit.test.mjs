// The engine-backed kit's own guarantees (engine-kit.mjs), so every run-*.test.mjs can rely on them: no server on the owner's app port, loopback only, folders of its own, the engine
// refusing the app's real folder when none is set, and an AI that refuses what nobody answered (never a model). Owner's rule, 1 Nov 2026 (a8): "Never port 47111 or any port the owner's
// app may hold; a leaked test app held 47111 on 29 Oct".
// Job: serve stored answers
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {assertSafePort, freePort, refusesRealFolder, startEngineKit} from './engine-kit.mjs';

let kit;
before(async () => { kit = await startEngineKit({telegram: true, google: true, store: 'notion'}); });
after(async () => { await kit?.close(); });

test('every server of the kit is on loopback, on a port that is not the owner\'s app\'s', async () => {
  const urls = [kit.proxy.url, kit.notion.url, kit.notion.fake.url, kit.telegram.url, kit.google.url];
  for (const url of urls) assertSafePort(url);
  assert.equal(new Set(urls).size, urls.length, 'two servers share an address');
  assert.throws(() => assertSafePort('http://127.0.0.1:47111'), /47111/);
  assert.throws(() => assertSafePort('http://192.168.1.5:9000'), /loopback/);
  assert.notEqual(await freePort(), 47111);
});

test('the install is a temp folder of its own, and the engine gets its data and config folders from it', () => {
  assert.ok(kit.profile.startsWith(fs.realpathSync(os.tmpdir())) || kit.profile.startsWith(os.tmpdir()), `${kit.profile} is not under the temp folder`);
  const env = kit.tasks.pipelineEnv(kit.storage);
  assert.equal(env.JOBADABRA_DATA_DIR, path.join(kit.profile, 'data'));
  assert.equal(env.JOBADABRA_CONFIG_DIR, path.join(kit.profile, 'config'));
  assert.equal(env.JOBADABRA_AI_BASE_URL, undefined);
  assert.equal(env.ANTHROPIC_BASE_URL, kit.proxy.url, 'the engine\'s AI must go through the kit\'s proxy');
  assert.equal(env.JOBADABRA_E2E_NOTION_BASE_URL, kit.notion.url);
});

test('the engine refuses the app\'s own folder when no data and config folder is set (so a run that lost its folders stops, never touches the owner\'s)', async () => {
  const said = await refusesRealFolder();
  assert.match(said, /Refusing to use the Desktop App's data folder/);
});

test('an AI call nobody answered is refused the way the API refuses an empty balance, never passed to a model', async () => {
  const answer = await fetch(`${kit.proxy.url}/v1/messages`, {method: 'POST', headers: {'content-type': 'application/json', 'x-api-key': 'sk-ant-e2e-dummy-key', 'anthropic-version': '2023-06-01'},
    body: JSON.stringify({model: 'claude-haiku-5-5', max_tokens: 8, messages: [{role: 'user', content: 'hello'}]})});
  assert.equal(answer.status, 400);
  assert.match(await answer.text(), /credit balance/);
});
