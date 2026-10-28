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
  const {user} = await promptOf(bundleOf(noStrategy, 'cv_tailor'));
  assert.match(user, /not available this time: strategy/);
  assert.ok(!user.includes('STRATEGYWORD'));
});

// The default path (no bundle given): tailor reads About you itself, so every caller is covered. On an empty store nothing is made up.
test('with no bundle given, tailor reads About you from the store itself and never throws on an empty one', async () => {
  let asked;
  const client = {messages: {create: async request => { asked = request; return {stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text: JSON.stringify(ANSWER)}]}; }}};
  await cvlib.tailor(storage(), {title: 'Engineer', company: 'Beta', description: 'x'}, '', {client, base: BASE});
  assert.match(asked.messages[0].content, /<about_you>/);
  assert.doesNotMatch(asked.messages[0].content, /<profile>/);
});
