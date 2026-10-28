// The learnings writer (lib/learnings.js; owner, 28 Oct 2026: "He should interpret meanings. He should understand if a learning already exists partially and we
// should just confirm or extend that learning, or it's a completely new and separate topic"): one AI call per fill judges each answer against the kept
// learnings; the code writes exactly what the verdict says and checks only the reply's shape and that a picked topic is on the list. The AI is a fake with a
// fixed reply (no spend); the prompt's own cases are test/fixtures/learnings-cases.json, replayed on Haiku when the prompt changes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as learnings from '../lib/learnings.js';
import * as review from '../lib/details-review.js';
import {save} from '../lib/learned.js';
import {cached} from '../lib/question-verdicts.js';

const fresh = () => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-learn-')), {encrypt: v => v, decrypt: v => v}); s.saveSettings({store: 'sqlite', telemetry: false}); return s; };
const page = s => store.openStore(s).page('answers');
const lines = async s => (await page(s).outline()).map(block => (block.type.startsWith('heading') ? `## ${block.text}` : block.text));
// A fake AI that gives these verdicts ({label: {verdict, topic, question, answer, key}}) and keeps what it was sent.
function fakeAi(byLabel) {
  const sent = [];
  const client = {messages: {create: async request => {
    sent.push(request);
    const asked = JSON.parse(request.messages[0].content.split('<answers>\n')[1].split('\n</answers>')[0]);
    const verdicts = asked.filter(each => byLabel[each.label]).map(each => ({label: each.label, topic: '', question: '', answer: '', key: '', ...byLabel[each.label]}));
    return {content: [{type: 'text', text: JSON.stringify({verdicts})}], usage: {input_tokens: 10, output_tokens: 5}};
  }}};
  return {client, sent};
}
const learn = (s, answers, ai, extra = {}) => learnings.learn(s, {answers, client: ai.client, ...extra});

test('the merge follows the AI\'s verdict even when the wordings match: no string compare decides it', async () => {
  const s = fresh();
  await page(s).write('## Common questions\n- Willing to travel: Yes\n- Contract type: Permanent\n');
  const ai = fakeAi({'Willing to travel': {verdict: 'conflicts', topic: 'Willing to travel'}, 'Contract type': {verdict: 'same', topic: 'Contract type'}});
  const result = await learn(s, [{label: 'Willing to travel', value: 'Yes', state: 'new'}, {label: 'Contract type', value: 'Freelance', state: 'new'}], ai);
  assert.deepEqual(await lines(s), ['## Common questions', 'Willing to travel: Yes (two answers: Yes)', 'Contract type: Permanent'], 'same words, the AI said conflicts; other words, it said same');
  assert.deepEqual(result.counts, {same: 1, extended: 0, conflicts: 1, added: 0});
  assert.deepEqual(result.evidence, [{label: 'Willing to travel', topic: 'Willing to travel'}, {label: 'Contract type', topic: 'Contract type'}]);
});

test('extends writes the AI\'s widened answer as new; new topics go under their own heading, one line per question the AI named', async () => {
  const s = fresh();
  await page(s).write('## Common questions\n- Willing to travel: Yes, up to 20% [yes/no]\n');
  const ai = fakeAi({'Travel up to 30%?': {verdict: 'extends', topic: 'Willing to travel', answer: 'Yes, up to 30% within Europe'},
    'Background check': {verdict: 'new', question: 'Do you agree to a background check?', answer: 'Yes'},
    'Consent to background screening': {verdict: 'new', question: 'Do you agree to a background check?', answer: 'Yes, I agree'}});
  await learn(s, [{label: 'Travel up to 30%?', value: 'Yes', state: 'new'}, {label: 'Background check', value: 'Yes', state: 'guess'},
    {label: 'Consent to background screening', value: 'Yes', state: 'new'}], ai);
  assert.deepEqual(await lines(s), ['## Common questions', 'Willing to travel: Yes, up to 30% within Europe (new) [yes/no]', `## ${learnings.HEADING}`, 'Do you agree to a background check: Yes (guess)'],
    'the kind mark is kept; the second wording of the new topic is evidence only');
  await learn(s, [{label: 'Notice', value: '3 months', state: 'new'}], fakeAi({Notice: {verdict: 'new', question: 'Notice period?', answer: '3 months'}}));
  assert.deepEqual((await lines(s)).slice(-2), ['Do you agree to a background check: Yes (guess)', 'Notice period: 3 months (new)'], 'a later new topic joins the same heading');
});

test('owned, private and one-job answers teach nothing; a topic not on the list is not judged; Strategy\'s fields go in as owned', async () => {
  const s = fresh();
  await page(s).write('## Common questions\n- Notice period: 3 months\n');
  const ai = fakeAi({'Employment type': {verdict: 'owned'}, 'Gender': {verdict: 'private'}, 'Why Acme?': {verdict: 'one_job'},
    'Relocate?': {verdict: 'same', topic: 'Willing to relocate'}, 'Start date': {verdict: 'extends', topic: 'Notice period', answer: ''}});
  const result = await learn(s, ['Employment type', 'Gender', 'Why Acme?', 'Relocate?', 'Start date'].map(label => ({label, value: 'x', state: 'new'})), ai, {owned: ['Street']});
  assert.deepEqual(await lines(s), ['## Common questions', 'Notice period: 3 months'], 'an employment-type answer from a fill adds no learning (owner: Strategy owns it)');
  assert.deepEqual(result.judged, ['Employment type', 'Gender', 'Why Acme?'], 'an unlisted topic and an empty widened answer are not judged');
  const owned = JSON.parse(ai.sent[0].messages[0].content.match(/<owned>(.*)<\/owned>/)[1]);
  for (const label of ['Street', 'Employment type', 'Work modes', 'Workload']) assert.ok(owned.includes(label), label);
  assert.ok(!owned.includes('Minimum acceptable'), 'a salary to state is a learning per country, never Strategy\'s minimum');
});

