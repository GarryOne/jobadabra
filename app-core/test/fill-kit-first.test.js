// A form the kit was drafted from needs no Claude call: the kit covers its questions (even the optional ones it
// left empty on purpose) and the contact details and CV come from the app. Claude gets only what nothing answers.
import test from 'node:test';
import assert from 'node:assert/strict';

// The live form, as window.__jobPilottoDescribeForm reads it (the Anthropic form's shape).
const FORM = [
  {field: 'first_name', label: 'First Name', type: 'text', required: true}, {field: 'last_name', label: 'Last Name', type: 'text', required: true},
  {field: 'email', label: 'Email', type: 'email', required: true}, {field: 'phone', label: 'Phone', type: 'tel'},
  {field: 'resume', label: 'Resume/CV', type: 'file', required: true},
  {field: 'question_15024092008', label: 'Are you open to relocation for this role?', type: 'combobox', required: true},
  {field: 'question_15024095008', label: '(Optional) Personal Preferences', type: 'text'},
  {field: 'question_15024101008', label: 'Additional Information', type: 'textarea'},
  {field: 'question_99', label: 'A question the kit never saw', type: 'text', required: true},
];
const KIT = [{field: 'question_15024092008', answer: 'Yes'}, {field: 'question_15024095008', answer: ''}, {field: 'question_15024101008', answer: ''}];

async function run() {
  const calls = [];
  globalThis.navigator ??= {userAgent: 'node-test'};  // Node 20 (CI) has no navigator; flow.js logs the user agent
  globalThis.chrome = {
    runtime: {getManifest: () => ({version: 'test'})},
    storage: {session: {get: async () => ({}), set: async () => {}}, local: {get: async () => ({})}},
    scripting: {executeScript: async ({func, args}) => {
      if (!func) return [{}];
      const window = {__jobPilottoDescribeForm: async () => FORM, __jobPilottoCheckboxQuestions: () => [], __jobPilottoPageText: () => '',
        __jobPilottoProfileEntries: rows => rows.filter(r => ['first_name', 'last_name', 'email', 'phone'].includes(r.field)).map(r => ({field: r.field})),
        __jobPilottoExtensionFill: list => { calls.push({path: 'page fill', fields: list.map(a => a.field)}); return {filled: 5, todo: []}; }, __jobPilottoArmedCount: () => 0};
      globalThis.window = window;
      return [{result: await func(...(args || []))}];
    }},
  };
  globalThis.fetch = async (url, init) => {
    calls.push({path: new URL(url).pathname, body: init?.body ? JSON.parse(init.body) : null});
    const body = new URL(url).pathname === '/extension/me' ? {contact: {first_name: 'Ada'}} : {answers: [], eligible: true, usd: 0.03};
    return new Response(JSON.stringify(body), {status: 200});
  };
  const {fillTab} = await import(`../../extension/flow.js?${Math.random()}`);
  await fillTab({id: 1, url: 'https://job-boards.greenhouse.io/anthropic/jobs/5114768008'}, {workerUrl: 'http://127.0.0.1:47111', token: 't', clickDropdowns: false},
    {kitAnswers: KIT.map(({field, answer}) => ({field, answer, question: field})), useAI: true});
  return calls;
}

test('with a kit, only the question nothing answers goes to Claude: not the contact details, the CV or the kit\'s empty optionals', async () => {
  const calls = await run();
  const asked = calls.filter(call => call.path === '/extension/answer');
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].body.fields.map(f => f.field), ['question_99']);
  // The contact details were fetched before deciding what to ask.
  assert.ok(calls.findIndex(call => call.path === '/extension/me') < calls.findIndex(call => call.path === '/extension/answer'));
  // Instant: the page is filled from the kit before Claude is even asked; Claude's answers go in afterwards.
  const order = calls.map(call => call.path).filter(path => ['page fill', '/extension/answer'].includes(path));
  assert.deepEqual(order, ['page fill', '/extension/answer']);
});
