// A live capture keeps the form answers on the API key too (lib/ai/index.js keptAnswerClient, used by lib/server-env.js aiClient): only under the e2e model memo, never for a person.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {keptAnswerClient} from '../lib/ai/index.js';

const storage = key => ({secret: name => (name === 'ANTHROPIC_API_KEY' ? key : '')});
const memo = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-')), 'model-memo.json');

test('under the e2e memo, the API key\'s form answers go through the memo (a capture keeps them)', async () => {
  const file = memo();
  fs.writeFileSync(file, '{}');
  const client = keptAnswerClient(storage('sk-test'), {JOBADABRA_E2E: '1', JOBADABRA_MODEL_MEMO: file});
  assert.equal(typeof client?.messages?.create, 'function');
  // the memo's own create, not the SDK's: a kept answer is served without the network (the key is fake)
  const params = {model: 'm', max_tokens: 10, messages: [{role: 'user', content: 'q'}]};
  const {memoKey} = await import('../lib/ai/model-memo.js');
  fs.writeFileSync(file, JSON.stringify({[memoKey(params)]: {content: [{type: 'text', text: 'kept'}]}}));
  assert.equal((await client.messages.create(params)).content[0].text, 'kept');
});

test('a person\'s app (no e2e memo), no key, or the memo without the harness: no client, the worker asks with its key as before', () => {
  assert.equal(keptAnswerClient(storage('sk-test'), {}), null);
  assert.equal(keptAnswerClient(storage(''), {JOBADABRA_E2E: '1', JOBADABRA_MODEL_MEMO: memo()}), null);
  assert.equal(keptAnswerClient(storage('sk-test'), {JOBADABRA_MODEL_MEMO: memo()}), null);
});
