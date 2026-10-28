// About you, everywhere (spec 2026-10-28-about-you-everywhere-design.md, criteria 1-3, 6): each reader gets exactly its parts through lib/about-you.js, salary
// never reaches CV tailoring or a letter, a sensitive answer and a conflict reach no reader, a missing part is named; kits get the CV with the Experience bank
// (owner, 28 Oct 2026, D1b option A). Fictional facts, one unique word per part; no AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {READERS, aboutYou, bundleOf, localBundle} from '../lib/about-you.js';
import * as experience from '../lib/experience.js';
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
  const MONEY = {details: 'CHF 140,000', learned: 'EUR 95,000', strategy: 'CHF 120,000'};
  for (const reader of Object.keys(READERS)) {
    const text = said(bundleOf(SOURCES, reader)), noSalary = ['cv_tailor', 'letter'].includes(reader), takes = READERS[reader].parts;
    for (const [part, money] of Object.entries(MONEY)) if (takes.includes(part)) assert.equal(text.includes(money), !noSalary, `${reader} ${money}`);
    if (takes.includes('learned')) assert.equal(text.includes('NOKINDWORD'), !noSalary, `${reader}: a learning whose kind was never judged is no salary-free line`);
  }
});

// Why (owner, 28 Oct 2026, D1b option A): form filling and kit answers, the two places a sensitive field is filled, read the answers page themselves.
test('a sensitive learning, one not judged yet, and a conflict reach no reader', () => {
  for (const reader of Object.keys(READERS)) {
    const text = said(bundleOf(SOURCES, reader));
    for (const word of ['SENSITIVEWORD', 'UNJUDGEDWORD', 'CONFLICTWORD']) assert.ok(!text.includes(word), `${reader} ${word}`);
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
  assert.deepEqual(letter.lacked, [], 'voice is gathered since D1c-2: with no rule and no approved letter it is empty, not lacked');
  assert.deepEqual(letter.parts.voice, {preferences: []});
  const portrait = await aboutYou(storage, 'portrait');
  assert.deepEqual(portrait.parts.learned.map(each => each.question), ['Willing to travel'], 'the sensitive answer and the conflict wait');
});

// The Profile's deal-breakers and other preferences are Strategy too (D1b: 2 of the demo Profile's lines the bundle dropped); a rule under Compensation is
// a pay line, kept from CV tailoring and letters like a pay field.
test('Strategy carries the deal-breakers and other preferences; a Compensation rule stays out of a letter', async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-about-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite'});
  await store.openStore(storage).page('profile').write('## Hard constraints\n- **Home base:** Zurich\n## Compensation\n- **Bonus:** PAYWORD at least 10%\n## Preferences (soft, used for ranking)\n- **On-call:** RANKWORD rarely\n## Deal-breakers\n- MUSTWORD roles that require fluent German\n');
  const score = said(await aboutYou(storage, 'score')), letter = said(await aboutYou(storage, 'letter'));
  for (const word of ['MUSTWORD', 'RANKWORD', 'PAYWORD', 'Zurich']) assert.match(score, new RegExp(word), `score ${word}`);
  assert.match(letter, /MUSTWORD/);
  assert.match(letter, /RANKWORD/);
  assert.doesNotMatch(letter, /PAYWORD/, 'a rule under Compensation is pay');
});

// The owner's case (spec criterion 4): a kit answer can rest on an Experience bank bullet, so the kit's CV is the main CV with the bank's bullets.
test('kits get the main CV with the Experience bank\'s bullets, built without a store read; no CV is named as lacked', () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-about-')), {encrypt: v => v, decrypt: v => v});
  assert.deepEqual(localBundle(storage, 'kit').lacked, ['cv'], 'a cloud-like Mac with no CV: named, never invented');
  const main = {name: 'Alex Morgan', jobs: [{company: 'Northwind', roles: [{title: 'SRE', period: '2022 – Present', bullets: ['Ran the on-call rotation.']}]}]};
  fs.mkdirSync(storage.path('cv/sources'), {recursive: true});
  fs.writeFileSync(path.join(storage.path('cv'), 'cv.json'), JSON.stringify(main));
  fs.writeFileSync(path.join(storage.path('cv/sources'), 'other.json'), JSON.stringify({id: 'other', name: 'Data CV', addedAt: '2026-10-01', mainKey: experience.mainKey(main),
    cv: {jobs: [{company: 'Northwind AG', roles: [{title: 'SRE', bullets: ['BANKWORD: wrote the blameless postmortem guide.']}]}]}, match: [{sourceRole: 0, mainJob: 0, mainRole: 0, newBullets: [0]}]}));
  const kit = localBundle(storage, 'kit');
  assert.deepEqual(kit.lacked, []);
  assert.match(JSON.stringify(kit.parts.cv), /BANKWORD/);
  assert.match(JSON.stringify(kit.parts.cv), /Ran the on-call rotation/);
  assert.throws(() => localBundle(storage, 'letter'), /needs a store read/);
});

// Gitar on #2337: over budget, an object part (the CV) stays an object, trimmed inside (its longest list loses items), never a cut-off JSON string; every part,
// voice and this job included, is in the cut order.
test('over budget, the CV stays a CV: its longest lists lose items, its basics stay; voice and this job are cut too', () => {
  const work = Array.from({length: 60}, (_, at) => ({name: `Employer ${at}`, highlights: Array.from({length: 8}, (__, each) => `Shipped thing ${each} at employer ${at}, measured`)}));
  const big = {...SOURCES, cv: {basics: {name: 'Alex Morgan'}, work}, voice: 'V'.repeat(30000), this_job: {sent: 'T'.repeat(30000)}};
  for (const reader of ['insights', 'letter', 'prep']) {
    const {parts} = bundleOf(big, reader);
    assert.ok(JSON.stringify(parts).length <= (READERS[reader].budget || 12000), `${reader} within budget`);
    assert.equal(typeof parts.cv, 'object', `${reader}: the CV is still an object`);
    assert.equal(parts.cv.basics.name, 'Alex Morgan');
    assert.match(JSON.stringify(parts), /DETAILSWORD/, `${reader}: facts stay`);
  }
});

// Gitar on #2337: one long text (a CV summary) is cut before the CV's roles are emptied: each step shrinks the heavier of the heaviest list and the longest text.
test('over budget, one long summary is cut before the CV loses its roles', () => {
  const cv = {basics: {name: 'Alex Morgan', summary: 'S'.repeat(20000)}, work: Array.from({length: 5}, (_, at) => ({name: `Employer ${at}`, highlights: ['Shipped a thing']}))};
  const {parts} = bundleOf({...SOURCES, cv}, 'letter');
  assert.ok(JSON.stringify(parts).length <= 12000);
  assert.equal(parts.cv.work.length, 5, 'every role stays');
  assert.ok(parts.cv.basics.summary.length < 20000, 'the summary was cut');
});

test('a role with one long description keeps the role: its text is cut first', () => {
  const cv = {basics: {name: 'Alex Morgan'}, work: [{name: 'Employer 0', description: 'D'.repeat(20000)}, {name: 'Employer 1', description: 'Short'}]};
  const {parts} = bundleOf({...SOURCES, cv}, 'letter');
  assert.deepEqual(parts.cv.work.map(role => role.name), ['Employer 0', 'Employer 1']);
});
