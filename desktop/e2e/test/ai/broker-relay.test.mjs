// Guards the app-under-test relay (lib/broker-relay.mjs): a PDF goes in as text, a streamed call is answered as events, tools and a broker "no" are said out loud.
import test from 'node:test';
import assert from 'node:assert/strict';
import {answerViaBroker, streamOf, withPdfAsText} from '../../lib/broker-relay.mjs';
import {startAiProxy} from '../../lib/ai-proxy.mjs';

const answered = (text = '{"ok":true}') => async () => ({ok: true, model: 'gpt-6-luna', message: {content: [{type: 'text', text}], stop_reason: 'end_turn', usage: {input_tokens: 9, output_tokens: 3}}});
const request = extra => ({model: 'claude-haiku-5-5', max_tokens: 100, messages: [{role: 'user', content: 'hi'}], ...extra});

test('a plain call comes back as a Messages answer with its usage; the model is the Codex one', async () => {
  const out = await answerViaBroker(request(), {ask: answered()});
  const message = JSON.parse(out.body.toString('utf8'));
  assert.equal(out.status, 200);
  assert.deepEqual([message.type, message.role, message.model, message.content[0].text, message.usage], ['message', 'assistant', 'gpt-6-luna', '{"ok":true}', {input_tokens: 9, output_tokens: 3}]);
});

test('a streamed call is answered as the SDK reads a stream: start, one text delta, stop', async () => {
  const out = await answerViaBroker(request({stream: true}), {ask: answered('hello')});
  assert.equal(out.contentType, 'text/event-stream');
  const events = out.body.toString('utf8').split('\n\n').filter(Boolean).map(block => JSON.parse(block.split('data: ')[1]));
  assert.deepEqual(events.map(event => event.type), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.equal(events[2].delta.text, 'hello');
  assert.equal(JSON.parse(out.counted).usage.output_tokens, 3);
  assert.match(streamOf('x', 'm', {input_tokens: 1, output_tokens: 1}), /^event: message_start/);
});

test('a PDF document block is sent as the text pdf.js reads from it; other parts stay', async () => {
  const body = request({messages: [{role: 'user', content: [{type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: 'QQ=='}}, {type: 'text', text: 'Transcribe this CV.'}]}]});
  const seen = [];
  const out = await withPdfAsText(body, async data => { seen.push(data); return 'Jane Doe, nurse'; });
  assert.deepEqual(seen, ['QQ==']);
  assert.match(out.messages[0].content[0].text, /as the text it holds\]\nJane Doe, nurse/);
  assert.equal(out.messages[0].content[1].text, 'Transcribe this CV.');
});

test('unsupported tools are refused with a 400 and the broker saying no is a 503 with its reason, never another provider', async () => {
  const tools = await answerViaBroker(request({tools: [{name: 'x'}]}), {ask: answered()});
  assert.equal(tools.status, 400);
  const no = await answerViaBroker(request(), {env: {}, ask: async () => ({ok: false, status: 'capped', detail: 'broker: budget:week 85%'})});
  assert.equal(no.status, 503);
  assert.match(JSON.parse(no.body.toString('utf8')).error.message, /AI broker said no \(broker: budget:week 85%/);
  const lost = await answerViaBroker(request(), {ask: async () => ({ok: false, status: 'no-token', detail: 'no GitHub OIDC token here'})});
  assert.match(JSON.parse(lost.body.toString('utf8')).error.message, /no GitHub OIDC token/);
});

test('the proxy sends a metered call through the relay and answers with the relay body', async () => {
  let asks = 0;
  const proxy = await startAiProxy({kind: 'app-codex', live: true, relay: async body => { asks++; return answerViaBroker(body, {ask: answered('{"a":1}')}); }});   // the relay is the live leg
  try {
    const call = () => fetch(`${proxy.url}/v1/messages`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(request())}).then(response => response.json());
    assert.equal((await call()).content[0].text, '{"a":1}');
    assert.equal(asks, 1);
  } finally { await proxy.close(); }
});

test('pdfText reads the words out of a real PDF', async () => {
  const {PDFDocument, StandardFonts} = await import('pdf-lib');
  const doc = await PDFDocument.create(), page = doc.addPage();
  page.drawText('Jane Doe nurse', {x: 50, y: 700, font: await doc.embedFont(StandardFonts.Helvetica), size: 12});
  const {pdfText} = await import('../../lib/broker-relay.mjs');
  assert.match(await pdfText(Buffer.from(await doc.save()).toString('base64')), /Jane Doe nurse/);
});

