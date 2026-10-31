// Prove wander's stored answers parse without moving facts or reaching a live key or AI.
import {loadAppModule} from '../lib/app-module.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {loadTable, questionOf, storedAnswer} from '../lib/ai-answers.mjs';
import {FAILURES} from '../lib/ai-proxy.mjs';
import {backboneHarness} from '../lib/backbone-harness.mjs';
import {contextAiKeys} from '../lib/context.mjs';
import {DUMMY_KEY} from '../lib/engine.mjs';
import {modelFetch} from '../lib/model.mjs';
import {python, pythonEnv} from '../lib/python.mjs';
import {planWalk} from '../lib/wander.mjs';
import {applicantDraft} from '../lib/applicant-seed.mjs';
const {judge, move, planOf} = await loadAppModule('profile-move.js');
const {organize} = await loadAppModule('profile-routing.js');
const {propose, forCv} = await loadAppModule('contact-from-cv.js');
import {createStorage} from '../../lib/storage.js';
const {openStore} = await loadAppModule('store/index.js');

const tableFile = fileURLToPath(new URL('../fixtures/golden/ai-answers.json', import.meta.url));
const {request: captured} = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/wander-decide.json', import.meta.url), 'utf8'));
const empty = {answer_home: {items: []}, organize_lines: {items: []}, contact_from_cv: {proposals: []}};
const refused = ['question_formats', 'role_ideas', 'places'];
const titles = ['Site Reliability Engineer', 'Platform Engineer', 'DevOps Engineer', 'Infrastructure Engineer', 'Cloud Engineer', 'Systems Administrator'];
const request = (action, body = {model: 'test', messages: [{role: 'user', content: 'Background read'}]}) => ({
  method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': action}, body: JSON.stringify(body),
});

const harness = async (t, family = 'claude') => {
  const h = await backboneHarness(t, 'wander', family);
  Object.assign(process.env, {E2E_ANTHROPIC_KEY: 'revoked', E2E_OPENAI_KEY: 'revoked'});
  const keys = await contextAiKeys({offlineAi: true, family, engine: family === 'openai' ? 'openai' : 'api'});
  assert.deepEqual(keys.needsKey, []);
  assert.deepEqual(keys.needs, []);
  assert.equal(keys.key, DUMMY_KEY);
  delete process.env.E2E_ANTHROPIC_KEY; delete process.env.E2E_OPENAI_KEY;
  assert.deepEqual(await contextAiKeys({offlineAi: true, family, engine: family === 'openai' ? 'openai' : 'api'}), keys);
  return {...h, dir: h.env.E2E_ARTIFACTS};
};

test('wander resolves all seven inventoried kinds at both answer seams with no live key or transport', async t => {
  const h = await harness(t), table = loadTable(tableFile);
  for (const kind of [...Object.keys(empty), ...refused, 'decide']) {
    const init = request(kind, kind === 'decide' ? captured : undefined);
    const found = storedAnswer(init, h.env);
    if (refused.includes(kind)) {
      assert.deepEqual(found, {refuse: 'invalid-key'});
      await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), /invalid-key/);
    } else {
      assert.ok(found.reply, `${kind} needs a real stored reply`);
      assert.deepEqual(JSON.parse(found.reply.content[0].text), empty[kind] || {results: [{index: 0, answer: 'software'}]});
      assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), found.reply);
    }
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, found.refuse ? 401 : 200, kind);
    if (found.reply) assert.deepEqual(await response.json(), found.reply);
  }
  const question = questionOf(request('decide', captured), h.env, table);
  assert.deepEqual(question.items.map(item => item.text), ['Site Reliability Engineer']);
  assert.deepEqual(table.items['app.decide'][question.items[0].key], {text: 'Site Reliability Engineer', answer: 'software'});
  h.assertNoLive();
});

