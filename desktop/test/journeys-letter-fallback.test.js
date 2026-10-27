// The setup queue does not run delivery; this scenario asserts which approved document the form boundary receives.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';

const FORM = 'https://apply.example/form';
test('scenario: a form without a usable tailored letter receives the approved base even with a legacy false flag; tailored wins once usable', async () => {
  const {availableLetter} = await import('../lib/letter-availability.js');
  const letters = await import('../lib/cover-letter.js');
  const cv = await import('../lib/cv.js');
  const jobLetter = await import('../lib/job-letter.js');
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-approved-letter-fallback-')), {encrypt: value => value, decrypt: value => value});
  const job = {code: 'letter-fallback', title: 'SRE', company: 'Example', url: FORM, description: 'Run reliable services.'};
  const profileCv = {name: 'Ada Example', summary: 'SRE.', jobs: []};
  fs.mkdirSync(storage.path('cv'), {recursive: true});
  fs.writeFileSync(storage.path('cv/cv.json'), JSON.stringify(profileCv));
  storage.saveSettings({letterFallback: false});
  const fakeClient = {messages: {create: async () => ({stop_reason: 'end_turn', usage: {input_tokens: 10, output_tokens: 10},
    content: [{type: 'text', text: JSON.stringify({letter: 'Dear Hiring Team,\n\nI build reliable services.'})}]})}};
  await letters.generate(storage, {client: fakeClient});
  assert.equal(availableLetter(storage, FORM).status.ready, false, 'an unapproved draft remains unusable');
  letters.approve(storage, Buffer.from('%PDF-approved-base'));
  assert.equal(availableLetter(storage, FORM).status.source, 'base', 'a legacy opt-out does not block the approved fallback');
  assert.equal(Buffer.from(availableLetter(storage, FORM).file.data, 'base64').toString(), '%PDF-approved-base');
  cv.save(storage, job.code, {job, cv: profileCv}, Buffer.from('%PDF-tailored-cv'));
  assert.equal(availableLetter(storage, FORM).status.source, 'base', 'a tailored CV without a usable letter leaves the base fallback eligible');
  jobLetter.save(storage, job.code, {job, text: 'Dear Hiring Team,\n\nExample: I build reliable services.', source: 'kit'}, Buffer.from('%PDF-tailored-letter'));
  assert.equal(availableLetter(storage, FORM).status.source, 'tailored', 'a usable tailored letter takes precedence');
  assert.equal(Buffer.from(availableLetter(storage, FORM).file.data, 'base64').toString(), '%PDF-tailored-letter');
  assert.equal(storage.settings().letterFallback, false, 'reading the legacy preference never rewrites profile settings');
});
