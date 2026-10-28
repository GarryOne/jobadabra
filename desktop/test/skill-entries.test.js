// Insight #6 (renderer/skill-entries.js): skills your target jobs ask for that only the Experience bank has. Counts from the skills already read from each posting.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {LOOK} from '../renderer/suggestions.js';
import {MAX_SKILLS, SKILL_DOES, bankSkills, skillEntries, targetJobs} from '../renderer/skill-entries.js';

const job = (fit, skills, extra = {}) => ({fit, skills, status: 'unreviewed', stage: '', ...extra});
const JOBS = [job(90, ['Spark', 'AWS']), job(82, ['spark', 'Kafka']), job(75, ['Kafka']), job(60, ['Spark']), job(95, ['Spark'], {status: 'applied'}), job(88, ['Spark'], {stage: 'Rejected'})];
const BANK = {jobs: JOBS, extraSkills: 'Spark, Kafka, Go', mainSkills: 'AWS, Terraform', added: []};

test('target jobs are job matches scored 70+ that are not applied to and not over', () => {
  assert.equal(targetJobs(JOBS).length, 3, '90, 82, 75: the 60, the applied and the rejected one do not count');
});

test('a bank-only skill is counted over the target jobs, most asked first, ignoring case; no job asking means no skill', () => {
  assert.deepEqual(bankSkills(BANK), [{skill: 'Spark', jobs: 2}, {skill: 'Kafka', jobs: 2}], 'Go is asked by nobody');
});

test('a skill in the main CV, or already added by the person, is not bank-only', () => {
  assert.deepEqual(bankSkills({...BANK, mainSkills: 'AWS, spark'}).map(item => item.skill), ['Kafka']);
  assert.deepEqual(bankSkills({...BANK, added: [{kind: 'skill', text: 'Kafka'}]}).map(item => item.skill), ['Spark']);
  assert.deepEqual(skillEntries({...BANK, added: [{kind: 'skill', text: 'Kafka'}, {kind: 'skill', text: 'Spark'}]}), [], 'nothing left to say: no row');
});

test('the row names the skills, the counts, its one action and Not now only', () => {
  const [row] = skillEntries(BANK);
  assert.equal(row.title, 'Spark, Kafka are only in your Experience bank');
  assert.equal(row.detail, 'Spark: 2 of 3 target jobs · Kafka: 2 of 3 target jobs');
  assert.deepEqual(row.actions, [{label: 'Use in my CVs', do: 'use_bank_skills', skills: ['Spark', 'Kafka']}]);
  assert.deepEqual(row.answers, ['Not now']);
  assert.equal(row.short, '2 CV skills to use');
});

test('the row key follows the skills, so a new skill is a new row and a Not now stays on the old one', () => {
  assert.notEqual(skillEntries(BANK)[0].key, skillEntries({...BANK, extraSkills: 'Spark, Go'})[0].key);
  assert.equal(skillEntries(BANK)[0].key, skillEntries({...BANK, extraSkills: 'Kafka, Spark'})[0].key);
});

test('at most MAX_SKILLS, no jobs and no bank are silent', () => {
  const many = Array.from({length: 6}, (_, i) => `S${i}`);
  assert.equal(bankSkills({jobs: [job(90, many)], extraSkills: many.join(', ')}).length, MAX_SKILLS);
  assert.deepEqual(skillEntries({}), []);
  assert.deepEqual(skillEntries({jobs: JOBS, extraSkills: ''}), []);
});

test('the row has a look, its button a handler in RUN, and its press a bridge and an IPC handler', () => {
  const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.ok(LOOK.skills, 'skills has a look');
  const row = skillEntries(BANK)[0];
  assert.deepEqual(row.actions.map(action => action.do), SKILL_DOES);
  for (const name of SKILL_DOES) assert.match(read('../renderer/pages/focus-suggestions.js'), new RegExp(`\\n  ${name}: `), `${name} has a handler in RUN`);
  for (const name of ['experienceAddSkills', 'experienceRemoveAdded']) {
    assert.match(read('../preload.cjs'), new RegExp(`${name}: call\\('${name}'\\)`), `${name} is bridged`);
    assert.match(read('../lib/experience-handlers.js'), new RegExp(`handle\\('${name}'`), `${name} is handled`);
  }
});
