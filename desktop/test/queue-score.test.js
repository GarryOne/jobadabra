// One score for the whole review queue (owner, 18 Oct 2026: "Sorted by the most important/urgent. Basically scored"; decisions: a Your details item is
// scored "From its form questions", and a form question about the same fact is asked once). A form question keeps its score (a fill it blocked, then how
// many forms asked); a Your details item takes the sum of the form questions the AI mapped to its fact (verdict {reuse: 'details', fact}); one no form
// asked yet ranks right after the blocked questions. The AI is not called: verdicts are seeded as the classifier keeps them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import {openShown} from '../lib/question-lists.js';
import {factsOf} from '../lib/base-facts.js';
import * as review from '../lib/details-review.js';
import {BLOCKED, factScore, keyOf, ranked, visibleQuestions, weightOf} from '../renderer/question-filter.js';
import {fakeNotion} from './fake-notion.js';

const v = (fields) => ({v: 4, reuse: 'reusable', ...fields});

test('a form question: a fill it blocked first, then how many forms asked', () => {
  assert.equal(weightOf(v({blocked: true, asked: 2})), BLOCKED + 2);
  assert.equal(weightOf(v({asked: 7})), 7);
  assert.equal(weightOf(undefined), 0);
});

test('a Your details fact takes the score of the form questions mapped to it; none yet: right after the blocked questions', () => {
  const verdicts = {
    [keyOf('Do you need a visa?')]: v({reuse: 'details', fact: 'Work permit / visa', blocked: true, asked: 3}),
    [keyOf('Are you authorised to work in Switzerland?')]: v({reuse: 'details', fact: 'Work permit / visa', blocked: true, asked: 2}),
    [keyOf('Notice period?')]: v({reuse: 'details', fact: 'Notice period', asked: 4}),
  };
  assert.equal(factScore('Work permit / visa', verdicts), 2 * BLOCKED + 5);
  const asked = factScore('Notice period', verdicts), none = factScore('Languages', verdicts);
  assert.ok(asked < BLOCKED && asked > none, 'asked by forms ranks above asked by none');
  assert.ok(none > weightOf(v({asked: 900})), 'a fact ranks above any question no fill was blocked by');
});

test('ranked: one order for form questions and Your details items, ties keep their place', () => {
  const verdicts = {
    [keyOf('Salary expectation')]: v({blocked: true, asked: 2}),
    [keyOf('Can you start in 1 month?')]: v({asked: 4}),
    [keyOf('Rare question')]: v({asked: 1}),
    [keyOf('Do you need a visa?')]: v({reuse: 'details', fact: 'Work permit / visa', blocked: true, asked: 9}),
  };
  const list = [{question: 'Salary expectation'}, {question: 'Can you start in 1 month?'}, {question: 'Rare question'},
    {question: 'Work permit / visa', details: {kind: 'open', fact: 'Work permit / visa'}}, {question: 'Languages', details: {kind: 'open', fact: 'Languages'}}];
  assert.deepEqual(ranked(list, verdicts).map(row => row.question), ['Work permit / visa', 'Salary expectation', 'Languages', 'Can you start in 1 month?', 'Rare question']);
});

test('ask once: a question mapped to a fact with no value yet is neither shown nor counted as answered from Your details', () => {
  const verdicts = {[keyOf('Do you need a visa?')]: v({reuse: 'details', fact: 'Work permit / visa'}), [keyOf('Phone')]: v({reuse: 'details', fact: 'Phone'})};
  const rows = [{question: 'Do you need a visa?'}, {question: 'Phone'}];
  const out = visibleQuestions(rows, verdicts, {open: ['Work permit / visa']});
  assert.deepEqual(out.shown, []);
  assert.deepEqual(out.fromDetails.map(row => row.question), ['Phone'], 'only a fact with a value answers it');
  assert.deepEqual(out.viaDetails.map(row => row.question), ['Do you need a visa?']);
});

