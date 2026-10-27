// Every list of open questions reads the same filter (owner, 17 Oct 2026): Jobs → Answer once, Profile → Needs review's verdicts, and the session's "what Claude needs".
// The test loops over the consumers: a list added without the filter fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import * as lists from '../lib/question-lists.js';
import {keyOf, visibleQuestions} from '../renderer/question-filter.js';
import {createStorage} from '../lib/storage.js';

const storage = () => createStorage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-')), 'x'), {encrypt: v => v, decrypt: v => v});
const JUNK = ['text-3219', 'Colonist Profile', 'I hereby agree (Art. 13 GDPR)'];
const GOOD = ['Visa sponsorship needed?'];
const groups = [{category: 'Availability', items: [{question: 'Notice period / earliest start', answer: '3 months', open: false},
  ...[...JUNK, ...GOOD, 'Earliest start date?'].map(question => ({question, answer: '', open: true}))]}];
const verdict = (reuse, covered = '') => ({reuse, covered_by: covered, proposal: covered ? '3 months' : ''});
const known = {[keyOf('Colonist Profile')]: verdict('one_job'), [keyOf('I hereby agree (Art. 13 GDPR)')]: verdict('consent'),
  [keyOf('Visa sponsorship needed?')]: verdict('reusable'), [keyOf('Earliest start date?')]: verdict('reusable', 'Notice period / earliest start')};
const ANSWER = {verdicts: [
  {label: 'Colonist Profile', verdict: 'one_job', covered_by: ''}, {label: 'I hereby agree (Art. 13 GDPR)', verdict: 'consent', covered_by: ''},
  {label: 'Visa sponsorship needed?', verdict: 'reusable', covered_by: ''}, {label: 'Earliest start date?', verdict: 'reusable', covered_by: 'Notice period / earliest start'}]};
const ai = {client: {messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify(ANSWER)}]})}}};
const rows = groups[0].items.filter(item => item.open).map(item => ({question: item.question}));

const CONSUMERS = {
  'Jobs → Answer once': async s => (await lists.openShown(s, {rows, groups, ai})).list.map(row => row.question),
  'Profile → Needs review': async s => {
    const {verdicts} = await lists.reviewVerdicts(s, rows.map(row => row.question), {groups, ai});
    return visibleQuestions(rows, verdicts).shown.map(row => row.question);
  },
  'What Claude needs': async s => { s.saveSettings({questionVerdicts: known}); return lists.filterGroups(s, groups).flatMap(group => group.items).filter(item => item.open).map(item => item.question); },
};

for (const [name, read] of Object.entries(CONSUMERS)) {
  test(`${name}: junk is hidden, a real question stays, the covered one stays with its answer`, async () => {
    const shown = await read(storage());
    for (const junk of JUNK) assert.ok(!shown.includes(junk), `${junk} must not show in ${name}`);
    for (const good of GOOD) assert.ok(shown.includes(good), good);
    assert.ok(shown.includes('Earliest start date?'));
  });
}

test('verdicts are kept per question: a second read asks the AI nothing', async () => {
  const s = storage();
  let calls = 0;
  const counting = {client: {messages: {create: async (...args) => { calls += 1; return ai.client.messages.create(...args); }}}};
  await lists.openShown(s, {rows, groups, ai: counting});
  const first = calls;   // the verdicts, and the kinds of the rows with no mark (lib/question-formats.js)
  assert.ok(first >= 1 && first <= 2);
  await lists.openShown(s, {rows, groups, ai: counting});
  assert.equal(calls, first, 'a second read asks the AI nothing');
  const shown = (await lists.openShown(s, {rows, groups, ai: counting})).list.find(row => row.question === 'Earliest start date?');
  assert.equal(shown.proposal, '3 months');
});