test('every seeded title passes the real role-kind caller and decide parser with stored software answers', async t => {
  const h = await harness(t), replies = {};
  assert.deepEqual(applicantDraft({which: 'thin'}).search.target_roles, titles);
  for (const title of titles) {
    const body = structuredClone(captured);
    body.messages[0].content = body.messages[0].content.replace(/### Item 0\n[\s\S]+$/, `### Item 0\n${title}`);
    replies[title] = storedAnswer(request('decide', body), h.env).reply;
    assert.deepEqual(JSON.parse(replies[title].content[0].text), {results: [{index: 0, answer: 'software'}]});
  }
  const result = execFileSync(python(), ['-c', `
import json, socket, sys
from types import SimpleNamespace as NS
from unittest.mock import patch
def forbidden(*args, **kwargs):
    raise AssertionError('no network in parser test')
socket.socket.connect = forbidden
from src.ai import decide, meanings_pack
from src import role_kinds, target_roles
data = json.load(sys.stdin)
asked = []
def create(**body):
    asked.append(body)
    title = body['messages'][0]['content'].split('### Item 0\\n')[1]
    reply = data['replies'][title]
    assert body['messages'][0]['content'] == data['request']['messages'][0]['content'].replace('Site Reliability Engineer', title)
    assert body['output_config']['format']['schema'] == data['request']['output_config']['format']['schema']
    return NS(content=[NS(**part) for part in reply['content']], stop_reason=reply['stop_reason'], usage=None)
with patch.object(meanings_pack, 'first', return_value=None), patch.object(decide.engine, 'ready', return_value=True), \\
     patch.object(decide.engine, 'client', return_value=NS(messages=NS(create=create))):
    found = {title: role_kinds.kind_of(title) for title in data['titles']}
    assert role_kinds.of_search(target_roles.with_derived(data['search'])) == {'software'}
assert found == {title: 'software' for title in data['titles']}, found
assert len(asked) == len(data['titles'])
print(json.dumps(found))
`], {cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    env: pythonEnv({PYTHONDONTWRITEBYTECODE: '1', JOB_PILOTTO_DATA_DIR: h.dir,
      JOB_PILOTTO_CONFIG_DIR: h.dir, JOB_PILOTTO_APP_DIR: h.dir}, {home: h.dir}),
    input: JSON.stringify({replies, request: captured, titles, search: applicantDraft({which: 'thin'}).search}), encoding: 'utf8', timeout: 10000});
  assert.deepEqual(Object.values(JSON.parse(result)), ['software', 'software', 'software', 'software', 'software', 'software']);
  h.assertNoLive();
});

test('walk seeds change navigation, faults and start state, never the seeded first role identity', () => {
  const title = applicantDraft({which: 'thin'}).search.target_roles[0];
  assert.equal(title, 'Site Reliability Engineer');
  const states = new Set(), faults = new Set(), moves = new Set();
  for (const seed of [0, 2306045166, ...Array.from({length: 400}, (_, i) => i + 1)]) {
    const plan = planWalk(seed);
    states.add(plan.state.id); if (plan.fault) faults.add(plan.fault.id);
    for (const step of plan.steps) moves.add(step.move);
    assert.ok(Object.keys(plan.state.settings || {}).every(key => ['setupDone', 'wizardStep', 'setupFurthest', 'cvName'].includes(key)));
  }
  assert.equal(states.size, 4); assert.equal(faults.size, 10); assert.equal(moves.size, 9);
});

test('wander names undeclared kinds and decide items instead of falling through to transport', async t => {
  const h = await harness(t), changed = structuredClone(captured);
  changed.messages[0].content = changed.messages[0].content.replace('Site Reliability Engineer', 'A new role');
  for (const [init, diagnostic] of [[request('undeclared_wander_kind'), /wander: undeclared_wander_kind.*is unkeyable/],
    [request(''), /wander: unknown:.*is unkeyable/],
    [request('decide', changed), /wander: app.decide item 0 "A new role".*has no stored answer/]]) {
    const missing = {code: 'E2E_AI_ANSWER_MISSING', message: diagnostic};
    assert.throws(() => storedAnswer(init, h.env), missing);
    await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), missing);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 503);
    const {error} = await response.json();
    assert.equal(error.code, missing.code); assert.match(error.message, diagnostic);
  }
  h.assertNoLive();
});

function parserClient(h, calls) {
  return {messages: {create: async (body, {headers}) => {
    const kind = headers['x-jp-action'];
    calls.push(kind);
    const reply = storedAnswer(request(kind, body), h.env).reply;
    assert.ok(reply, `${kind} must parse a successful reply`);
    const schema = body.output_config.format.schema;
    const key = Object.keys(empty[kind])[0];
    assert.ok(schema.required.includes(key));
    assert.equal(schema.properties[key].type, 'array');
    assert.equal(schema.properties[key].minItems || 0, 0);
    return reply;
  }}};
}