const PROFILE = ['## 🛂 Work eligibility', 'Work permit / visa: ❓ your citizenship and status', '## 💶 Availability & compensation', 'Notice period: 2 months [duration]'];
const ANSWERS = ['## ❓ Questions to answer', 'Do you need a visa?: ❓ (asked by Acme)', 'Salary expectation: ❓ (asked by Beta)', 'Rare question: ❓ (asked by Gamma)'];
const markdown = lines => lines.map(line => (line.startsWith('## ') ? line : `- ${line}`)).join('\n') + '\n';
const VERDICTS = {
  [keyOf('Do you need a visa?')]: v({reuse: 'details', fact: 'Work permit / visa', blocked: true, asked: 3}),
  [keyOf('Salary expectation')]: v({blocked: true, asked: 1}),
  [keyOf('Rare question')]: v({asked: 1}),
};
const plainCrypto = {encrypt: x => x, decrypt: x => x};
const fresh = settings => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-score-')), plainCrypto); s.saveSettings({telemetry: false, profileMovedAt: '2026-10-18T00:00:00.000Z', profileUnsureAt: '2026-10-18T00:00:00.000Z', ...settings}); return s; };
const ADAPTERS = {
  sqlite: async () => {
    const storage = fresh({store: 'sqlite'});
    const opened = store.openStore(storage);
    await opened.page('profile').write(markdown(PROFILE));
    await opened.page('answers').write(markdown(ANSWERS));
    return {storage};
  },
  notion: async () => {
    const pages = {profile: fakeNotion(PROFILE, {prefix: 'P'}), answers: fakeNotion(ANSWERS, {prefix: 'A'})};
    const fetcher = (url, init) => (url.includes('blocks/profile') || url.includes('blocks/P') ? pages.profile : pages.answers).fetcher(url, init);
    const storage = fresh({store: 'notion', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}});
    storage.setSecret('NOTION_TOKEN', 'secret');
    return {storage, fetcher};
  },
};

for (const [name, setup] of Object.entries(ADAPTERS)) {
  test(`${name}: the queue is one scored list; the visa question is asked once, as its Your details fact, first`, async () => {
    const {storage, fetcher} = await setup();
    storage.saveSettings({questionVerdicts: VERDICTS, missingFacts: {since: '2020-01-01'}});   // past the fresh install's 14 days: no missing-fact items beside these
    assert.ok((await factsOf(storage, fetcher)).some(fact => fact.label === 'Work permit / visa' && fact.value === ''), 'a fact with no value is listed (for the AI to map questions to)');
    const {list, fromDetails} = await openShown(storage, {fetcher, ai: {}});
    assert.deepEqual(list.map(row => row.question), ['What are your first and last name?', 'What is your email address?', 'What is your phone number?', 'Work permit / visa', 'Salary expectation', 'Rare question'], 'a name nobody gave is the first question, then the other must-haves');
    assert.equal(fromDetails, 0, 'nothing is answered from Your details yet');
  });
}

test('every kind of Your details item names its fact (the class: what the score is read from)', async () => {
  const storage = fresh({store: 'sqlite', profileConflicts: [{home: 'availability', topic: 'notice period', choices: [{label: 'Notice', value: '1 month', page: 'profile'}, {label: 'Notice period', value: '3 months', page: 'answers'}]}]});
  const opened = store.openStore(storage);
  await opened.page('profile').write(markdown([...PROFILE, 'Target: 10k or so [salary]', '## Preferences', 'Notice: 1 month', 'Relocation: maybe', 'Industries: ❓']));
  await opened.page('answers').write(markdown(['## Pay', 'Notice period: 3 months']));
  storage.saveSettings({profileUnsure: [{page: 'profile', label: 'Relocation', value: 'maybe'}], answerClarity: {'notice period\n2 months': 'guess'}});
  const items = await review.pending(storage);
  assert.deepEqual([...new Set(items.map(item => item.details.kind))].sort(), [...review.KINDS].sort(), 'every kind is drawn here');
  for (const item of items) assert.ok(item.details.fact, `${item.details.kind} "${item.question}" names its fact`);
});

test('a must-have contact detail (name, email, phone) ranks above a fill that was blocked', () => {
  const verdicts = {[keyOf('Salary expectation')]: v({blocked: true, asked: 9})};
  const rows = [{question: 'Salary expectation'}, {question: 'What are your first and last name?', details: {kind: 'contact', fact: 'Name', must: true}}];
  assert.equal(ranked(rows, verdicts)[0].details.kind, 'contact');
});
