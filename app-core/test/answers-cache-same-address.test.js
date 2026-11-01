// A reply kept for a tab is reused only for a form it was asked about (flow.js cachedAI). A single-page app keeps one address from its sign-in page to the form behind it,
// and the sign-in page's reply (a password question) stood for the form's own: its questions were never asked (16 Oct 2026, Workday "My Information": a picklist and a yes/no left empty).
import test from 'node:test';
import assert from 'node:assert/strict';

const URL_ = 'https://jobs.example.com/en-US/acme/job/apply/applyManually';
const SIGN_IN = [{field: 'input-15', label: 'Password', type: 'password', required: true}];
const FORM = [{field: 'hear', label: 'How Did You Hear About Us?', type: 'text', required: true}, {field: 'radio:employed', label: 'Have you ever been employed here?', type: 'radio', required: true, options: ['Yes', 'No']}];

async function run(kept, form) {
  const asks = [];
  globalThis.navigator ??= {userAgent: 'node-test'};
  globalThis.chrome = {
    runtime: {getManifest: () => ({version: 'test'})},
    storage: {session: {get: async () => (kept ? {'fill:1': kept} : {}), set: async () => {}}, local: {get: async () => ({})}},
    scripting: {executeScript: async ({func, args}) => {
      if (!func) return [{}];
      globalThis.window = {__jobPilottoDescribeForm: async () => form, __jobPilottoCheckboxQuestions: () => [], __jobPilottoPageText: () => '', __jobPilottoProfileEntries: () => [],
        __jobPilottoExtensionFill: () => ({filled: 0, todo: []}), __jobPilottoArmedCount: () => 0};
      return [{result: await func(...(args || []))}];
    }},
  };
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/extension/answer') asks.push(JSON.parse(init.body).fields.map(f => f.field));
    return new Response(JSON.stringify(path === '/extension/me' ? {contact: {}} : {answers: [], eligible: true, usd: 0}), {status: 200});
  };
  const {fillTab} = await import(`../../extension/flow.js?${Math.random()}`);
  await fillTab({id: 1, url: URL_}, {workerUrl: 'http://127.0.0.1:47111', token: 't', clickDropdowns: false}, {useAI: true});
  return asks;
}

test('the sign-in page\'s kept reply is not taken for the form behind the same address', async () => {
  const asks = await run({url: URL_, ai: {eligible: true, answers: [{field: 'input-15'}]}, asked: ['input-15']}, FORM);
  assert.deepEqual(asks, [['hear', 'radio:employed']]);
});

test('variant: a kept reply from before `asked` was stored is judged by its answers', async () => {
  const asks = await run({url: URL_, ai: {eligible: true, answers: [{field: 'input-15'}]}}, FORM);
  assert.deepEqual(asks, [['hear', 'radio:employed']]);
});

test('control: a form the kept reply was asked about is not asked again', async () => {
  const asks = await run({url: URL_, ai: {eligible: true, answers: []}, asked: ['input-15']}, SIGN_IN);
  assert.deepEqual(asks, []);
});
