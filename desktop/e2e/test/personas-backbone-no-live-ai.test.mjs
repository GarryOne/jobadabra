// Prove personas' direct Python asks stop at stored answers with dummy keys and no live transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFile, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {loadTable, questionOf, storedAnswer} from '../lib/ai-answers.mjs';
import {backboneHarness} from '../lib/backbone-harness.mjs';
import {DUMMY_KEY} from '../lib/engine.mjs';
import {modelFetch} from '../lib/model.mjs';
import {python, pythonEnv} from '../lib/python.mjs';

const source = fs.readFileSync(new URL('../suites/personas.mjs', import.meta.url), 'utf8');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const table = loadTable();
const profiles = ['austin', 'sao_paulo'].map(name => JSON.parse(fs.readFileSync(new URL(`../fixtures/personas/${name}/profile.json`, import.meta.url), 'utf8')));
const request = (action, body = {model: 'test', messages: [{role: 'user', content: 'Background read'}]}) => ({
  method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': action}, body: JSON.stringify(body),
});

// Exercise the suite's private child-process boundary without launching Electron, a CLI or the suite.
const engine = vm.runInNewContext(`${source.slice(source.indexOf('function engine('), source.indexOf('const DIGEST_CODE'))}\nengine`,
  {path, DUMMY_KEY, python, pythonEnv, execFile, execFileSync, REPO: root, process});

function capturePlaces(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'personas-asks-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.copyFileSync(path.join(root, 'config', 'search.json'), path.join(dir, 'search.json'));
  return JSON.parse(execFileSync(python(), ['-c', `
import json, socket, sys
from types import SimpleNamespace as NS
from unittest.mock import patch
def forbidden(*args, **kwargs):
    raise AssertionError('no network in request capture')
socket.socket.connect = forbidden
from src.ai import decide, meanings_pack
from src.sources import aggregators, google_jobs
asks = []
def client(action):
    def create(**body):
        asks.append({'action': action, 'body': body})
        raise RuntimeError('capture only: no answer supplied')
    return NS(messages=NS(create=create))
with patch.object(meanings_pack, 'first', return_value=None), patch.object(decide, 'detail'), patch.object(decide.engine, 'ready', return_value=True), patch.object(decide.engine, 'client', side_effect=client):
    for profile in json.loads(sys.argv[1]):
        # Isolate within_places' drafted-location lookup from the earlier search-country lookup.
        with patch.object(aggregators, '_countries', return_value=[profile['google']['country']]):
            google_jobs.settings({'google_jobs': profile['google'], 'locations': profile['places']})
print(json.dumps(asks))
`, JSON.stringify(profiles)], {cwd: root, env: pythonEnv({PYTHONDONTWRITEBYTECODE: '1', JOB_PILOTTO_DATA_DIR: dir,
    JOB_PILOTTO_CONFIG_DIR: dir, JOB_PILOTTO_APP_DIR: dir}, {home: dir}), encoding: 'utf8', timeout: 10000}));
}

for (const family of ['claude', 'free', 'openai']) test(`personas' real within_places asks refuse by item key at every ${family} seam`, async t => {
  const asks = capturePlaces(t), h = await backboneHarness(t, 'personas', family);
  assert.equal(asks.length, 2);
  for (const [index, {action, body}] of asks.entries()) {
    assert.equal(action, 'decide');
    const q = questionOf(request(action, body), h.env, table);
    assert.equal(q.operation, 'app.decide');
    assert.deepEqual(q.items.map(item => item.text), [profiles[index].google.locations[0].location]);
    assert.equal(table.items['app.decide'][q.items[0].key], undefined, 'recording needs owner cost approval');
    const missing = error => {
      assert.equal(error.code, 'E2E_AI_ANSWER_MISSING');
      assert.ok(error.message.includes(q.items[0].key));
      assert.match(error.message, /has no stored answer/);
      return true;
    };
    const init = request(action, body);
    assert.throws(() => storedAnswer(init, h.env), missing);
    await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), missing);
    const translated = {model: 'test', instructions: body.system, input: body.messages,
      text: {format: {type: 'json_schema', schema: body.output_config.format.schema}}, prompt_cache_key: `job-pilotto-${action}`};
    const proxy = family === 'openai' ? h.openaiProxy : h.proxy;
    const response = await h.localFetch(`${proxy.url}/v1/${family === 'openai' ? 'responses' : 'messages'}`, request(action, family === 'openai' ? translated : body));
    assert.equal(response.status, 503);
    missing((await response.json()).error);
    console.log(`Missing personas question: ${q.items[0].text} -> app.decide/${q.items[0].key}`);
  }
  h.assertNoLive();
});