test('a relay that throws (a bad body, a bad PDF) is a 502 answer and the proxy keeps serving', async () => {
  const proxy = await startAiProxy({kind: 'app-codex', live: true, relay: async () => { throw new Error('bad pdf'); }});
  try {
    const first = await fetch(`${proxy.url}/v1/messages`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
    assert.equal(first.status, 502);
    assert.match((await first.json()).error.message, /relay: bad pdf/);
    assert.equal((await fetch(`${proxy.url}/v1/messages`, {method: 'POST', body: '{}'})).status, 502);
  } finally { await proxy.close(); }
});

test('with the app on codex in CI no other family bills it and its key is the placeholder', async () => {
  const {pickFamily, testKey, DUMMY_KEY} = await import('../../lib/engine.mjs');
  const env = {CI: 'true', GITHUB_RUN_NUMBER: '1', E2E_OPENAI_KEY: 'k', E2E_FREE_AI_URL: 'http://x', E2E_FREE_AI_KEY: 'k', CI_AI_PROVIDER: 'codex'};
  assert.equal(pickFamily(env), 'claude');
  assert.equal(testKey(env), DUMMY_KEY);
  assert.equal(pickFamily({...env, CI_AI_PROVIDER: 'free'}), 'free');
});

// The persona wrapper must route both SDKs locally, keep OIDC in the relay, and return the child's failure without API fallback.
test('a persona child uses only the Codex relay; credentials never reach the child', async () => {
  const {runOnCodex} = await import('../../../../tools/persona-search/codex.mjs');
  const code = await runOnCodex(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const env = process.env;
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
    assert.equal(env.JOBADABRA_E2E_AI_BASE_URL, env.ANTHROPIC_BASE_URL);
    const reply = await fetch(env.ANTHROPIC_BASE_URL + '/v1/messages', {method: 'POST', body: JSON.stringify({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'hi'}]})});
    assert.equal(reply.status, 200);
    assert.equal((await reply.json()).content[0].text, 'from Codex');
  `], {env: {...process.env, CI: 'true', CI_AI_PROVIDER: 'codex', E2E_AI_PROVIDER: 'codex', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid', ANTHROPIC_API_KEY: 'paid', OPENAI_API_KEY: 'paid'}, ask: answered('from Codex')});
  assert.equal(code, 0);
});

test('a persona broker refusal stays an error and the wrapper returns the child exit code', async () => {
  const {runOnCodex} = await import('../../../../tools/persona-search/codex.mjs');
  const code = await runOnCodex(process.execPath, ['--input-type=module', '-e', `
    const reply = await fetch(process.env.ANTHROPIC_BASE_URL + '/v1/messages', {method: 'POST', body: JSON.stringify({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'hi'}]})});
    process.exit(reply.status === 503 ? 7 : 9);
  `], {env: {...process.env, CI: 'true', CI_AI_PROVIDER: 'codex', E2E_AI_PROVIDER: 'codex', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid'}, ask: async () => ({ok: false, status: 'no-token', detail: 'refused'})});
  assert.equal(code, 7);
  await assert.rejects(runOnCodex('unused', [], {env: {CI: 'true', CI_AI_PROVIDER: 'claude'}}), /Codex/);
});

test('a persona stamped prompt always reaches Codex, even when the e2e golden stamp is stale', async t => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const {storedAnswer} = await import('../../lib/ai-answers.mjs');
  const {runOnCodex} = await import('../../../../tools/persona-search/codex.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-relay-'));
  const file = path.join(dir, 'answers.json');
  const {request: original, action} = JSON.parse(fs.readFileSync(new URL('../../fixtures/golden/ai-format-python.json', import.meta.url))).entries.find(entry => entry.kind === 'app.title');
  const body = {...original, system: 'Changed title instructions for this PR.'};
  fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, promptHashes: {'app.title': '0'.repeat(64)}}));
  const previous = Object.fromEntries(['E2E_AI_ANSWERS_FILE', 'E2E_ARTIFACTS'].map(key => [key, process.env[key]]));
  Object.assign(process.env, {E2E_AI_ANSWERS_FILE: file, E2E_ARTIFACTS: dir});
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } fs.rmSync(dir, {recursive: true, force: true}); });
  assert.throws(() => storedAnswer({body, headers: {'x-jp-action': action}}), /stale: prompt changed app.title/);
  let asks = 0;
  const code = await runOnCodex(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const reply = await fetch(process.env.ANTHROPIC_BASE_URL + '/v1/messages', {method: 'POST', headers: {'x-jp-action': ${JSON.stringify(action)}}, body: ${JSON.stringify(JSON.stringify(body))}});
    assert.equal(reply.status, 200);
    assert.equal((await reply.json()).content[0].text, 'fresh from Codex');
  `], {env: {...process.env, CI: 'true', CI_AI_PROVIDER: 'codex', E2E_AI_PROVIDER: 'codex', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid'},
    ask: async asked => { asks++; assert.equal(asked.system, 'Changed title instructions for this PR.'); return answered('fresh from Codex')(); }});
  assert.equal(code, 0);
  assert.equal(asks, 1);
});


