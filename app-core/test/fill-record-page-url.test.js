// A fill record identifies its actual form page, independently of the kit URL or a later navigation in the same tab.
import test from 'node:test';
import assert from 'node:assert/strict';

const FORM_URL = 'https://careers.example.test/careers?job=restored#jobpilotto-fill';
const JOB_URL = 'http://careers.example.test/careers?job=original';
const NEXT_URL = 'https://careers.example.test/confirmation';

test('the run records the filled page snapshot, not the kit address or the tab after it moves', async () => {
  const runs = [];
  globalThis.navigator ??= {userAgent: 'node-test'};
  globalThis.chrome = {
    runtime: {getManifest: () => ({version: 'test'})},
    tabs: {get: async () => ({url: NEXT_URL})},
    storage: {session: {get: async () => ({}), set: async () => {}}, local: {get: async () => ({})}},
    scripting: {executeScript: async ({func, args}) => {
      if (!func) return [{}];
      globalThis.window = {__jobPilottoDescribeForm: () => [], __jobPilottoCheckboxQuestions: () => [], __jobPilottoPageText: () => '',
        __jobPilottoProfileEntries: () => [], __jobPilottoExtensionFill: () => ({filled: 1, todo: [], trace: []}), __jobPilottoArmedCount: () => 0};
      return [{result: await func(...(args || []))}];
    }},
  };
  globalThis.fetch = async (url, init) => {
    const at = new URL(url);
    assert.equal(at.origin, 'http://127.0.0.1:47111', 'all app requests are intercepted; no real app or service');
    if (at.pathname === '/extension/run') runs.push(JSON.parse(init.body));
    return new Response(JSON.stringify(at.pathname === '/extension/me' ? {contact: {}} : {}), {status: 200});
  };
  const {fillTab} = await import('../../extension/flow.js');
  await fillTab({id: 71, url: FORM_URL}, {workerUrl: 'http://127.0.0.1:47111', token: 'fake', clickDropdowns: false}, {useAI: false, jobUrl: JOB_URL});
  assert.equal(runs.length, 1);
  assert.equal(runs[0].url, JOB_URL, 'the kit retains its posting identity');
  assert.equal(runs[0].pageUrl, FORM_URL, 'the record keeps the actual fill page including its job query');
});
