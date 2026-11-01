// Prove interview reviews and patterns use declared answers with no live key or AI transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {loadTable, questionOf, storedAnswer} from '../../lib/ai-answers.mjs';
import {DUMMY_KEY} from '../../lib/engine.mjs';
import {FAILURES} from '../../lib/ai-proxy.mjs';
import {answersTableFile, backboneHarness} from '../../lib/backbone-harness.mjs';
import {contextAiKeys} from '../../lib/context.mjs';
import {modelFetch} from '../../lib/model.mjs';
import {python, pythonEnv} from '../../lib/python.mjs';

const background = ['organize_lines', 'contact_asks', 'covered_facts', 'reuse_verdict', 'field_redraft'];
const captions = ['recruiter-call-gamma', 'E2E Acme · Round 1'];
const {requests: decideRequests} = JSON.parse(fs.readFileSync(new URL('../../fixtures/golden/interviews-decide.json', import.meta.url), 'utf8'));
const verdicts = [
  ['recruiter-call-gamma', 'recruiter_screen'],
  ['cloud engineer', 'software'], ['devops engineer', 'software'], ['infrastructure engineer', 'software'],
  ['platform engineer', 'software'], ['site reliability engineer', 'software'], ['systems administrator', 'software'],
  ['Recruiter screen', 'recruiter_screen'], ['Technical', 'technical'], ['Hiring manager', 'hiring_manager'],
];

async function harness(t, family = 'claude') {
  const h = await backboneHarness(t, 'interviews', family);
  // Keep interviews' revoked-versus-missing key coverage inside the shared isolation.
  Object.assign(h.env, {E2E_ANTHROPIC_KEY: 'revoked', E2E_OPENAI_KEY: 'revoked'});
  Object.assign(process.env, h.env);
  const keys = await contextAiKeys({offlineAi: true, family, engine: 'api'});
  assert.deepEqual(keys.needsKey, []);
  assert.equal(keys.key, DUMMY_KEY);
  delete process.env.E2E_ANTHROPIC_KEY; delete process.env.E2E_OPENAI_KEY;
  assert.deepEqual(await contextAiKeys({offlineAi: true, family, engine: 'api'}), keys);
  return h;
}

const request = (action, content = 'background request') => ({method: 'POST',
  headers: {'content-type': 'application/json', ...(action ? {'x-jp-action': action} : {})},
  body: JSON.stringify({model: 'test', messages: [{role: 'user', content}]})});
const review = caption => request('interview', `Applications:\n0. Reordered job\n\nCaption: ${caption}\n\nTranscript or notes:\nfixture transcript`);

test('interviews resolves all ten captured decide items through the real validator before any transport', async t => {
  const h = await harness(t), table = loadTable(answersTableFile), cases = [], seen = [];
  for (const body of decideRequests) {
    const init = {...request('decide'), body: JSON.stringify(body)}, question = questionOf(init, h.env, table);
    assert.equal(question.operation, 'app.decide');
    const expected = {results: question.items.map(({index, text, key}) => {
      const answer = new Map(verdicts).get(text);
      assert.ok(answer, `unexpected captured item: ${text}`);
      assert.deepEqual(table.items['app.decide'][key], {text, answer});
      seen.push([text, answer]);
      const single = structuredClone(body);
      single.messages[0].content = `${body.messages[0].content.split('### Item 0\n')[0]}### Item 0\n${text}`;
      const {reply} = storedAnswer({...init, body: JSON.stringify(single)}, h.env);
      assert.deepEqual(JSON.parse(reply.content[0].text), {results: [{index: 0, answer}]});
      return {index, answer};
    })};
    const {reply} = storedAnswer(init, h.env);
    assert.deepEqual(JSON.parse(reply.content[0].text), expected);
    const direct = await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options);
    assert.deepEqual(JSON.parse((await direct.json()).content[0].text), expected);
    const proxied = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(proxied.status, 200);
    assert.deepEqual(JSON.parse((await proxied.json()).content[0].text), expected);
    cases.push({request: body, reply});
  }
  assert.deepEqual(seen, verdicts);
  const dir = h.env.E2E_ARTIFACTS;
  const parsed = execFileSync(python(), ['-c', `
import json, socket, sqlite3, sys
from types import SimpleNamespace as NS
from unittest.mock import patch
def forbidden(*args, **kwargs):
    raise AssertionError('no network in decide validator test')
socket.socket.connect = forbidden
from src.ai import decide, meanings_pack
data = json.load(sys.stdin)
found = {}
for case in data:
    request, reply = case['request'], case['reply']
    task, rest = request['messages'][0]['content'].removeprefix('Task: ').split('\\nAllowed answers: ', 1)
    allowed, blocks = rest.split('\\n\\n', 1)
    items = {str(i): block.split('\\n', 1)[1] for i, block in enumerate(blocks.split('\\n\\n'))}
    asked = []
    def create(**body):
        asked.append(body)
        assert body['messages'] == request['messages']
        assert body['output_config']['format']['schema'] == request['output_config']['format']['schema']
        return NS(content=[NS(**part) for part in reply['content']], stop_reason=reply['stop_reason'], usage=None)
    with sqlite3.connect(':memory:') as db, patch.object(meanings_pack, 'first', return_value=None), \\
         patch.object(meanings_pack, 'queue'):
        result = decide.decide('interviews-validator', items, allowed.split(', '), task,
                               client=NS(messages=NS(create=create)), db=db)
    assert len(asked) == 1
    assert result is not None and set(result) == set(items), result
    found.update({text: result[key] for key, text in items.items()})
print(json.dumps(found))
`], {cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
    env: pythonEnv({PYTHONDONTWRITEBYTECODE: '1', JOB_PILOTTO_DATA_DIR: dir,
      JOB_PILOTTO_CONFIG_DIR: dir, JOB_PILOTTO_APP_DIR: dir}, {home: dir}),
    input: JSON.stringify(cases), encoding: 'utf8', timeout: 10000});
  assert.deepEqual(JSON.parse(parsed), Object.fromEntries(verdicts));
  h.assertNoLive();
});