test('personas names undeclared asks before any live transport', async t => {
  const h = await backboneHarness(t, 'personas'), init = request('undeclared_personas_kind');
  const missing = {code: 'E2E_AI_ANSWER_MISSING', message: /personas: undeclared_personas_kind.*is unkeyable/};
  assert.throws(() => storedAnswer(init, h.env), missing);
  await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), missing);
  const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
  assert.equal(response.status, 503);
  const {error} = await response.json();
  assert.equal(error.code, missing.code); assert.match(error.message, missing.message);
  h.assertNoLive();
});

for (const [selected, family] of [['api', 'claude'], ['api', 'free'], ['openai', 'openai'], ['cli', 'claude'], ['codex', 'openai'], ['codex', 'claude'], ['cli', 'openai']]) test(`personas isolates ${family}/${selected} Python with dummy keys and a responsive stored-answer proxy`, async t => {
  const h = await backboneHarness(t, 'personas', family);
  const ctx = {...h, profile: h.env.E2E_ARTIFACTS, engine: selected, family, key: 'revoked-ci-key-must-not-pass'};
  const env = JSON.parse(await engine(ctx, 'import json, os; print(json.dumps(dict(os.environ)))'));
  const openai = family === 'openai';
  assert.equal(env.JOB_PILOTTO_AI_ENGINE, openai ? 'openai' : 'api', 'no signed-in CLI may bypass the proxy');
  assert.equal(env[openai ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'], DUMMY_KEY);
  assert.equal(env[openai ? 'OPENAI_BASE_URL' : 'JOB_PILOTTO_AI_BASE_URL'], openai ? `${h.openaiProxy.url}/v1` : h.proxy.url);
  assert.equal(env[openai ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'], undefined);
  assert.equal(env.HOME, ctx.profile);
  assert.equal(env.JOB_PILOTTO_NO_DOTENV, '1'); assert.equal(env.JOB_PILOTTO_FOLLOW_APP, '0');
  assert.ok(!JSON.stringify(env).includes(ctx.key));
  // The proxy runs in this Node process: a synchronous child would prevent it from answering.
  const status = await engine(ctx, `import json, os, sys, urllib.request, urllib.error
base = os.environ.get('OPENAI_BASE_URL') or os.environ['JOB_PILOTTO_AI_BASE_URL'] + '/v1'
url = base + ('/responses' if os.environ['JOB_PILOTTO_AI_ENGINE'] == 'openai' else '/messages')
req = urllib.request.Request(url, data=sys.argv[1].encode(), headers={'Content-Type': 'application/json', 'x-jp-action': 'undeclared_personas_kind'})
try:
    urllib.request.urlopen(req, timeout=3)
except urllib.error.HTTPError as error:
    print(error.code)
`, [JSON.stringify({model: 'test', messages: [{role: 'user', content: 'Uninventoried ask'}]})]);
  assert.equal(status.trim(), '503');
  h.assertNoLive();
});

test('personas recording retains stored answers and the real-AI guard', () => {
  assert.doesNotMatch(source, /^export const offlineAi =/m, 'temporary owner-approved recording phase');
  assert.match(source, /^export const realAi = false;/m);
  // The suite says so itself; plan-run.mjs puts it in matrix.aiAnswers, which both attempts of e2e.yml read.
  assert.match(source, /^export const aiAnswers = 'backbone';/m);
});