test('what you typed replaces a learning no one confirmed, and confirms one it agrees with; a confirmed one gets two answers', async () => {
  const s = fresh();
  await page(s).write('## Learned from forms\n- Willing to travel: Yes (guess)\n- Contract type: Permanent (new)\n- Notice period: 3 months\n');
  const ai = fakeAi({'Travel?': {verdict: 'conflicts', topic: 'Willing to travel'}, 'Contract': {verdict: 'same', topic: 'Contract type'}, 'Notice': {verdict: 'conflicts', topic: 'Notice period'}});
  await learn(s, [{label: 'Travel?', value: 'No', state: ''}, {label: 'Contract', value: 'permanent', state: ''}, {label: 'Notice', value: '1 month', state: ''}], ai);
  assert.deepEqual(await lines(s), ['## Learned from forms', 'Willing to travel: No', 'Contract type: Permanent', 'Notice period: 3 months (two answers: 1 month)']);
});

test('a label the AI reads as a fixed detail is proposed to the shared meanings; no AI learns nothing and leaves the page', async () => {
  const s = fresh();
  await page(s).write('## Common questions\n- Notice period: 3 months\n');
  const proposed = [];
  await learn(s, [{label: 'Código postal', value: '8000', state: 'new'}], fakeAi({'Código postal': {verdict: 'owned', key: 'postal_code'}}), {propose: items => proposed.push(...items)});
  assert.deepEqual(proposed, [{key: 'postal_code', phrase: 'Código postal'}]);
  assert.equal(await learnings.learn(s, {answers: [{label: 'Travel', value: 'Yes'}], client: null}), null);
  assert.deepEqual(await lines(s), ['## Common questions', 'Notice period: 3 months']);
});

test('a fill teaches only what its AI wrote and the form took; an unsure answer is a guess', () => {
  const run = {trace: [{label: 'Willing to travel', outcome: 'filled'}, {label: 'Notice period', outcome: 'filled'}, {label: 'Salary', outcome: 'left'}, {label: 'Pets', outcome: 'filled'}],
    debug: {form: [{field: 'f4', label: 'Pets'}], answers: [{field: 'f1', question: 'Willing to travel', value: 'Yes', source: 'Claude (on the page)', confidence: 'high'},
      {field: 'f2', question: 'Notice period', value: '3 months', source: 'kit'}, {field: 'f3', question: 'Salary', value: 'CHF 120k', source: 'Claude (on the page)'},
      {field: 'f4', value: 'None', source: 'Claude (on the page)', confidence: 'low'}]}};
  assert.deepEqual(learnings.fromFill(run), [{label: 'Willing to travel', value: 'Yes', state: 'new'}, {label: 'Pets', value: 'None', state: 'guess'}]);
});

test('Submit\'s typed answers are judged like a fill\'s, confirmed, and the evidence is kept by label; an unjudged one stays a plain line', async () => {
  const s = fresh();
  await page(s).write('## Common questions\n- Willing to travel: Yes\n');
  const ai = fakeAi({'Travel for work?': {verdict: 'same', topic: 'Willing to travel'}, 'Driving license': {verdict: 'new', question: 'Driving license', answer: 'B'}});
  const result = await save(s, {job: 'https://jobs.example.test/1', items: [{label: 'Travel for work?', value: 'Yes'}, {label: 'Driving license', value: 'B'}, {label: 'Pets', value: 'None'}]}, {client: ai.client});
  assert.equal(result.ok, true);
  assert.deepEqual(await lines(s), ['## Common questions', 'Willing to travel: Yes', `## ${learnings.HEADING}`, 'Driving license: B', 'Pets: None']);
  assert.equal(cached(s)['travel for work'].learned, 'Willing to travel');
  assert.deepEqual(cached(s)['travel for work'].fills.map(fill => fill.url), ['https://jobs.example.test/1']);
});

test('What we learned\'s drawer checks each learning a fill wrote; Confirm writes it without its state and keeps its kind', async () => {
  const s = fresh();
  await page(s).write('## Learned from forms\n- Willing to travel: Yes, up to 20% (new) [yes/no]\n- Contract type: Permanent (two answers: Freelance)\n- Notice period: 3 months\n');
  const items = (await review.pending(s)).filter(each => ['taught', 'conflict'].includes(each.details.kind));
  assert.deepEqual(items.map(each => [each.details.kind, each.question, each.value]), [['taught', 'Willing to travel', 'Yes, up to 20%'], ['conflict', 'Contract type', 'Permanent']]);
  assert.equal(items[0].proposal, 'Yes, up to 20%', 'unchanged it reads Confirm (pages/question-review.js saveWord)');
  assert.deepEqual(items[1].format.options, ['Permanent', 'Freelance']);
  assert.equal((await review.answer(s, items[0].key, 'Yes, up to 20%')).ok, true);
  assert.equal((await review.answer(s, items[1].key, 'Freelance')).ok, true);
  assert.deepEqual(await lines(s), ['## Learned from forms', 'Willing to travel: Yes, up to 20% [yes/no]', 'Contract type: Freelance', 'Notice period: 3 months']);
});
