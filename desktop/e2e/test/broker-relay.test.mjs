// Guards the app-under-test relay (lib/broker-relay.mjs): a PDF goes in as text, a streamed call is answered as events, tools and a broker "no" are said out loud.
import test from 'node:test';
import assert from 'node:assert/strict';
import {answerViaBroker, streamOf, withPdfAsText} from '../lib/broker-relay.mjs';
import {startAiProxy} from '../lib/ai-proxy.mjs';

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

test('tools are refused with a 400 and the broker saying no is a 503 with its reason, never another provider', async () => {
  const tools = await answerViaBroker(request({tools: [{name: 'x'}]}), {ask: answered()});
  assert.equal(tools.status, 400);
  const no = await answerViaBroker(request(), {env: {}, ask: async () => ({ok: false, status: 'capped', detail: 'broker: budget:week 85%'})});
  assert.equal(no.status, 503);
  assert.match(JSON.parse(no.body.toString('utf8')).error.message, /Codex broker said no \(broker: budget:week 85%/);
  const lost = await answerViaBroker(request(), {ask: async () => ({ok: false, status: 'no-token', detail: 'no GitHub OIDC token here'})});
  assert.match(JSON.parse(lost.body.toString('utf8')).error.message, /no GitHub OIDC token/);
});

test('the proxy sends a metered call through the relay and answers with the relay body', async () => {
  let asks = 0;
  const proxy = await startAiProxy({kind: 'app-codex', relay: async body => { asks++; return answerViaBroker(body, {ask: answered('{"a":1}')}); }});
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
  const {pdfText} = await import('../lib/broker-relay.mjs');
  assert.match(await pdfText(Buffer.from(await doc.save()).toString('base64')), /Jane Doe nurse/);
});

test('a relay that throws (a bad body, a bad PDF) is a 502 answer and the proxy keeps serving', async () => {
  const proxy = await startAiProxy({kind: 'app-codex', relay: async () => { throw new Error('bad pdf'); }});
  try {
    const first = await fetch(`${proxy.url}/v1/messages`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
    assert.equal(first.status, 502);
    assert.match((await first.json()).error.message, /relay: bad pdf/);
    assert.equal((await fetch(`${proxy.url}/v1/messages`, {method: 'POST', body: '{}'})).status, 502);
  } finally { await proxy.close(); }
});

test('with the app on codex in CI no other family bills it and its key is the placeholder', async () => {
  const {pickFamily, testKey, DUMMY_KEY} = await import('../lib/engine.mjs');
  const env = {CI: 'true', GITHUB_RUN_NUMBER: '1', E2E_OPENAI_KEY: 'k', E2E_FREE_AI_URL: 'http://x', E2E_FREE_AI_KEY: 'k', CI_AI_PROVIDER: 'codex'};
  assert.equal(pickFamily(env), 'claude');
  assert.equal(testKey(env), DUMMY_KEY);
  assert.equal(pickFamily({...env, CI_AI_PROVIDER: 'free'}), 'free');
});
