// The education and current-job case set (lib/cv-facts-cases.mjs) on stubs: the scoring wants every field typed with the CV's value, a proposal or a wrong employer counts as a miss, and
// an ask that fails counts against the case. The real asks run by hand (npm run cv-facts-cases). The seeded CV states what the cases expect.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {CASES, EXPECT, runCases, score, summarize} from '../../lib/cv-facts-cases.mjs';

const GOOD = {school: 'Example University', degree: 'BSc Computer Science', start: '2014', end: '2018', company: 'Acme Cloud', title: 'Senior SRE', address: 'Musterstrasse 12, 8001 Zurich'};
const answers = (over = {}) => Object.entries({...GOOD, ...over}).map(([field, value]) => ({field, value, use: 'fill'}));

test('the cases ask the CV facts in three languages plus other wordings of the employer and the address; the fake CV states every expected value', () => {
  assert.deepEqual(CASES.map(item => item.id), ['english', 'german', 'employer-question', 'employer-plain', 'spanish-address', 'french']);
  for (const item of CASES) for (const f of item.fields) assert.ok(EXPECT[f.field], f.field);
  assert.equal(CASES.filter(item => item.fields.length === 6).length, 3);
  const cv = JSON.parse(fs.readFileSync(new URL('../../fixtures/cv.json', import.meta.url), 'utf8'));
  assert.equal(cv.jobs[0].company, 'Acme Cloud');
  assert.match(cv.jobs[0].roles[0].period, /Present/);
  assert.match(JSON.stringify(cv.education), /Example University.*2014.*2018/);
});

test('every field typed from the CV scores right; a proposal, an empty value or the previous employer is a miss', () => {
  assert.deepEqual(score(answers()).wrong, []);
  assert.deepEqual(score(answers({company: 'Beta Systems'})).wrong, ['company']);
  assert.deepEqual(score([...answers({title: ''})]).wrong, ['title']);
  assert.deepEqual(score(answers().map(item => item.field === 'school' ? {...item, use: 'propose'} : item)).wrong, ['school']);
  assert.deepEqual(score([]).right, []);
});

test('a case passes only when every ask got every field; a failed ask counts against it', async () => {
  const ok = summarize(await runCases(async () => answers(), {times: 2}));
  assert.equal(ok.ok, true); assert.equal(ok.line, 'cv facts cases: 6/6 cases right in every ask');
  const mixed = summarize(await runCases(async (item, round) => { if (item.id === 'german' && round === 1) throw new Error('usage limit'); return answers(item.id === 'french' ? {end: ''} : {}); }, {times: 2}));
  assert.equal(mixed.ok, false);
  assert.match(mixed.line, /NOT: german 1\/2, french 0\/2/);
});
