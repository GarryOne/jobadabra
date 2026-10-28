// CV tailoring reads About you, not the whole Profile page (spec 2026-10-28-about-you-everywhere-design.md, D1c-1; owner, 28 Oct 2026): its prompt holds the candidate's
// details, strategy and learnings and none of their salary, no sensitive answer and no conflicting one; a learning may shape the summary only. A fake AI client records the
// prompt; one unique word per part. Fictional facts, no AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {bundleOf} from '../lib/about-you.js';
import * as cvlib from '../lib/cv.js';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import {keyOf} from '../renderer/question-filter.js';

const SOURCES = {
  details: [{label: 'Notice period', value: 'DETAILSWORD 3 months', kind: 'duration'}, {label: 'Salary expectation', value: 'CHF 140,000', kind: 'salary'}],
  cv: {summary: 'CVWORD engineer'},
  learned: [{question: 'Ways of working', answer: 'LEARNEDWORD distributed teams', state: '', sensitive: false, kind: 'text'},
    {question: 'Salary in Germany', answer: 'EUR 95,000', state: '', sensitive: false, kind: 'salary'},
    {question: 'Gender', answer: 'SENSITIVEWORD', state: '', sensitive: true, kind: 'single'},
    {question: 'Take-home', answer: 'CONFLICTWORD', state: 'conflict', sensitive: false, kind: 'text'}],
  strategy: [{label: 'Roles', value: 'STRATEGYWORD', group: 'roles'}, {label: 'Minimum acceptable', value: 'CHF 120,000', group: 'pay'}],
};
const BASE = {summary: 'Engineer.', jobs: [{company: 'Acme', roles: [{title: 'Engineer', period: '2020-2024', bullets: ['Built things.'], skills: ''}]}]};
const ANSWER = {summary: 'Engineer.', jobs: [{company: 'Acme', roles: [{title: 'Engineer', period: '2020-2024', bullets: [{source: 0, text: 'Built things.'}], skills: ''}]}], changes: []};
const storage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cvt-')), {encrypt: v => v, decrypt: v => v});
async function promptOf(about) {
  let asked;
  const client = {messages: {create: async request => { asked = request; return {stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text: JSON.stringify(ANSWER)}]}; }}};
  await cvlib.tailor(storage(), {title: 'Engineer', company: 'Beta', description: 'x'}, '', {client, base: BASE, about});
  return {system: asked.system, user: asked.messages[0].content};
}

test('the prompt holds details, strategy and learnings; no salary, no sensitive or conflicting answer, and the CV once', async () => {
  const {user} = await promptOf(bundleOf(SOURCES, 'cv_tailor'));
  for (const word of ['DETAILSWORD', 'STRATEGYWORD', 'LEARNEDWORD']) assert.ok(user.includes(word), `positive control: ${word} is in the prompt`);
  for (const word of ['CHF 140,000', 'CHF 120,000', 'EUR 95,000', 'SENSITIVEWORD', 'CONFLICTWORD']) assert.ok(!user.includes(word), `${word} stays out`);
  assert.ok(!user.includes('CVWORD'), 'the bundle\'s own CV is not pasted a second time: the numbered CV is the one');
  assert.match(user, /<about_you>[\s\S]*<\/about_you>/);
  assert.doesNotMatch(user, /<profile>/);
});

test('the prompt tells the writer a learning may shape the summary only', async () => {
  const {system} = await promptOf(bundleOf(SOURCES, 'cv_tailor'));
  assert.match(system, /A learned answer may\s+shape the summary only/);
  assert.match(system, /never put one in a role's bullets or skills/);
});

test('a part that could not be read is named, never filled from elsewhere', async () => {
  const {cv, ...rest} = SOURCES;
  assert.ok(cv);
  const {strategy, ...noStrategy} = rest;
  assert.ok(strategy);
  const {user} = await promptOf(bundleOf(noStrategy, 'cv_tailor', {skip: ['cv']}));
  assert.match(user, /not available this time: strategy/);
  assert.ok(!user.includes('STRATEGYWORD'));
});

// The default path (no bundle given): tailor reads About you itself, so every caller is covered; the CV is skipped (the prompt carries it numbered).
test('with no bundle given, tailor reads the candidate\'s details, strategy and learnings from the store itself', async () => {
  const own = storage();
  own.saveSettings({store: 'sqlite', questionVerdicts: {[keyOf('Ways of working')]: {reuse: 'reusable', sensitive: false}}, questionFormats: {[keyOf('Ways of working')]: {kind: 'text'}}});
  const opened = store.openStore(own);
  await opened.page('answers').write('## Learned from forms\n| Question | Answer |\n|---|---|\n| Ways of working | STOREDLEARNING small teams |\n');
  await opened.page('profile').write('## Targets\n- **Roles:** STOREDSTRATEGY platform engineer\n- **Minimum acceptable:** CHF 120,000\n');
  let asked;
  const client = {messages: {create: async request => { asked = request; return {stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text: JSON.stringify(ANSWER)}]}; }}};
  await cvlib.tailor(own, {title: 'Engineer', company: 'Beta', description: 'x'}, '', {client, base: BASE});
  const user = asked.messages[0].content;
  assert.ok(user.includes('STOREDLEARNING') && user.includes('STOREDSTRATEGY'), 'positive control: what the store holds reaches the prompt');
  assert.ok(!user.includes('CHF 120,000'), 'the pay rule stays out');
  assert.doesNotMatch(user, /not available this time: [^\n]*cv/, 'the CV is skipped, not named lacked');
});

test('a store that cannot be read leaves the prompt naming what is missing, tailoring still runs, and the read is not repeated', async () => {
  const asked = [];
  const client = {messages: {create: async request => { asked.push(request.messages[0].content); return {stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text: JSON.stringify(ANSWER)}]}; }}};
  const about = await cvlib.aboutFor(null);   // a null store cannot be read
  assert.deepEqual(about.lacked, ['details', 'learned', 'strategy']);
  await cvlib.tailor(null, {title: 'Engineer', company: 'Beta', description: 'x'}, '', {client, base: BASE, about});
  assert.match(asked[0], /not available this time: details, learned, strategy/);
});

// Why (Gitar on #2373): the CV is carried by the prompt itself, so a reader may skip it: it is neither read, counted in the budget nor named lacked, and Strategy is not cut for it.
test('a skipped part is not counted: a long CV no longer cuts Strategy', () => {
  const long = {...SOURCES, cv: {summary: 'x'.repeat(60000)}};
  const kept = bundleOf(long, 'cv_tailor', {skip: ['cv']});
  assert.ok(JSON.stringify(kept.parts.strategy).includes('STRATEGYWORD'));
  assert.equal(kept.parts.cv, undefined);
  assert.deepEqual(kept.lacked, []);
  assert.ok(!JSON.stringify(bundleOf(long, 'cv_tailor').parts.strategy || []).includes('STRATEGYWORD'), 'positive control: counted, the same CV cuts Strategy');
});
