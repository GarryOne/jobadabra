// A replayed AI ask must not depend on the ids a store made up for this run (Notion block ids on the stand-in leg), and a leg whose answer cache is empty is a seeding run (lib/ai-meter.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {askKey, noteCacheStart, resetSeeding, resetUsage, seedingRun, usage} from '../lib/ai-meter.mjs';
import {startAiProxy} from '../lib/ai-proxy.mjs';
import {aiMissesVerdict, checkAiMisses} from '../lib/no-real-ai.mjs';

const uuid = n => `${String(n).padStart(8, '0')}-aaaa-4bbb-8ccc-${String(n).padStart(12, '0')}`;
// The shape of the organize ask captured from night burn-in 41269467529 (wizard-standin): destinations and lines carry the store's own block ids.
const organize = ids => Buffer.from(JSON.stringify({model: 'm', messages: [{role: 'user', content: JSON.stringify({
  destinations: [{id: `section:profile:${ids[0]}`, heading: 'Compensation'}], items: [{id: `profile:${ids[1]}`, line: 'Minimum acceptable: CHF 150,000/year'}, {id: `profile:${ids[2]}`, line: 'Languages: English'}]})}]}));

test('two runs of one ask whose store ids differ share one key; a different line or a different id pattern does not', () => {
  const run1 = organize([uuid(1), uuid(2), uuid(3)]), run2 = organize([uuid(7), uuid(8), uuid(9)]);
  assert.notDeepEqual(run1, run2, 'positive control: the two runs really differ');
  assert.equal(askKey('/v1/messages', run1).key, askKey('/v1/messages', run2).key);
  assert.notEqual(askKey('/v1/messages', run1).key, askKey('/v1/messages', Buffer.from(run2.toString().replace('English', 'German'))).key);
  assert.notEqual(askKey('/v1/messages', run1).key, askKey('/v1/messages', organize([uuid(1), uuid(2), uuid(2)])).key, 'one id used twice is not two ids');
});

test('a body without a store id keeps the key it always had', async () => {
  const {requestKey} = await import('../lib/ai-meter.mjs');
  const body = Buffer.from(JSON.stringify({model: 'm', messages: [{role: 'user', content: 'section:profile:L0'}]}));
  assert.equal(askKey('/v1/messages', body).key, requestKey('/v1/messages', body));
  assert.deepEqual(askKey('/v1/messages', body).ids, []);
});

async function echoingModel() {
  const seen = {calls: 0};
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      seen.calls++;
      const ids = Buffer.concat(chunks).toString().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [];
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({id: 'm1', type: 'message', model: 'claude-haiku-4-5', content: [{type: 'text', text: JSON.stringify({items: ids.map(id => ({id, home: 'stay'}))})}], usage: {input_tokens: 1, output_tokens: 1}}));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise(resolve => server.close(resolve))};
}

test('the proxy replays a kept answer for the next run\'s ids, and the answer names that run\'s ids', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-store-ids-')), upstream = await echoingModel();
  const saved = {cache: process.env.E2E_AI_CACHE, replay: process.env.E2E_AI_REPLAY};
  t.after(async () => { await upstream.close(); process.env.E2E_AI_CACHE = saved.cache ?? ''; process.env.E2E_AI_REPLAY = saved.replay ?? ''; fs.rmSync(dir, {recursive: true, force: true}); });
  process.env.E2E_AI_CACHE = dir; process.env.E2E_AI_REPLAY = '1';
  resetUsage();
  const proxy = await startAiProxy({target: upstream.url});
  const ask = ids => fetch(`${proxy.url}/v1/messages`, {method: 'POST', headers: {'content-type': 'application/json'}, body: organize(ids)}).then(r => r.json());
  const named = reply => JSON.parse(reply.content[0].text).items.map(item => item.id);
  const first = await ask([uuid(1), uuid(2), uuid(3)]);
  assert.equal(upstream.seen.calls, 1, 'positive control: the first run reached the model');
  assert.deepEqual(named(first), [uuid(1), uuid(2), uuid(3)]);
  const second = await ask([uuid(7), uuid(8), uuid(9)]);
  assert.equal(upstream.seen.calls, 1, 'the second run was answered from the cache');
  assert.equal(usage().app.replayed, 1);
  assert.deepEqual(named(second), [uuid(7), uuid(8), uuid(9)], 'the replayed answer carries the second run\'s ids, never the first run\'s');
  await proxy.close();
});

