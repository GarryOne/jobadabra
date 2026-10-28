// An answer kept for one job only (before 28 Oct 2026, when "Reuse for matching questions" was off) stays with that job's application, through the store
// interface (the engine's applications section, every adapter: tests/store_contract.py), and is found again for that job only. Its writer is gone (PR B1,
// owner 28 Oct 2026: "there cannot be things that we learned and should be applied only to one job"); answers kept before still fill. Fake store call.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JOB_ANSWERS_SECTION, withJobAnswer} from '../shared/worker/job-answers.js';
import {extensionStore} from '../lib/store/extension-store.js';
import * as jobAnswers from '../lib/job-answers.js';

const ACME = {id: 'a1', url: 'https://jobs.example.test/acme/1', title: 'SRE', company: 'Acme AG'};
const BETA = {id: 'a2', url: 'https://jobs.example.test/beta/2', title: 'SRE', company: 'Beta GmbH'};
const A = '1 December 2026; no constraints';
const Q = 'What is your earliest start date, and are there any constraints we should be aware of?';
function fakeStore(rows = [ACME, BETA]) {
  const sections = new Map(), calls = [];
  const call = async (_, entity, method, kwargs) => {
    calls.push(`${entity}.${method}`);
    if (entity !== 'applications') throw new Error(`unexpected ${entity}.${method}`);
    if (method === 'list') return rows;
    if (method === 'get') return rows.find(row => row.url === kwargs.url) || null;
    if (method === 'section') return sections.get(`${kwargs.app_id}|${kwargs.name}`) ?? null;
    if (method === 'set_section') { sections.set(`${kwargs.app_id}|${kwargs.name}`, kwargs.markdown); return null; }
    throw new Error(`unexpected ${entity}.${method}`);
  };
  return {call, sections, calls};
}
test('an answer kept for one job is read back for that job only, by the app and by the fill', async () => {
  const fake = fakeStore();
  fake.sections.set(`a2|${JOB_ANSWERS_SECTION}`, withJobAnswer(null, Q, A));
  assert.deepEqual(await jobAnswers.forUrl({}, BETA.url, {call: fake.call}), [{question: Q, answer: A}]);
  assert.deepEqual(await jobAnswers.forUrl({}, ACME.url, {call: fake.call}), []);
  assert.deepEqual(await extensionStore({}, {call: fake.call}).jobAnswers('a2'), [{question: Q, answer: A}], 'the fill\'s reader sees the same');
});

test('nothing writes a one-job answer any more', () => {
  assert.equal(jobAnswers.save, undefined);
});