test('persona timing logs total, broker execution, residual and concurrent calls without prompt contents', async () => {
  const {timedRelay} = await import('../../../../tools/persona-search/codex.mjs');
  let clock = 1000;
  const lines = [], finish = [];
  const relay = timedRelay({now: () => clock, log: line => lines.push(line),
    ask: () => new Promise(resolve => finish.push(() => resolve({ok: true, ms: 70, model: 'gpt-6-luna', message: {content: [{type: 'text', text: 'ok'}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}}})))});
  const first = relay(request({messages: [{role: 'user', content: 'private-prompt'}]}), 'places');
  const second = relay(request(), 'decide');
  await new Promise(resolve => setImmediate(resolve));
  clock = 1120;
  finish[0]();
  assert.equal((await first).status, 200);
  clock = 1150;
  finish[1]();
  await second;
  assert.match(lines[0], /^relay: small total 120 broker 70 waited 50 in-flight 2 prompt-chars 20 kind places start 1000 status 200 sent yes tools 0 out-tokens 1$/);
  assert.match(lines[1], /total 150 broker 70 waited 80 in-flight 1/);
  assert.ok(lines.every(line => !line.includes('private-prompt')));
});

test('persona timing records rejected unsupported tools and missing broker measurements honestly', async () => {
  const {timedRelay} = await import('../../../../tools/persona-search/codex.mjs');
  const lines = [];
  const relay = timedRelay({now: () => 10, log: line => lines.push(line), ask: async () => { throw new Error('must not send a tool request'); }});
  assert.equal((await relay(request({tools: [{type: 'function', name: 'unsupported'}]}), 'scout')).status, 400);
  assert.match(lines[0], /broker na waited na .*status 400 sent no tools 1 out-tokens na$/);
});


test('web-search-only calls reach the broker, while mixed tools and broker refusals never fall back', async () => {
  const body = request({tools: [{type: 'web_search_20250305', name: 'web_search', max_uses: 3}]});
  let asks = 0;
  const ask = async wire => { asks++; assert.deepEqual(wire.tools, body.tools); return answered('{"boards":[]}')(); };
  const answer = await answerViaBroker(body, {ask});
  assert.equal(answer.status, 200);
  assert.equal(JSON.parse(answer.body).content[0].text, '{"boards":[]}');
  assert.equal(asks, 1);
  assert.equal((await answerViaBroker({...body, tools: [...body.tools, {type: 'function', name: 'shell'}]}, {ask})).status, 400);
  assert.equal(asks, 1);
  const refused = await answerViaBroker(body, {ask: async () => ({ok: false, status: 'unreachable', detail: 'broker unavailable'})});
  assert.equal(refused.status, 503);
  assert.match(JSON.parse(refused.body).error.message, /broker unavailable/);
});

test('the --proof line says which AI answered, not "Codex" when Claude did (Gitar on #2947)', async () => {
  const {proofLine} = await import('../../../../tools/persona-search/codex.mjs');
  assert.equal(proofLine({model: 'claude-haiku-5-5', engine: 'claude', fellBack: [{engine: 'codex', why: 'ran-out'}]}), 'AI broker answered (AI: claude / claude-haiku-5-5 (codex ran-out)); no API key used');
  assert.equal(proofLine({model: 'gpt-6-luna', tier: 'small'}), 'AI broker answered (AI: gpt-6-luna); no API key used', 'an older broker without an engine still shows its model');
  assert.equal(proofLine({tier: 'small'}), 'AI broker answered (small); no API key used');
});
