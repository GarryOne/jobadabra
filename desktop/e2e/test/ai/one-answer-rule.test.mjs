// One rule for every e2e suite and integration test: an app's AI ask is answered by a stand-in or by its name, never by its exact text; one nothing answers is refused, naming the step.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {requestKey} from '../../lib/ai-meter.mjs';
import {startAiProxy} from '../../lib/ai-proxy.mjs';
import {setStep} from '../../lib/step-now.mjs';

const E2E = path.resolve(import.meta.dirname, '..', '..'), REPO = path.resolve(E2E, '..', '..');
const ASK = JSON.stringify({model: 'claude-haiku-5-5', max_tokens: 50, messages: [{role: 'user', content: 'Which roles fit this CV?'}]});

// The run's own folders and switches, as a CI replay sets them; restored after.
function runEnv(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-answer-'));
  const values = {E2E_AI_ANSWERS: 'off', E2E_SUITE: 'somesuite', E2E_ARTIFACTS: path.join(dir, 'artifacts'), E2E_AI_CACHE: path.join(dir, 'cache'), E2E_AI_REPLAY: '1', ...extra};
  const saved = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  Object.assign(process.env, values);
  fs.mkdirSync(values.E2E_ARTIFACTS, {recursive: true});
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    setStep('');
    fs.rmSync(dir, {recursive: true, force: true});
  });
  return values;
}

// A model that counts the asks that reached it.
async function upstream(t) {
  const model = {asks: 0};
  const server = http.createServer((req, res) => { model.asks++; res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({type: 'message', model: 'claude-haiku-5-5', content: [{type: 'text', text: 'live'}], usage: {input_tokens: 1, output_tokens: 1}})); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {url: `http://127.0.0.1:${server.address().port}`, get count() { return model.asks; }};
}

const ask = proxy => fetch(`${proxy.url}/v1/messages`, {method: 'POST', headers: {'content-type': 'application/json'}, body: ASK});

test('an ask no stand-in or stored answer took is refused, naming its step; an answer kept for its exact text is never used and no model is reached', async t => {
  const env = runEnv(t), model = await upstream(t);
  // Positive control: the answer the old replay would have served for these exact bytes is there.
  fs.mkdirSync(env.E2E_AI_CACHE, {recursive: true});
  fs.writeFileSync(path.join(env.E2E_AI_CACHE, `${requestKey('/v1/messages', Buffer.from(ASK))}.json`), JSON.stringify({status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify({content: [{type: 'text', text: 'kept'}]})).toString('base64')}));
  const proxy = await startAiProxy({target: model.url}); t.after(() => proxy.close());
  setStep('the strategy is built from the CV');
  const answer = await ask(proxy);
  assert.equal(answer.status, 503);
  const {error} = await answer.json();
  assert.equal(error.code, 'E2E_AI_ANSWER_MISSING');
  assert.match(error.message, /^somesuite: .*: unlabelled AI request in step "the strategy is built from the CV"/);
  assert.equal(model.count, 0, 'no model is reached');
  const refusals = JSON.parse(fs.readFileSync(path.join(env.E2E_ARTIFACTS, 'ai-answer-refusals.json'), 'utf8'));
  assert.equal(refusals.length, 1, 'the refusal is recorded, so the suite fails at its end (lib/suite-main.mjs)');
});

test('only a live caller sends an unanswered ask on to the model', async t => {
  runEnv(t);
  const model = await upstream(t);
  const proxy = await startAiProxy({target: model.url, live: true}); t.after(() => proxy.close());
  const answer = await ask(proxy);
  assert.equal(answer.status, 200);
  assert.equal(model.count, 1);
});

test('a record run still asks the model, to write the answer down by name', async t => {
  runEnv(t, {E2E_AI_ANSWERS: 'record'});
  const model = await upstream(t);
  const proxy = await startAiProxy({target: model.url}); t.after(() => proxy.close());
  assert.equal((await ask(proxy)).status, 200);
  assert.equal(model.count, 1);
});

// Why (2 Nov 2026, owner: "I want the guardrail to be general, for any e2e or itnegrations"): every place that starts the stand-in, e2e or integration, is held to the rule.
test('no e2e or integration code starts a live stand-in except a live measurement suite and the live row', () => {
  const callers = execFileSync('git', ['grep', '-n', 'startAiProxy(', '--', 'desktop/e2e/lib', 'desktop/e2e/suites', 'desktop/integration', 'tools'], {cwd: REPO, encoding: 'utf8'})
    .split('\n').filter(line => line && !line.includes('export async function startAiProxy'));
  assert.ok(callers.some(line => line.startsWith('desktop/integration/store/engine-kit.mjs')), 'the integration kit starts the stand-in');
  const live = callers.filter(line => /\blive:/.test(line)).map(line => `${line.split(':')[0]} ${line.match(/\blive: [\w.]+/)[0]}`);
  assert.deepEqual([...new Set(live)].sort(), ['desktop/e2e/lib/context.mjs live: liveAi', 'desktop/e2e/lib/live-row.mjs live: true']);
  assert.match(fs.readFileSync(path.join(E2E, 'lib', 'suite-main.mjs'), 'utf8'), /liveAi: suite\.realAi === true/);
});

test('a suite that may reach a model is a live measurement, never a gate', async () => {
  const live = [];
  for (const file of fs.readdirSync(path.join(E2E, 'suites')).filter(name => name.endsWith('.mjs'))) {
    if (!/^export const realAi = true;/m.test(fs.readFileSync(path.join(E2E, 'suites', file), 'utf8'))) continue;
    const suite = await import(path.join(E2E, 'suites', file));
    live.push(suite.name);
    assert.ok(['manual', 'night-report'].includes(suite.cadence), `${file}: realAi = true only on a measurement suite (cadence manual or night-report), not ${suite.cadence}`);
  }
  assert.deepEqual(live.sort(), ['explore', 'personas', 'qualityai']);
});
