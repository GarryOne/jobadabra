// "Seen twice, auto" (owner, 17 Oct 2026): a new reusable question from the 1st employer stays with that job (its drawer), not in Answer once; the
// 2nd employer asking the same thing (any wording, by its topic) makes it a standard answer, with what was typed on a form for it (kept on the answers page, lib/learned.js);
// the same employer twice is not a second; Undo = only this job: the line goes and it is never kept again.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as questions from '../lib/questions.js';
import * as verdicts from '../lib/question-verdicts.js';
import {save} from '../lib/learned.js';
import {onlyThisJob} from '../lib/question-lists.js';

const fresh = () => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-twice-')), {encrypt: v => v, decrypt: v => v}); s.saveSettings({store: 'sqlite', telemetry: false}); return s; };
const NO = questions.NO_ANSWER;
const run = (url, ...labels) => ({url, trace: labels.map(label => ({required: true, reason: NO, label}))});
// The AI's fixed answer: every question reusable, its topic by meaning (a fake: notice period in German or English is one topic).
const ai = {client: {messages: {create: async request => {
  const labels = JSON.parse(request.messages[0].content.split('<questions>\n')[1].split('\n</questions>')[0]);
  return {content: [{type: 'text', text: JSON.stringify({verdicts: labels.map(label => ({label, verdict: 'reusable', covered_by: '', value: '',
    topic: /notice|kündigung/i.test(label) ? 'notice period' : label.toLowerCase()}))})}]};
}}}};
async function fill(storage, {url, company}, ...labels) {
  const remembered = [];
  const added = await questions.collect(storage, run(url, ...labels), company, undefined,
    asked => verdicts.judge(storage, asked, {company, url, ai}), asked => verdicts.record(storage, asked, {url, company}), list => remembered.push(...list));
  return {added, remembered, page: await store.openStore(storage).page('answers').text()};
}
const A = {url: 'https://jobs.example/acme-sre', company: 'Acme'}, A2 = {url: 'https://jobs.example/acme-platform', company: 'Acme'}, B = {url: 'https://jobs.example/beta', company: 'Beta'};

test('1st employer: kept with its job only; same employer again: still only; 2nd employer, other wording: a standard answer', async () => {
  const s = fresh();
  let got = await fill(s, A, 'Notice period?');
  assert.equal(got.added, 0, 'the 1st sighting is not listed in Answer once');
  assert.deepEqual(verdicts.forJob(s, A.url), [{question: 'Notice period?', state: 'once'}]);
  got = await fill(s, A2, 'Notice period?');
  assert.equal(got.added, 0, 'another job of the same employer is not a second employer');
  got = await fill(s, B, 'Kündigungsfrist');
  assert.equal(got.added, 1);
  assert.match(got.page, /Kündigungsfrist: ❓ \(asked by Beta\)/);
  assert.deepEqual(got.remembered, [], 'nothing typed before: an open question');
  assert.deepEqual(verdicts.forJob(s, B.url), [{question: 'Kündigungsfrist', state: 'remembered'}]);
  assert.deepEqual(verdicts.forJob(s, A.url), [{question: 'Notice period?', state: 'once'}], 'the 1st job keeps its note only');
});

test('2nd employer: the answer typed for the earlier wording comes with it ("Remembered for future forms")', async () => {
  const s = fresh();
  await fill(s, A, 'Notice period?');
  await save(s, {items: [{label: 'Notice period?', value: '3 months'}]});   // typed at the 1st employer's Submit (lib/learned.js)
  const got = await fill(s, B, 'Kündigungsfrist');
  assert.match(got.page, /^Kündigungsfrist: 3 months$/m);
  assert.deepEqual(got.remembered, ['Kündigungsfrist']);
});

test('Undo = only this job: the line goes, and a 3rd employer does not bring it back', async () => {
  const s = fresh();
  await fill(s, A, 'Notice period?');
  await fill(s, B, 'Notice period?');
  assert.deepEqual(await onlyThisJob(s, 'Notice period?'), {ok: true, removed: 1});
  assert.doesNotMatch(await store.openStore(s).page('answers').text(), /Notice period/);
  const got = await fill(s, {url: 'https://jobs.example/gamma', company: 'Gamma'}, 'Notice period?');
  assert.equal(got.added, 0);
});