test('an answer kept under the old raw key still replays for the same ids', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-store-ids-old-')), upstream = await echoingModel();
  const saved = {cache: process.env.E2E_AI_CACHE, replay: process.env.E2E_AI_REPLAY};
  t.after(async () => { await upstream.close(); process.env.E2E_AI_CACHE = saved.cache ?? ''; process.env.E2E_AI_REPLAY = saved.replay ?? ''; fs.rmSync(dir, {recursive: true, force: true}); });
  const {requestKey} = await import('../lib/ai-meter.mjs');
  const body = organize([uuid(1), uuid(2), uuid(3)]), reply = {id: 'old', type: 'message', model: 'claude-haiku-4-5', content: [{type: 'text', text: 'old answer'}], usage: {input_tokens: 1, output_tokens: 1}};
  fs.writeFileSync(path.join(dir, `${requestKey('/v1/messages', body)}.json`), JSON.stringify({status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(reply)).toString('base64')}));
  process.env.E2E_AI_CACHE = dir; process.env.E2E_AI_REPLAY = '1';
  resetUsage();
  const proxy = await startAiProxy({target: upstream.url});
  const got = await fetch(`${proxy.url}/v1/messages`, {method: 'POST', headers: {'content-type': 'application/json'}, body}).then(r => r.json());
  assert.equal(got.content[0].text, 'old answer');
  assert.equal(upstream.seen.calls, 0);
  await proxy.close();
});

test('a leg that starts with an empty answer cache is a seeding run: its misses are saved for the next run, not a red', t => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-seed-')), artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-seed-art-'));
  t.after(() => { resetSeeding(); fs.rmSync(cache, {recursive: true, force: true}); fs.rmSync(artifacts, {recursive: true, force: true}); });
  fs.mkdirSync(path.join(artifacts, 'ai-misses')); fs.writeFileSync(path.join(artifacts, 'ai-misses', 'a.json'), '{}');
  const env = {E2E_AI_CACHE: cache, E2E_AI_REPLAY: '1'};
  resetSeeding(); noteCacheStart(env);
  assert.equal(seedingRun(env), true);
  assert.equal(checkAiMisses(artifacts, {aiMissesMax: 0}, seedingRun(env)).ok, true, 'seeding: not red');
  assert.equal(checkAiMisses(artifacts, {aiMissesMax: 0}, seedingRun(env)).misses, 1, 'the miss is still counted');
  assert.equal(checkAiMisses(artifacts, {aiMissesMax: 0}, false).ok, false, 'positive control: the same miss on a seeded leg is red');
  assert.equal(aiMissesVerdict(3, {aiMissesMax: 0}, 'k', false).ok, false);
});

test('a leg with kept answers, a backbone suite, or no replay is never a seeding run', t => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-seed2-'));
  t.after(() => { resetSeeding(); fs.rmSync(cache, {recursive: true, force: true}); });
  const env = {E2E_AI_CACHE: cache, E2E_AI_REPLAY: '1'};
  resetSeeding(); noteCacheStart(env);
  assert.equal(seedingRun({...env, E2E_AI_ANSWERS: 'backbone'}), false, 'a backbone suite keeps its zero ceiling');
  assert.equal(seedingRun({...env, E2E_AI_REPLAY: '0'}), false);
  fs.writeFileSync(path.join(cache, 'x.json'), '{}');
  resetSeeding(); noteCacheStart(env);
  assert.equal(seedingRun(env), false, 'one kept answer: the ceiling applies');
  resetSeeding();
  assert.equal(seedingRun(env), false, 'never noted: not seeding');
});
