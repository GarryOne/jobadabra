// A streamed Claude ask (the app's messages.stream, which the strategy draft uses) answered by the proxy's canned answer comes back as chunks the SDK reads (2 Nov 2026, owner: "I think we agreed to move the
// variable things outside of e2e"). Before: the canned answer was plain JSON, and the SDK ended with "request ended without sending chunks"; a recorded stream replayed from the cache was the only streamed answer that worked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {startAiProxy} from '../../lib/ai-proxy.mjs';

const {default: Anthropic} = await import(createRequire(new URL('../../../package.json', import.meta.url)).resolve('@anthropic-ai/sdk'));

const ask = {model: 'claude-haiku-5-5', max_tokens: 100, messages: [{role: 'user', content: 'hello'}]};

test('a canned answer to a streamed Claude ask is read by the SDK as a stream, and a plain ask still gets JSON', async () => {
  const proxy = await startAiProxy();
  try {
    proxy.setCanned(() => '{"roles":["Nurse"]}');
    const client = new Anthropic({apiKey: 'test-key', baseURL: proxy.url, maxRetries: 0});
    const streamed = await client.messages.stream(ask).finalMessage();
    assert.equal(streamed.content[0].text, '{"roles":["Nurse"]}');
    assert.equal(streamed.stop_reason, 'end_turn');
    const plain = await client.messages.create(ask);
    assert.equal(plain.content[0].text, '{"roles":["Nurse"]}');
  } finally { await proxy.close(); }
});