test('interviews serves both keyed reviews and the kind-only aggregate at every seam before live AI', async t => {
  const h = await harness(t), table = loadTable(answersTableFile);
  const asks = [...captions.map(caption => [review(caption), table.answers['app.interview']?.[caption]?.reply]),
    ...['first review collection', 'changed reviews and dates'].map(text => [request('interview_patterns', text), table.kinds.interview_patterns?.answer.reply])];
  for (const [init, expected] of asks) {
    assert.ok(expected, 'the asserted question needs a real stored reply');
    assert.deepEqual(storedAnswer({url: '/v1/messages', ...init}, h.env), {reply: expected});
    assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), expected);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  }
  const refused = background.filter(kind => table.kinds[kind].answer.refuse);
  for (const kind of refused) {
    assert.deepEqual(table.kinds[kind].answer, {refuse: 'invalid-key'});
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, request(kind));
    assert.equal(response.status, 401, kind);
  }
  for (const kind of background.filter(kind => !refused.includes(kind))) {
    const init = request(kind), expected = table.kinds[kind].answer.reply;
    assert.ok(expected, `${kind} needs an authored reply`);
    assert.deepEqual(storedAnswer({url: '/v1/messages', ...init}, h.env), {reply: expected});
    assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), expected);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 200, kind);
    assert.deepEqual(await response.json(), expected);
  }
  assert.equal(h.proxy.stats.failed, refused.length);
  h.assertNoLive();
});

for (const [init, diagnostic] of [[request('undeclared_interviews_kind'), /interviews: undeclared_interviews_kind.*is unkeyable/],
  [review('new-round'), /interviews: app.interview\/new-round.*has no stored answer/],
  [request('interview'), /interviews: interview.*caption.*is unkeyable/],
  [request(''), /interviews: unknown:.*is unkeyable/]]) {
  test(`interviews fails an undeclared question by name: ${diagnostic}`, async t => {
    const h = await harness(t), missing = {code: 'E2E_AI_ANSWER_MISSING', message: diagnostic};
    assert.throws(() => storedAnswer({url: '/v1/messages', ...init}, h.env), missing);
    await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), missing);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 503);
    const {error} = await response.json();
    assert.equal(error.code, missing.code);
    assert.match(error.message, diagnostic);
    h.assertNoLive();
  });
}

test('interviews no-credit fault precedes even a real stored review, then pass mode uses the table', async t => {
  const h = await harness(t), init = review(captions[0]);
  h.proxy.setMode('no-credit');
  for (const faulted of [init, review('recruiter-call-failing')]) {
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, faulted);
    assert.equal(response.status, FAILURES['no-credit'].status);
    assert.match((await response.json()).error.message, /credit/i);
  }
  h.proxy.setMode('pass');
  assert.equal((await h.localFetch(`${h.proxy.url}/v1/messages`, init)).status, 200);
  h.assertNoLive();
});

test('interviews stored replies survive the OpenAI following proxy', async t => {
  const h = await harness(t, 'openai');
  const response = await h.localFetch(`${h.openaiProxy.url}/v1/responses`, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({model: 'test', input: 'different aggregate', prompt_cache_key: 'jobadabra-interview_patterns'})});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.object, 'response');
  h.assertNoLive();
});
