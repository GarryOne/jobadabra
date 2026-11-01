// The person presses the page's own button (a sign-up's "Create account") while the fill is still in its last passes: the page goes away, and every later
// page call comes back null (Chrome's result for a frame that navigated). The fill must end quietly, never throw (13 Oct 2026, flow e2e applycv on #557:
// "Cannot read properties of null (reading 'length')" at the read-back after the page settled, and that error was written onto the NEXT page, the form).
import test from 'node:test';
import assert from 'node:assert/strict';

const FORM = [{field: 'email', label: 'Email', type: 'email', required: true}, {field: 'q1', label: 'Kubernetes years', type: 'text', required: true}];

test('a page that goes away after the fill typed: every later page call is null, and the fill ends without throwing', async () => {
  let gone = false;
  globalThis.navigator ??= {userAgent: 'node-test'};
  globalThis.chrome = {
    runtime: {getManifest: () => ({version: 'test'})},
    storage: {session: {get: async () => ({}), set: async () => {}}, local: {get: async () => ({})}},
    scripting: {executeScript: async ({func, args}) => {
      if (gone) return [{result: null}];   // the frame navigated: no page to run in
      if (!func) return [{}];
      const window = {__jobadabraDescribeForm: async () => FORM, __jobadabraCheckboxQuestions: () => [], __jobadabraPageText: () => '',
        __jobadabraProfileEntries: () => [{field: 'email'}], __jobadabraArmedCount: () => 0,
        __jobadabraExtensionFill: () => { gone = true; return {filled: 2, todo: [], trace: []}; }};
      globalThis.window = window;
      return [{result: await func(...(args || []))}];
    }},
  };
  globalThis.fetch = async url => new Response(JSON.stringify(new URL(url).pathname === '/extension/me' ? {contact: {email: 'a@example.test'}} : {answers: [], eligible: true, usd: 0}), {status: 200});
  const {fillTab} = await import(`../../extension/flow.js?${Math.random()}`);
  const result = await fillTab({id: 1, url: 'https://e2e.example.test/signup'}, {workerUrl: 'http://127.0.0.1:47111', token: 't', clickDropdowns: false},
    {kitAnswers: [{field: 'q1', answer: '5', question: 'Kubernetes years'}], useAI: false});
  assert.equal(result.filled, 2);
});
