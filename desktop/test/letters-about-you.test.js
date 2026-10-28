// Both letter writers (the one for a job, the general one) read the About you bundle of `letter`, read here from a seeded store: never a salary, never a sensitive
// answer, a learning and the person's Writing preferences in; the approved base letter is the voice example of a job's letter, never of the base letter itself.
// Owner, 28 Oct 2026 (About you D1c-2). Before: both prompts pasted the whole Profile and answers pages, salary lines included.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {keyOf} from '../renderer/question-filter.js';
import * as letters from '../lib/cover-letter.js';
import * as jobLetter from '../lib/job-letter.js';
import * as letterStyle from '../lib/letter-style.js';
import * as store from '../lib/store/index.js';
import {createStorage} from '../lib/storage.js';

const CV = {name: 'Ada Example', location: 'Zurich', summary: 'SRE.', jobs: [{company: 'Acme', roles: [{title: 'SRE', period: '2024 – Present', place: 'Zurich', bullets: ['Cut costs by **50%**.']}]}]};
const JOB = {code: 'abc123', title: 'SRE', company: 'Kestrel', url: 'https://jobs.kestrel.test/sre', description: 'Run our platform.'};
const BASE = 'Dear Hiring Team,\n\nI like small teams that own their pagers.';
const client = (letter, seen) => ({messages: {create: async request => { seen.push(request.messages[0].content); return {stop_reason: 'end_turn', usage: {input_tokens: 100, output_tokens: 50}, content: [{type: 'text', text: JSON.stringify({letter})}]}; }}});

async function seeded() {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-letters-about-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite', questionVerdicts: {[keyOf('Willing to travel')]: {reuse: 'reusable', sensitive: false}, [keyOf('Gender')]: {reuse: 'reusable', sensitive: true},
    [keyOf('Pay wanted')]: {reuse: 'reusable', sensitive: false}}, questionFormats: {[keyOf('Willing to travel')]: {kind: 'text'}, [keyOf('Pay wanted')]: {kind: 'salary'}}});
  const opened = store.openStore(storage);
  await opened.page('answers').write('## Learned from forms\n| Question | Answer |\n|---|---|\n| Willing to travel | Yes, up to 20% |\n| Gender | SENSITIVEWORD |\n| Pay wanted | CHF 130,000 |\n');
  await opened.page('profile').write('## Targets\n- **Roles:** Data engineer\n- **Minimum acceptable:** CHF 120,000\n');
  fs.mkdirSync(storage.path('cv'), {recursive: true});
  fs.writeFileSync(storage.path('cv/cv.json'), JSON.stringify(CV));
  letterStyle.save(storage, ['Tone: warm and direct']);
  return storage;
}

test('both letter prompts carry what they told us and their rules, never a salary or a sensitive answer', async () => {
  const storage = await seeded(), seen = [];
  await letters.generate(storage, {client: client(BASE, seen)});
  await jobLetter.draft(storage, {job: JOB, cv: CV, client: client('Dear Hiring Team,\n\nKestrel.', seen)});
  assert.equal(seen.length, 2, 'positive control: both writers asked the AI');
  for (const prompt of seen) {
    assert.match(prompt, /<about_you>/);
    assert.match(prompt, /Yes, up to 20%/, 'a learned answer reaches the prompt');
    assert.match(prompt, /Tone: warm and direct/, 'their Writing preferences reach the prompt');
    assert.match(prompt, /Data engineer/, 'their strategy reaches the prompt');
    assert.doesNotMatch(prompt, /CHF|130,000|120,000|Minimum acceptable|Pay wanted/, 'no salary');
    assert.doesNotMatch(prompt, /SENSITIVEWORD/, 'no sensitive answer');
    assert.doesNotMatch(prompt, /<profile>|<standard_answers>|<search_preferences>/, 'not the whole pages');
  }
});

test('the approved base letter is the voice example of a job\'s letter, not of the base letter; a draft is no example', async () => {
  const storage = await seeded(), seen = [];
  await letters.generate(storage, {client: client(BASE, seen)});
  await jobLetter.draft(storage, {job: JOB, cv: CV, client: client('Dear Hiring Team,\n\nKestrel.', seen)});
  assert.doesNotMatch(seen[1], /small teams that own their pagers/, 'a draft has not been accepted');
  letters.approve(storage, Buffer.from('%PDF-letter'));
  await jobLetter.draft(storage, {job: JOB, cv: CV, client: client('Dear Hiring Team,\n\nKestrel.', seen)});
  await letters.generate(storage, {client: client(BASE, seen), feedback: 'again'});   // the base letter reads without its own text as its voice
  assert.match(seen[2], /"example":"Dear Hiring Team,\\n\\nI like small teams that own their pagers\./, 'the approved base letter is the example');
  assert.doesNotMatch(seen[3], /"example"/, 'the base letter is not its own example');
});
