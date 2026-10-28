// Form-time questions kept on the Standard answers page: no field id, only what the AI judges reusable (owner, 17 Oct 2026: Needs review held junk).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as questions from '../lib/questions.js';
import {classify, looksLikeFieldId, reusable} from '../lib/question-reuse.js';
import {createStorage} from '../lib/storage.js';

function storage() {
  const s = createStorage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-')), 'x'), {encrypt: v => v, decrypt: v => v});
  s.setSecret('NOTION_TOKEN', 'ntn');
  s.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}, telemetry: false});
  return s;
}
const NO = questions.NO_ANSWER;
const field = label => ({required: true, reason: NO, label});
const fake = verdicts => ({messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify({verdicts})}]})}});

test('a field id is not a question; real labels are', () => {
  for (const id of ['text-3219', 'tel-3519', 'question_12', '_r_4_', 'input[3]']) assert.ok(looksLikeFieldId(id), id);
  for (const label of ['Notice period', 'Visa sponsorship?', 'Colonist Profile', 'Q1 goals review', 'Postal Code *']) assert.ok(!looksLikeFieldId(label), label);
});

test('collect: no field id, and only what the AI judges reusable', async () => {
  const added = [];
  const fetchAdd = async (url, init = {}) => { if (init.method === 'PATCH') added.push(JSON.parse(init.body)); return {ok: true, json: async () => ({results: [], has_more: false})}; };
  const run = {trace: [field('text-3219'), field('tel-3519'), field('Colonist Profile'), field('What is your motivation to apply?'), field('Notice period')]};
  const asked = [];
  const judge = async labels => { asked.push(labels); return new Set(labels.filter(l => l === 'Notice period')); };
  assert.equal(await questions.collect(storage(), run, 'Colonist', fetchAdd, judge), 1);
  assert.deepEqual(asked[0], ['Colonist Profile', 'What is your motivation to apply?', 'Notice period'], 'ids never reach the AI');
  assert.match(JSON.stringify(added), /Notice period/);
  assert.doesNotMatch(JSON.stringify(added), /text-3219|tel-3519|Colonist Profile|motivation/);
});

test('classify: the fixed answer is validated; unknown labels, a covered_by that is not a saved answer and a missing engine keep nothing', async () => {
  const labels = ['Notice period', 'Why Colonist?', 'Earliest start?'];
  const answered = [{question: 'Notice period / earliest start', answer: '3 months'}];
  const got = await classify({labels, answered, client: fake([{label: 'Notice period', verdict: 'reusable', covered_by: ''}, {label: 'Why Colonist?', verdict: 'one_job', covered_by: ''},
    {label: 'Earliest start?', verdict: 'reusable', covered_by: 'Notice period / earliest start'}, {label: 'Invented', verdict: 'reusable', covered_by: ''}, {label: 'Notice period', verdict: 'maybe', covered_by: ''}])});
  assert.deepEqual([...got.keys()], ['Notice period', 'Why Colonist?', 'Earliest start?']);
  assert.equal(got.get('Earliest start?').proposal, '3 months');
  const bad = await classify({labels, answered, client: fake([{label: 'Earliest start?', verdict: 'reusable', covered_by: 'A question that is not saved'}])});
  assert.equal(bad.get('Earliest start?').covered_by, '', 'an invented covered_by is dropped');
  assert.equal((await classify({labels, client: fake([])})).size, 0, 'no verdict = nothing');
  assert.equal((await classify({labels})).size, 0, 'no AI engine = nothing');
  assert.deepEqual([...await reusable({labels, answered, client: fake([{label: 'Notice period', verdict: 'reusable', covered_by: ''}, {label: 'Earliest start?', verdict: 'reusable', covered_by: 'Notice period / earliest start'}])})], ['Notice period']);
});

// PR 2b step 1 (owner, 17 Oct 2026: "We should have this information in the Profile, as a standard/base"): a question a saved answer settles, in other
// words or by what it implies, shows with the deduced answer to accept; the AI sees the saved answers' values for that.
test('classify: a deduced answer comes from a saved answer; the answer itself when it means the same; none without a covered_by', async () => {
  const labels = ['Do you require visa sponsorship?', 'Earliest start?', 'Are you a robot?'];
  const answered = [{question: 'Work permit', answer: 'Swiss C permit'}, {question: 'Notice period / earliest start', answer: '3 months'}];
  const sent = [];
  const client = {messages: {create: async request => { sent.push(request.messages[0].content); return {content: [{type: 'text', text: JSON.stringify({verdicts: [
    {label: 'Do you require visa sponsorship?', verdict: 'reusable', covered_by: 'Work permit', value: 'No'},
    {label: 'Earliest start?', verdict: 'reusable', covered_by: 'Notice period / earliest start', value: ''},
    {label: 'Are you a robot?', verdict: 'reusable', covered_by: '', value: 'No'}]})}]}; }}};
  const got = await classify({labels, answered, client});
  assert.deepEqual(got.get('Do you require visa sponsorship?'), {reuse: 'reusable', covered_by: 'Work permit', proposal: 'No', from: 'Swiss C permit', topic: '', fact: ''});
  assert.equal(got.get('Earliest start?').proposal, '3 months', 'the same meaning: the saved answer');
  assert.deepEqual(got.get('Are you a robot?'), {reuse: 'reusable', covered_by: '', proposal: '', from: '', topic: '', fact: ''}, 'a value with no saved answer behind it is dropped');
  assert.match(sent[0], /Swiss C permit/, 'the AI reads the saved values to deduce from');
});

// "Seen twice" (owner, 17 Oct 2026): the same question on two forms, in any wording or language, is known by its topic.
test('classify: a topic per question, kept as a few lowercase words', async () => {
  const client = {messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify({verdicts: [
    {label: 'Kündigungsfrist?', verdict: 'reusable', covered_by: '', value: '', topic: 'Notice Period!'},
    {label: 'Why us?', verdict: 'one_job', covered_by: '', value: '', topic: ''}]})}]})}};
  const got = await classify({labels: ['Kündigungsfrist?', 'Why us?'], client});
  assert.equal(got.get('Kündigungsfrist?').topic, 'notice period');
  assert.equal(got.get('Why us?').topic, '');
});

// Code review of PR A (28 Oct 2026): one call for every label hit max_tokens past ~44 labels, and the cut JSON threw, so both drawers failed on every read.
// Labels go in chunks that fit the reply; a reply cut at max_tokens leaves only its own labels unjudged (asked again next read), never the whole read.
test('many labels are judged in chunks; a reply cut at max_tokens leaves its labels unjudged, the rest kept', async () => {
  const labels = Array.from({length: 70}, (_, i) => `Question number ${i + 1}?`);
  const sizes = [];
  let call = 0;
  const client = {messages: {create: async request => {
    const asked = JSON.parse(request.messages[0].content.split('<questions>\n')[1].split('\n</questions>')[0]);
    sizes.push(asked.length);
    call += 1;
    if (call === 2) return {stop_reason: 'max_tokens', content: [{type: 'text', text: '{"verdicts":[{"label":"Question'}]};
    return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({verdicts: asked.map(label => ({label, verdict: 'reusable', covered_by: '', value: '', topic: label, fact: ''}))})}]};
  }}};
  const found = await classify({labels, client});
  assert.ok(sizes.length > 1 && sizes.every(size => size <= 25), `chunks: ${sizes}`);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 70, 'every label asked once');
  assert.equal(found.size, 70 - sizes[1], 'only the cut chunk is left unjudged');
});
