// "Build a CV with the AI" (lib/cv-build.js): the person's answers become a CV in the app's schema. The AI writes only the words (summary,
// bullets, skills line); the code keeps every fact the person gave (employers, titles, dates, places, schools) and drops a bullet with a number the
// person never said. A built CV is saved as the main CV and is never read a second time by the PDF import.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as cv from '../lib/cv.js';
import * as atUpload from '../lib/cv-import-at-upload.js';
import {buildCv, saveBuilt, validAnswers} from '../lib/cv-build.js';
import {createStorage} from '../lib/storage.js';

const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-cvbuild-')), {encrypt: v => v, decrypt: v => v});
const ANSWERS = {name: 'Mara Ionescu', location: 'Cluj-Napoca, Romania', targetRole: 'Nurse', years: '6', skills: 'wound care, triage, patient education', languages: 'Romanian, English (B2)',
  jobs: [{company: 'Regional Hospital', title: 'Staff nurse', from: 'Mar 2021', to: '', place: 'Cluj-Napoca', did: 'Cared for 12 patients a shift on the surgical ward. Trained new nurses.'},
          {company: 'City Clinic', title: 'Nursing assistant', from: 'Jun 2018', to: 'Feb 2021', place: 'Cluj-Napoca', did: 'Took vitals and helped with dressings.'}],
  education: [{school: 'UMF Cluj', degree: 'BSc Nursing', period: '2014 – 2018'}]};
const reply = (answer, calls = []) => ({messages: {create: async request => { calls.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(answer)}], usage: {input_tokens: 10, output_tokens: 10}}; }}});
const GOOD = {summary: 'Nurse with 6 years on surgical wards.', roles: [{index: 0, bullets: ['Cared for 12 patients per shift on a surgical ward.', 'Trained new nurses.']}, {index: 1, bullets: ['Took vitals and assisted with dressings.']}], skills: 'Wound care, triage, patient education'};

test('the AI writes the words, the code keeps the facts', async () => {
  const {cv: built} = await buildCv(ANSWERS, null, reply({...GOOD, roles: [{index: 0, bullets: GOOD.roles[0].bullets}, {index: 1, bullets: GOOD.roles[1].bullets}]}));
  assert.deepEqual(built.jobs.map(j => j.company), ['Regional Hospital', 'City Clinic']);
  assert.equal(built.jobs[0].roles[0].period, 'Mar 2021 – Present');
  assert.equal(built.jobs[1].roles[0].period, 'Jun 2018 – Feb 2021');
  assert.equal(built.jobs[0].roles[0].title, 'Staff nurse');
  assert.deepEqual(built.education, ANSWERS.education);
  assert.equal(built.name, 'Mara Ionescu');
  assert.equal(built.summary, GOOD.summary);
});

test('an AI that renames an employer or adds a job changes nothing: the facts come from the answers', async () => {
  const {cv: built} = await buildCv(ANSWERS, null, reply({...GOOD, roles: [{index: 0, bullets: ['Cared for 12 patients.']}, {index: 1, bullets: ['Took vitals.']}, {index: 2, bullets: ['Invented a job.']}], company: 'Mayo Clinic'}));
  assert.equal(built.jobs.length, 2);
  assert.deepEqual(built.jobs.map(j => j.company), ['Regional Hospital', 'City Clinic']);
});

test('a bullet with a number the person never said is dropped; a role left empty keeps the person\'s own words', async () => {
  const {cv: built} = await buildCv(ANSWERS, null, reply({...GOOD, roles: [{index: 0, bullets: ['Cut errors by 40%.', 'Cared for 12 patients per shift.']}, {index: 1, bullets: ['Handled 300 cases.']}]}));
  assert.deepEqual(built.jobs[0].roles[0].bullets, ['Cared for 12 patients per shift.']);
  assert.deepEqual(built.jobs[1].roles[0].bullets, ['Took vitals and helped with dressings.']);
});

test('answers are checked before any AI call: a name and one job with an employer and a title are needed', async () => {
  const calls = [];
  assert.equal(validAnswers({...ANSWERS, name: ' '}).ok, false);
  assert.equal(validAnswers({...ANSWERS, jobs: []}).ok, false);
  assert.equal(validAnswers({...ANSWERS, jobs: [{company: '', title: 'x'}]}).ok, false);
  assert.equal(validAnswers(ANSWERS).ok, true);
  await assert.rejects(buildCv({...ANSWERS, name: ''}, null, reply(GOOD, calls)));
  assert.equal(calls.length, 0);
});

test('a built CV becomes the main CV and its PDF is not read again by the import', async () => {
  const storage = tempStorage(), calls = [];
  const {cv: built} = await buildCv(ANSWERS, null, reply(GOOD));
  const {name} = saveBuilt(storage, built, Buffer.from('%PDF built'), 'Mara_Ionescu_CV.pdf');
  assert.equal(name, 'Mara_Ionescu_CV.pdf');
  assert.equal(fs.existsSync(storage.path('cv.pdf')), true);
  assert.deepEqual(cv.baseCv(storage).jobs.map(j => j.company), ['Regional Hospital', 'City Clinic']);
  assert.equal(storage.settings().cvName, 'Mara_Ionescu_CV.pdf');
  const result = await atUpload.ensure(storage, {client: reply(GOOD, calls), key: '', atUpload: true});
  assert.equal(result.skipped, 'already imported');
  assert.equal(calls.length, 0);
});