test('authored profile replies pass the real judge and movers: no generated IDs, no moves, no error', async t => {
  const h = await harness(t), calls = [], client = parserClient(h, calls);
  for (const id of ['profile:generated-one', 'answers:generated-two']) {
    const items = [{id, page: 'profile', label: 'Notice period', value: 'Three months'}];
    for (const options of [{}, {destinations: [{id: `destination-${id}`, page: 'answers', heading: 'Availability', path: ['Availability']}]}]) {
      const judged = await judge(items, {client}, options);
      assert.equal(judged.size, 0);
      assert.deepEqual(planOf(items, judged), {moves: [], conflicts: []});
    }
  }
  const storage = createStorage(path.join(h.dir, 'profile'), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite', profileUnsure: [{page: 'profile', label: 'Notice period', value: 'Three months'}]});
  const opened = openStore(storage);
  await opened.page('profile').write('## Preferences\n\n- Notice period: Three months\n');
  await opened.page('answers').write('## Answers\n\n- Work permit: EU citizen\n');
  const texts = () => Promise.all(['profile', 'answers'].map(page => opened.page(page).text()));
  const before = await texts();
  const copy = () => assert.fail('nothing moves, so no backup or page writes');
  assert.deepEqual(await move(storage, {ai: {client}, copy}), {moved: 0, conflicts: [], cleared: 0});
  assert.equal((await organize(storage, {ai: {client}, copy})).moved, 0);
  assert.deepEqual(await texts(), before);
  assert.ok(calls.includes('answer_home')); assert.ok(calls.includes('organize_lines'));
  h.assertNoLive();
});

test('authored empty CV proposals parse through propose and explicit again without a raw error', async t => {
  const h = await harness(t), calls = [], client = parserClient(h, calls);
  assert.deepEqual(await propose(client, Buffer.from('fictional PDF'), ['phone', 'street'], 'Profile changes'), {proposals: []});
  const files = new Map(), storage = {readText: file => files.get(file), writeText: (file, text) => files.set(file, text), path: file => file};
  for (const profile of ['first snapshot', 'changed snapshot']) {
    const result = await forCv(storage, {client, contact: {}, cvHash: 'fictional-cv', profile, again: true, read: () => Buffer.from('fictional PDF')});
    assert.deepEqual(result.proposals, []);
    assert.equal(result.error, '');
    assert.equal(result.fresh, true);
  }
  assert.equal(calls.length, 3);
  h.assertNoLive();
});

test('wander fault stretches precede stored answers and pass mode returns to the table', async t => {
  const h = await harness(t), init = request('contact_from_cv');
  for (const mode of ['rate-limit', 'no-credit', 'invalid-key']) {
    h.proxy.setMode(mode);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, FAILURES[mode].status);
    assert.equal((await response.json()).error.message, FAILURES[mode].message);
  }
  h.proxy.setMode('pass');
  assert.equal((await h.localFetch(`${h.proxy.url}/v1/messages`, init)).status, 200);
  h.assertNoLive();
});

test('wander stored successes and refusals also survive the OpenAI following proxy', async t => {
  const h = await harness(t, 'openai');
  for (const kind of [...Object.keys(empty), ...refused]) {
    const init = {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({model: 'test', input: 'different profile', prompt_cache_key: `job-pilotto-${kind}`})};
    const response = await h.localFetch(`${h.openaiProxy.url}/v1/responses`, init);
    assert.equal(response.status, refused.includes(kind) ? 401 : 200, kind);
    if (empty[kind]) assert.deepEqual(JSON.parse((await response.json()).output[0].content[0].text), empty[kind]);
  }
  h.assertNoLive();
});

test('wander declares offline AI and uses backbone on both workflow attempts', () => {
  const source = fs.readFileSync(new URL('../suites/wander.mjs', import.meta.url), 'utf8');
  assert.match(source, /^export const offlineAi = true;/m);
  assert.match(source, /^export const realAi = false;/m);
  // The suite declares it; every workflow reads it from the matrix (plan-run.mjs, tests/test_workflow_ai_answers.py; beta 41078746088: a hand-kept list drifted).
  assert.match(fs.readFileSync(new URL('../suites/wander.mjs', import.meta.url), 'utf8'), /^export const aiAnswers = 'backbone';/m);
});