test('every file that reads the open questions is a known consumer of the shared filter', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const readers = [];
  for (const dir of ['lib', 'renderer', 'renderer/pages']) {
    for (const file of fs.readdirSync(path.join(root, dir)).filter(name => name.endsWith('.js'))) {
      const text = fs.readFileSync(path.join(root, dir, file), 'utf8');
      if (/questions\.(list|standardAnswers)\(|pilot\.(openQuestions|standardAnswers)\(/.test(text)) readers.push(`${dir}/${file}`);
    }
  }
  // each reads through lib/question-lists.js (Jobs, Needs review's verdicts, what Claude needs) or is the filter's own source; a new reader fails here until it is added with its filter
  assert.deepEqual(readers.sort(), ['lib/job-actions-handlers.js', 'lib/question-lists.js', 'lib/server-env.js', 'renderer/pages/jobs-questions.js', 'renderer/pages/session-needs.js'].sort());
});

test('ranking: a question that blocked a fill, then the most asked, first', () => {
  const v = {[keyOf('Visa?')]: {reuse: 'reusable', asked: 5}, [keyOf('Pronouns')]: {reuse: 'reusable', asked: 1, blocked: true}, [keyOf('Degree?')]: {reuse: 'reusable', asked: 3}};
  assert.deepEqual(visibleQuestions([{question: 'Degree?'}, {question: 'Visa?'}, {question: 'Pronouns'}], v).shown.map(row => row.question), ['Pronouns', 'Visa?', 'Degree?']);
});

test('record: how many forms asked, blocked, and which job; a one-job question comes back for that job only', async () => {
  const {record, forJob} = await import('../lib/question-verdicts.js');
  const s = storage();
  s.saveSettings({questionVerdicts: {[keyOf('Why Colonist?')]: {reuse: 'one_job', question: 'Why Colonist?', asked: 0}, [keyOf('Notice period')]: {reuse: 'reusable', question: 'Notice period', asked: 0}}});
  record(s, ['Why Colonist?', 'Notice period', 'Never judged'], {url: 'https://jobs.example/colonist', company: 'Colonist'});
  record(s, ['Why Colonist?'], {url: 'https://jobs.example/colonist', company: 'Colonist'});
  const kept = s.settings().questionVerdicts;
  assert.equal(kept[keyOf('Why Colonist?')].asked, 2);
  assert.equal(kept[keyOf('Why Colonist?')].jobs.length, 1, 'the same job once');
  assert.ok(kept[keyOf('Notice period')].blocked);
  assert.ok(!kept[keyOf('Never judged')], 'no stub for an unjudged question');
  assert.deepEqual(forJob(s, 'https://jobs.example/colonist'), [{question: 'Why Colonist?', state: 'one_job'}, {question: 'Notice period', state: 'once'}]);
  assert.deepEqual(forJob(s, 'https://jobs.example/other'), []);
});

test('consent boxes are counted for the one-line note, never listed', async () => {
  const result = await lists.openShown(storage(), {rows, groups, ai});
  assert.equal(result.consent, 1);
  assert.ok(!result.list.some(row => /GDPR/.test(row.question)));
});

// PR 2b step 1: a deduced answer that is not one of the row's options is not proposed; a changed saved answer is judged again.
test('Answer once: a proposal outside the row options is dropped; a changed saved answer asks again', async () => {
  const s = storage(), calls = [];
  const groups2 = [{category: 'Work', items: [{question: 'Work permit', answer: 'Swiss C permit', open: false},
    {question: 'Need sponsorship? [yes/no]', answer: '', open: true}, {question: 'Title [pick one: Mr | Mrs]', answer: '', open: true}]}];
  const reply = verdicts => ({client: {messages: {create: async () => { calls.push(1); return {content: [{type: 'text', text: JSON.stringify({verdicts})}]}; }}}});
  const marked = [{question: 'Need sponsorship?', mark: {kind: 'yes_no', options: []}}, {question: 'Title', mark: {kind: 'single', options: ['Mr', 'Mrs']}}];
  const first = await lists.openShown(s, {rows: marked, groups: groups2, ai: reply([
    {label: 'Need sponsorship?', verdict: 'reusable', covered_by: 'Work permit', value: 'no'}, {label: 'Title', verdict: 'reusable', covered_by: 'Work permit', value: 'Herr'}])});
  const by = Object.fromEntries(first.list.filter(row => !row.setup).map(row => [row.question, row.proposal || '']));
  assert.deepEqual(by, {'Need sponsorship?': 'No', 'Title': ''});
  const changed = [{...groups2[0], items: [{question: 'Work permit', answer: 'B permit, needs renewal', open: false}, ...groups2[0].items.slice(1)]}];
  await lists.openShown(s, {rows: marked, groups: changed, ai: reply([{label: 'Need sponsorship?', verdict: 'reusable', covered_by: '', value: ''}])});
  assert.equal(calls.length, 2, 'the saved answer behind a proposal changed: asked again');
});

test('a verdict from before deduction is judged once more, keeping its counts; then never again', async () => {
  const s = storage(), calls = [];
  s.saveSettings({questionVerdicts: {[keyOf('Need sponsorship?')]: {reuse: 'reusable', covered_by: '', proposal: '', question: 'Need sponsorship?', asked: 4, blocked: true}}});
  const groups3 = [{category: 'Work', items: [{question: 'Work permit', answer: 'Swiss C permit', open: false}, {question: 'Need sponsorship?', answer: '', open: true}]}];
  const ai3 = {client: {messages: {create: async () => { calls.push(1); return {content: [{type: 'text', text: JSON.stringify({verdicts: [{label: 'Need sponsorship?', verdict: 'reusable', covered_by: 'Work permit', value: 'No'}]})}]}; }}}};
  const rows3 = [{question: 'Need sponsorship?', mark: {kind: 'yes_no', options: []}}];
  const first = await lists.openShown(s, {rows: rows3, groups: groups3, ai: ai3});
  assert.equal(first.list.find(row => row.question === 'Need sponsorship?').proposal, 'No');
  const kept = s.settings().questionVerdicts[keyOf('Need sponsorship?')];
  assert.deepEqual([kept.asked, kept.blocked], [4, true]);
  await lists.openShown(s, {rows: rows3, groups: groups3, ai: ai3});
  assert.equal(calls.length, 1);
});

test('a question the fill marked [date] gets the AI\'s one judgment of whether it also asks about constraints, and Jobs draws it', async () => {
  const s = storage();
  const label = 'Earliest start date?';
  const formatsAnswer = {formats: [{label, kind: 'date', constraints: true, options: [], list: ''}]};
  const router = {client: {messages: {create: async request => ({content: [{type: 'text', text: JSON.stringify(/job-application form asked/.test(request.system) ? formatsAnswer : ANSWER)}]})}}};
  const list = (await lists.openShown(s, {rows: [{question: label, mark: {kind: 'date', options: []}}], groups, ai: router})).list;
  assert.equal(list.find(row => row.question === label)?.format.constraints, true);
});
