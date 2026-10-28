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

// Why (28 Oct 2026, owner, #2322: "conclude as much as possible, by ourselves"): a right-to-work or sponsorship question is answered from Nationality and the
// zones. The AI says what it asks and which country; the code reads the row. A Romanian national (fictional) with a UK permit and a US "No".
test('classify: right to work and sponsorship come from Nationality and the zones, by the country the AI names', async () => {
  const facts = [{label: 'Nationality', value: 'Romania'}, {label: 'United Kingdom', value: 'yes, with a permit', kind: 'per_country'},
    {label: 'United States', value: 'no, needs sponsorship', kind: 'per_country'}];
  // The fact the AI names for each, as a real model does (Gitar, #2322): the generic path must never answer an unsettled row from it.
  const ask = (label, asks, country) => ({label, verdict: 'reusable', covered_by: '', value: '', topic: '', fact: country === 'JP' ? 'United Kingdom' : '', asks, country});
  const labels = ['Authorised to work in Germany?', 'Brauchen Sie ein Visum für Berlin?', 'Eligible in the US?', 'Sponsorship for the US?', 'Right to work in the UK?',
    'Eligible in the location you apply for?', 'Authorised in Mars?', 'Authorised to work in Japan?'];
  const got = await classify({labels, facts, client: fake([ask(labels[0], 'work_right', 'DE'), ask(labels[1], 'sponsorship', 'de'), ask(labels[2], 'work_right', 'US'),
    ask(labels[3], 'sponsorship', 'US'), ask(labels[4], 'work_right', 'GB'), ask(labels[5], 'work_right', ''), ask(labels[6], 'work_right', 'Mars'),
    ask(labels[7], 'work_right', 'JP')])});
  const of = label => [got.get(label).reuse, got.get(label).fact, got.get(label).proposal];
  assert.deepEqual(of(labels[0]), ['details', 'EU / EEA + Switzerland', 'Yes'], 'Germany is in the zone a Romanian citizenship opens');
  assert.deepEqual(of(labels[1]), ['details', 'EU / EEA + Switzerland', 'No'], 'sponsorship is derived, in any language');
  assert.deepEqual(of(labels[2]), ['details', 'United States', 'No']);
  assert.deepEqual(of(labels[3]), ['details', 'United States', 'Yes']);
  assert.deepEqual(of(labels[4]), ['details', 'United Kingdom', 'Yes'], 'a permit settles the right to work');
  assert.deepEqual([got.get(labels[7]).reuse, got.get(labels[7]).fact, got.get(labels[7]).proposal, got.get(labels[7]).row], ['reusable', '', '', 'Nationality'],
    'a country in no zone settles nothing: still asked, never filled from the fact the AI named');
  assert.deepEqual(of(labels[5]), ['details', 'Nationality', ''], 'no country named: answered per job from the same rows');
  assert.equal(got.get(labels[6]).reuse, 'reusable', 'a code that is not ISO is never read');
});

// Why (28 Oct 2026, #2322 review): a cached answer read from a zone is judged again when that row changes, never kept stale.
test('ensure: an answer from a zone is judged again when the row changes', async () => {
  const {ensure} = await import('../lib/question-verdicts.js');
  const s = storage(), calls = [];
  const client = {messages: {create: async () => { calls.push(1); return {content: [{type: 'text', text: JSON.stringify({verdicts: [{label: 'Authorised in Germany?', verdict: 'reusable', covered_by: '', value: '', topic: '', fact: '', asks: 'work_right', country: 'DE'}]})}]}; }}};
  const facts = value => [{label: 'Nationality', value: 'Canada'}, {label: 'EU / EEA + Switzerland', value, kind: 'per_country'}];
  const first = await ensure(s, ['Authorised in Germany?'], {facts: facts('yes, with a permit'), ai: {client}});
  assert.equal(Object.values(first.verdicts)[0].proposal, 'Yes');
  await ensure(s, ['Authorised in Germany?'], {facts: facts('yes, with a permit'), ai: {client}});
  assert.equal(calls.length, 1, 'the same row: kept');
  await ensure(s, ['Authorised in Germany?'], {facts: facts('no, needs sponsorship'), ai: {client}});
  assert.equal(calls.length, 2, 'the row changed: judged again');
});

// Why (28 Oct 2026, #2322): a question kept asked because its zone was "❓" is judged again once that zone is answered (no label changes, so the facts'
// signature alone never saw it), and an answer read from the zone then stays cached.
test('ensure: a question asked for a "❓" zone is judged again when the zone is answered, then kept', async () => {
  const {ensure} = await import('../lib/question-verdicts.js');
  const s = storage(), calls = [];
  const client = {messages: {create: async () => { calls.push(1); return {content: [{type: 'text', text: JSON.stringify({verdicts: [{label: 'Authorised in Germany?', verdict: 'reusable', covered_by: '', value: '', topic: '', fact: '', asks: 'work_right', country: 'DE'}]})}]}; }}};
  const facts = value => [{label: 'Nationality', value: 'Japan'}, {label: 'EU / EEA + Switzerland', value, kind: 'per_country'}];
  const first = await ensure(s, ['Authorised in Germany?'], {facts: facts('❓'), ai: {client}});
  assert.equal(Object.values(first.verdicts)[0].reuse, 'reusable', 'asked while the zone is "❓"');
  await ensure(s, ['Authorised in Germany?'], {facts: facts('❓'), ai: {client}});
  assert.equal(calls.length, 1, 'still "❓": kept');
  const next = await ensure(s, ['Authorised in Germany?'], {facts: facts('yes, with a permit'), ai: {client}});
  assert.deepEqual([calls.length, Object.values(next.verdicts)[0].proposal, Object.values(next.verdicts)[0].row], [2, 'Yes', ''], 'answered: judged again, no row left behind');
  await ensure(s, ['Authorised in Germany?'], {facts: facts('yes, with a permit'), ai: {client}});
  assert.equal(calls.length, 2, 'the same row: kept');
});

// Why (28 Oct 2026, Gitar on #2322): a country in no zone is answered only by a citizenship of it, so a question about it is tied to the Nationality line.
test('ensure: a question about a country in no zone is judged again when Nationality changes', async () => {
  const {ensure} = await import('../lib/question-verdicts.js');
  const s = storage(), calls = [];
  const client = {messages: {create: async () => { calls.push(1); return {content: [{type: 'text', text: JSON.stringify({verdicts: [{label: 'Authorised in Japan?', verdict: 'reusable', covered_by: '', value: '', topic: '', fact: '', asks: 'work_right', country: 'JP'}]})}]}; }}};
  const facts = value => [{label: 'Nationality', value}, {label: 'United States', value: 'no, needs sponsorship', kind: 'per_country'}];
  assert.equal(Object.values((await ensure(s, ['Authorised in Japan?'], {facts: facts('Canada'), ai: {client}})).verdicts)[0].reuse, 'reusable');
  await ensure(s, ['Authorised in Japan?'], {facts: facts('Canada'), ai: {client}});
  assert.equal(calls.length, 1, 'the same Nationality: kept');
  const next = await ensure(s, ['Authorised in Japan?'], {facts: facts('Canada, Japan'), ai: {client}});
  assert.deepEqual([calls.length, Object.values(next.verdicts)[0].proposal], [2, 'Yes'], 'a Japanese citizenship added: judged again, answered');
});
