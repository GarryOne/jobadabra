// Exercise the nightly CLI import graph and every drawable request in a process that refuses all package imports.
import assert from 'node:assert/strict';
import {isBuiltin, registerHooks} from 'node:module';

const packageAttempts = [];
registerHooks({resolve(specifier, context, nextResolve) {
  if (!isBuiltin(specifier) && !/^(?:\.|\/|file:|data:)/.test(specifier)) {
    packageAttempts.push(specifier);
    throw new Error(`package forbidden: ${specifier}`);
  }
  return nextResolve(specifier, context);
}});
// Negative control: this must fail at our boundary even when the shared node_modules contains pdfjs-dist.
await assert.rejects(import('pdfjs-dist/legacy/build/pdf.mjs'), /package forbidden:/);
packageAttempts.length = 0;
globalThis.fetch = () => { throw new Error('network forbidden'); };

await import('../../answer-drift.mjs');
const {loadRequests, resolveRequest} = await import('../../lib/answer-drift.mjs');
const {answerViaBroker} = await import('../../lib/broker-relay.mjs');
const {modelFetch} = await import('../../lib/model.mjs');
const entries = loadRequests();
const hasDocument = value => value && typeof value === 'object' && (['document', 'input_file'].includes(value.type)
  || value.media_type === 'application/pdf' || Object.values(value).some(hasDocument));
const bodies = entries.map(entry => resolveRequest(entry).request.body);
const documentRequests = bodies.filter(hasDocument).length;
assert.equal(documentRequests, 0, 'Document/PDF requests need explicit exclusion from the nightly draw or a dependency install');

let calls = 0;
const ask = async () => {
  calls++;
  return {ok: true, model: 'fake-codex', message: {content: [{type: 'text', text: '{}'}], stop_reason: 'end_turn', usage: {input_tokens: 0, output_tokens: 0}}};
};
for (const body of bodies) {
  // Use the real PDF extractor default: a drawable document must reach the package guard, never a fake extractor.
  const response = await answerViaBroker(body, {env: {}, ask});
  assert.equal(response.status, 200);
}
assert.equal(calls, entries.length);
const env = {CI: 'true', GITHUB_ACTIONS: 'true', E2E_AI_PROVIDER: 'codex', ACTIONS_ID_TOKEN_REQUEST_URL: 'fake', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fake'};
const judged = await modelFetch('https://api.anthropic.com/v1/messages', {body: JSON.stringify({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'Fake judge input'}]})}, {env, freshBroker: true, ask});
assert.equal(judged.status, 200);
assert.equal(calls, entries.length + 1);
assert.deepEqual(packageAttempts, []);
console.log(JSON.stringify({requests: entries.length, documentRequests, packageAttempts: packageAttempts.length}));
