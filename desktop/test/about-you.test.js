// About you, everywhere (spec 2026-10-28-about-you-everywhere-design.md, criteria 1-3, 6): each reader gets exactly its parts through lib/about-you.js, salary
// never reaches CV tailoring or a letter, sensitive answers reach only form filling and kit answers, a conflict reaches no one, a missing part is named.
// Fictional facts, one unique word per part; no AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {READERS, aboutYou, bundleOf} from '../lib/about-you.js';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import {keyOf} from '../renderer/question-filter.js';

const SOURCES = {
  details: [{label: 'Notice period', value: 'DETAILSWORD 3 months', kind: 'duration'}, {label: 'Salary expectation', value: 'CHF 140,000', kind: 'salary'}],
  cv: {summary: 'CVWORD engineer'},
  learned: [{question: 'Willing to travel', answer: 'LEARNEDWORD up to 20%', state: '', sensitive: false, kind: 'text'},
    {question: 'Salary in Germany', answer: 'EUR 95,000', state: '', sensitive: false, kind: 'salary'},
    {question: 'Gender', answer: 'SENSITIVEWORD', state: '', sensitive: true, kind: 'single'},
    {question: 'Take-home', answer: 'CONFLICTWORD', state: 'conflict', sensitive: false, kind: 'text'},
    {question: 'Pets at work', answer: 'UNJUDGEDWORD', state: '', kind: 'text'},
    {question: 'Remote days', answer: 'NOKINDWORD', state: '', sensitive: false, kind: ''}],
  strategy: [{label: 'Roles', value: 'STRATEGYWORD', group: 'roles'}, {label: 'Minimum acceptable', value: 'CHF 120,000', group: 'pay'}],
  history: [{company: 'HISTORYWORD'}],
  voice: 'VOICEWORD',
  this_job: {sent: 'THISJOBWORD'},
};
const WORDS = {details: 'DETAILSWORD', cv: 'CVWORD', learned: 'LEARNEDWORD', strategy: 'STRATEGYWORD', history: 'HISTORYWORD', voice: 'VOICEWORD', this_job: 'THISJOBWORD'};
const said = bundle => JSON.stringify(bundle.parts);

test('each reader gets exactly its parts: every part it takes is there, no other part is', () => {
  for (const [reader, rule] of Object.entries(READERS)) {
    const text = said(bundleOf(SOURCES, reader));
    for (const [part, word] of Object.entries(WORDS)) assert.equal(text.includes(word), rule.parts.includes(part), `${reader} ${part}`);
  }
});

test('salary never reaches CV tailoring or a letter, from any part; the others keep it', () => {
  for (const reader of Object.keys(READERS)) {
    const text = said(bundleOf(SOURCES, reader)), noSalary = ['cv_tailor', 'letter'].includes(reader);
    for (const money of ['CHF 140,000', 'EUR 95,000', 'CHF 120,000']) {
      if (!READERS[reader].parts.includes('strategy') && money === 'CHF 120,000') continue;
      assert.equal(text.includes(money), !noSalary, `${reader} ${money}`);
    }
    assert.equal(text.includes('NOKINDWORD'), !noSalary, `${reader}: a learning whose kind was never judged is no salary-free line`);
  }
});

test('a sensitive learning, or one not judged yet, reaches only form filling and kit answers; a conflict reaches no reader', () => {
  for (const reader of Object.keys(READERS)) {
    const text = said(bundleOf(SOURCES, reader)), field = ['form', 'kit'].includes(reader);
    assert.equal(text.includes('SENSITIVEWORD'), field, `${reader} sensitive`);
    assert.equal(text.includes('UNJUDGEDWORD'), field, `${reader} not judged`);
    assert.ok(!text.includes('CONFLICTWORD'), `${reader} conflict`);
  }
});

test('a part the sources lack is named, never invented; CV tailoring is told learnings are for its summary only', () => {
  const {cv, ...noCv} = SOURCES;
  assert.ok(cv);
  assert.deepEqual(bundleOf(noCv, 'kit').lacked, ['cv']);
  assert.deepEqual(bundleOf(SOURCES, 'kit').lacked, []);
  assert.equal(bundleOf(SOURCES, 'cv_tailor').learnedUse, 'summary');
  assert.throws(() => bundleOf(SOURCES, 'nobody'), /no reader/);
});

test('over budget, the lowest part is cut first: a long history never pushes out a fact', () => {
  const long = {...SOURCES, history: Array.from({length: 400}, (_, at) => ({company: `Employer ${at}`, outcome: 'rejected after the first interview'}))};
  const bundle = bundleOf(long, 'insights');
  assert.ok(JSON.stringify(bundle.parts).length <= 12000);
  assert.ok(bundle.parts.history.length < 400, 'history cut');
  assert.match(said(bundle), /DETAILSWORD/);
  assert.match(said(bundle), /LEARNEDWORD/);
});

test('aboutYou reads each part from its one source on a local store: Your details, What we learned with the AI\'s verdicts, Strategy, the CV', async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-about-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite', questionVerdicts: {[keyOf('Willing to travel')]: {reuse: 'reusable', sensitive: false}, [keyOf('Gender')]: {reuse: 'reusable', sensitive: true}},
    questionFormats: {[keyOf('Willing to travel')]: {kind: 'text'}}});
  const opened = store.openStore(storage);
  await opened.page('answers').write('## Learned from forms\n| Question | Answer |\n|---|---|\n| Willing to travel | Yes, up to 20% |\n| Gender | Decline to say |\n| Take-home | Yes (two answers: Only if paid) |\n');
  await opened.page('profile').write('## Targets\n- **Roles:** Data engineer\n- **Minimum acceptable:** CHF 120,000\n');
  fs.mkdirSync(storage.path('cv'), {recursive: true});
  fs.writeFileSync(path.join(storage.path('cv'), 'cv.json'), JSON.stringify({basics: {name: 'Alex Morgan'}}));
  const letter = await aboutYou(storage, 'letter');
  assert.deepEqual(letter.parts.learned.map(each => each.question), ['Willing to travel']);
  assert.equal(letter.parts.cv.basics.name, 'Alex Morgan');
  assert.deepEqual(letter.lacked, ['voice'], 'voice comes with the letter readers (PR D1c)');
  const form = await aboutYou(storage, 'form');
  assert.deepEqual(form.parts.learned.map(each => each.question), ['Willing to travel', 'Gender'], 'a form fills the sensitive field itself; the conflict waits');
});
