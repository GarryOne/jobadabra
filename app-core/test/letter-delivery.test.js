// The real fillTab boundary delivers the selected base text, preserves kit precedence, and passes the shared status to the page writer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
const fixture = JSON.parse(fs.readFileSync(new URL('../../desktop/demo/job-pages.json', import.meta.url), 'utf8'));
const kitSection = Object.values(fixture).flatMap(page => Object.values(page.sections || {})).find(text => String(text).includes('### ✉️ Cover letter'));
const BASE = JSON.parse(kitSection.match(/```json\n([\s\S]*?)\n```/)[1]).cover_letter;
const URL_ = 'https://example.test/application';

async function run(kitLetter) {
  const given = [];
  globalThis.navigator ??= {userAgent: 'node-test'};
  globalThis.chrome = {runtime: {getManifest: () => ({version: 'test'})}, storage: {session: {get: async () => ({}), set: async () => {}}, local: {get: async () => ({})}},
    scripting: {executeScript: async ({func, args}) => {
      if (!func) return [{}];
      globalThis.window = {__jobPilottoDescribeForm: async () => [{field: 'cover_letter', type: 'textarea', label: 'Cover letter', required: false}], __jobPilottoCheckboxQuestions: () => [], __jobPilottoPageText: () => '', __jobPilottoProfileEntries: () => [],
        __jobPilottoExtensionFill: (...values) => { given.push(values); return {filled: 1, todo: []}; }, __jobPilottoArmedCount: () => 0};
      return [{result: await func(...(args || []))}];
    }}};
  globalThis.fetch = async () => new Response(JSON.stringify({answers: [], eligible: true, usd: 0}), {status: 200});
  const {fillTab} = await import(`../../extension/flow.js?delivery=${Math.random()}`);
  const status = {state: 'ready', ready: true, source: 'base'};
  await fillTab({id: 1, url: URL_}, {workerUrl: 'http://127.0.0.1:47111', token: 'fictional', clickDropdowns: false},
    {useAI: false, coverLetter: kitLetter, me: {contact: {}, coverLetterText: BASE, coverLetterStatus: status}});
  return {given, status};
}

test('a selected approved base letter reaches the textarea argument, without another AI call', async () => {
  const {given, status} = await run('');
  assert.equal(given[0]?.[3], BASE);
  assert.deepEqual(given[0]?.[2]?.coverLetterStatus, status);
});

test('an explicit kit letter still wins over the approved base fallback', async () => {
  const {given} = await run(BASE + '\n');
  assert.equal(given[0]?.[3], BASE + '\n');
});
