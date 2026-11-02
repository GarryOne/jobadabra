// Unknown-question refusals expose only bounded identity previews through the shared answer seam.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {test} from 'node:test';
import {answerFor, questionOf, refusal, refusedQuestions, storedAnswer} from '../../lib/ai-answers.mjs';
import {startAiProxy} from '../../lib/ai-proxy.mjs';
import {modelFetch} from '../../lib/model.mjs';
import {assertNoRealAi, runAiGuards} from '../../lib/no-real-ai.mjs';
import {askOf, bodyOf, engineCases, tempTable} from '../ai-answers-engine-fixtures.mjs';

const system = `Unrecognized SYSTEM\n  ${'s'.repeat(200)}SYSTEM_TAIL_CANARY`;
const user = `Unrecognized first user\r\n  ${'u'.repeat(150)}USER_TAIL_CANARY`;
const collapsed = text => text.replace(/\s+/g, ' ');
const forbidden = ['SYSTEM_TAIL_CANARY', 'USER_TAIL_CANARY', 'SECOND_USER_CANARY', 'ASSISTANT_CANARY', 'CV_BODY_CANARY', 'IMAGE_BODY_CANARY', 'UNRELATED_HEADER_CANARY'];
const bodyFor = shape => shape === 'anthropic' ? {
  model: 'diagnostic-model', system: [{type: 'text', text: system}], cv: 'CV_BODY_CANARY',
  messages: [{role: 'assistant', content: 'ASSISTANT_CANARY'}, {role: 'user', content: [{type: 'text', text: user}, {type: 'image', source: {data: 'IMAGE_BODY_CANARY'}}]}, {role: 'user', content: 'SECOND_USER_CANARY'}],
} : {
  model: 'diagnostic-model', instructions: system, prompt_cache_key: 'jobadabra-unidentified', cv: 'CV_BODY_CANARY',
  input: [{role: 'assistant', content: 'ASSISTANT_CANARY'}, {role: 'user', content: [{type: 'input_text', text: user}, {type: 'input_image', image_url: 'IMAGE_BODY_CANARY'}]}, {role: 'user', content: 'SECOND_USER_CANARY'}],
};
function checkPreview(message, action) {
  const marker = '; request=', start = message.indexOf(marker);
  assert.ok(start >= 0, 'the shared refusal must include an identity preview');
  const preview = JSON.parse(message.slice(start + marker.length));
  assert.deepEqual(preview, {'x-jp-action': action, system: collapsed(system).slice(0, 160), user: collapsed(user).slice(0, 100), model: 'diagnostic-model'});
  assert.equal(preview.system.length, 160); assert.equal(preview.user.length, 100);
  assert.equal(preview.system.length + preview.user.length, 260);
  assert.ok(!/[\r\n]/.test(message));
  for (const canary of forbidden) assert.ok(!message.includes(canary), canary);
  return preview;
}

for (const shape of ['anthropic', 'openai']) for (const action of ['none', 'unrecognized-action']) test(`${shape} ${action}: all refusal consumers share the same bounded diagnostic and make no live call`, async t => {
  const {dir, env} = tempTable(t), scoped = {...env, E2E_SUITE: 'diagnostics'};
  const saved = {...process.env}; Object.assign(process.env, scoped);
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  let live = 0, engines = 0, relays = 0;
  const server = http.createServer((_req, res) => { live++; res.writeHead(500); res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const target = `http://127.0.0.1:${server.address().port}`;
  const proxy = await startAiProxy({target, shape, relay: () => { relays++; throw new Error('must not relay'); }}); t.after(() => proxy.close());
  const body = bodyFor(shape), headers = {'content-type': 'application/json', unrelated: 'UNRELATED_HEADER_CANARY', ...(action === 'none' ? {} : {'x-jp-action': action})};
  const init = {method: 'POST', headers, body: JSON.stringify(body)}, pathname = shape === 'openai' ? '/v1/responses' : '/v1/messages';
  let direct;
  assert.throws(() => storedAnswer({url: pathname, headers, body: Buffer.from(init.body)}, scoped), error => {
    direct = error.message; assert.equal(error.code, 'E2E_AI_ANSWER_MISSING'); checkPreview(error.message, action); return true;
  });
  await assert.rejects(modelFetch(`${target}${pathname}`, init, {env: scoped, engine: () => { engines++; throw new Error('must not choose engine'); }}), error => {
    assert.equal(error.message.replaceAll(target, ''), direct); checkPreview(error.message, action); return true;
  });
  const response = await fetch(`${proxy.url}${pathname}`, init);
  assert.equal(response.status, 503); assert.equal((await response.json()).error.message, direct);
  const registry = refusedQuestions(scoped); assert.equal(registry.length, 3);
  for (const entry of registry) { assert.equal(entry.message.replaceAll(target, ''), direct); checkPreview(entry.message, action); }
  const persisted = fs.readFileSync(path.join(dir, 'ai-answer-refusals.json'), 'utf8');
  assert.deepEqual(JSON.parse(persisted), registry);
  for (const canary of forbidden) assert.ok(!persisted.includes(canary));
  const ctx = {proxy, ARTIFACTS: dir};
  await runAiGuards({realAi: false}, ctx, async (_name, check) => check()); assertNoRealAi(ctx);
  assert.equal(live, 0); assert.equal(engines, 0); assert.equal(relays, 0); assert.equal(proxy.stats.paid || 0, 0);
});

test('an identified missing item retains its exact named refusal without request text', t => {
  const {env} = tempTable(t), c = engineCases.find(c => c.name === 'enrich'), request = askOf(c, bodyOf(c));
  const question = questionOf(request, env), found = answerFor(question, {answers: {}, items: {}});
  const expected = refusal('default', {...question, unkeyable: found.missing}, 'has no stored answer', request);
  assert.throws(() => storedAnswer(request, env), error => { assert.equal(error.message, expected.message); assert.ok(error.message.includes(c.first)); assert.ok(!error.message.includes('; request=')); return true; });
});

test('a missing question or unsupported answer kind gets the same diagnostic builder', () => {
  const request = {body: bodyFor('anthropic')};
  checkPreview(refusal('quality', undefined, 'is unkeyable', request).message, 'none');
  const found = answerFor({operation: 'app.not-registered', id: 'x'}, {answers: {}});
  assert.match(found.unkeyable, /app.not-registered/);
  checkPreview(refusal('quality', found, 'is unkeyable', request).message, 'none');
});
