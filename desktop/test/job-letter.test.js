import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as cv from '../lib/cv.js';
import * as letters from '../lib/cover-letter.js';
import * as jobLetter from '../lib/job-letter.js';
import {me} from '../lib/server.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => v, decrypt: v => v};
const storageWithCv = () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-job-letter-')), fakeCrypto);
  fs.mkdirSync(storage.path('cv'), {recursive: true});
  fs.writeFileSync(storage.path('cv/cv.json'), JSON.stringify(CV));
  fs.writeFileSync(storage.path('cv.pdf'), '%PDF-base');
  return storage;
};
const CV = {name: 'Ada Example', location: 'Zurich', summary: 'SRE.', jobs: [{company: 'Acme', roles: [{title: 'SRE', period: '2024 – Present', place: 'Zurich', bullets: ['Cut costs by **50%**.']}]}]};
const JOB = {code: 'abc123', title: 'SRE', company: 'Kestrel', url: 'https://jobs.kestrel.test/sre', description: 'Run our platform.'};
const client = (letter, seen = []) => ({messages: {create: async request => { seen.push(request); return {stop_reason: 'end_turn', usage: {input_tokens: 1500, output_tokens: 300},
  content: [{type: 'text', text: JSON.stringify({letter})}]}; }}});

test('the kit\'s letter is used as it is: no AI call, no cost', async () => {
  const seen = [];
  const made = await jobLetter.draft(null, {job: JOB, cv: CV, kitLetter: 'Dear Hiring Team,\n\nI cut costs by 50%.', client: client('never', seen)});
  assert.deepEqual([made.source, made.usd, seen.length], ['kit', 0, 0]);
});

test('with no kit letter one AI call drafts it from the tailored CV and the posting, and records its tokens', async () => {
  const seen = [];
  const made = await jobLetter.draft(null, {job: JOB, cv: CV, profile: 'Remote SRE', answers: 'Direct', client: client('Dear Hiring Team,\n\nKestrel: I cut costs by 50% and 99 more.', seen)});
  assert.equal(made.source, 'ai');
  assert.deepEqual(made.tokens, {input: 1500, output: 300});
  assert.match(seen[0].messages[0].content, /Run our platform/);
  assert.match(seen[0].messages[0].content, /Cut costs/);
  assert.deepEqual(made.warnings.length, 1);   // 99 is in neither the CV nor the Profile
  assert.match(made.warnings[0], /99/);
});

test('feedback makes a new draft even when the kit has a letter', async () => {
  const seen = [];
  const made = await jobLetter.draft(null, {job: JOB, cv: CV, kitLetter: 'Old.', feedback: 'shorter', previous: 'Old.', client: client('Dear Hiring Team,\n\nShort.', seen)});
  assert.deepEqual([made.source, seen.length], ['ai', 1]);
  assert.match(seen[0].messages[0].content, /<previous_letter>/);
});

test('the PDF page is in the CV design: Inter, the CV\'s own style.css, the sender; the text is escaped', () => {
  const storage = storageWithCv();
  fs.writeFileSync(storage.path('cv/style.css'), '.name { color: #123456 }');
  const page = jobLetter.html(storage, 'Dear Team,\n\nI <3 uptime.', {full_name: 'Ada Example', email: 'ada@example.test'}, CV);
  assert.match(page, /font-family: Inter/);
  assert.match(page, /#123456/);
  assert.match(page, /ada@example\.test/);
  assert.match(page, /I &lt;3 uptime\./);
});

// A job's complete tailored letter wins; otherwise an approved usable base letter is the automatic fallback.
test('the extension prefers the tailored letter and automatically falls back to an approved base letter', async () => {
  const storage = storageWithCv();
  cv.save(storage, JOB.code, {job: JOB, cv: CV}, Buffer.from('%PDF-cv'));
  await letters.generate(storage, {client: client('Dear Hiring Team,\n\nGeneral.')});
  const read = file => Buffer.from(file.data, 'base64').toString();
  assert.equal((await me(storage, JOB.url)).coverLetterFile, null);   // an unapproved draft is never used
  assert.equal((await me(storage)).coverLetterFile, null);
  letters.approve(storage, Buffer.from('%PDF-general'));
  assert.equal(read((await me(storage, JOB.url)).coverLetterFile), '%PDF-general');   // tailored CV, no job letter yet
  jobLetter.save(storage, JOB.code, {job: JOB, text: 'Dear Hiring Team,\n\nKestrel.', source: 'ai'}, Buffer.from('%PDF-job'));
  const delivered = await me(storage, JOB.url);
  const file = delivered.coverLetterFile;
  assert.equal(delivered.coverLetterText, jobLetter.load(storage, JOB.code).text);
  assert.equal(delivered.coverLetterStatus.source, 'tailored');
  assert.equal(read(file), '%PDF-job');
  assert.match(file.name, /^Letter_Ada_Example_Kestrel\.pdf$/);
  assert.equal(read((await me(storage, 'https://jobs.other.test/x')).coverLetterFile), '%PDF-general');
  assert.equal(read((await me(storage)).coverLetterFile), '%PDF-general');
});

// A letter with a gap left to fill ("[Company]") never goes to a form (owner, 18 Oct 2026): a job's own falls back to the base letter, a base one to none.
test('a letter with an unfilled gap is never uploaded', async () => {
  const storage = storageWithCv();
  cv.save(storage, JOB.code, {job: JOB, cv: CV}, Buffer.from('%PDF-cv'));
  await letters.generate(storage, {client: client('Dear Hiring Team,\n\nGeneral.')});
  letters.approve(storage, Buffer.from('%PDF-general'));
  jobLetter.save(storage, JOB.code, {job: JOB, text: 'Dear [Hiring Manager],\n\nKestrel.', source: 'you'}, Buffer.from('%PDF-job'));
  assert.equal(Buffer.from((await me(storage, JOB.url)).coverLetterFile.data, 'base64').toString(), '%PDF-general');
  assert.equal(letters.hasGap('Dear {name},'), true);
  assert.equal(letters.hasGap('I <3 uptime and cut costs by 50% (2024).'), false);
});

// The owner's class rule: every place that names the tailor action says it makes the letter too (a new place without it fails here).
test('every name of the tailor action says cover letter', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const places = {
    'lib/pipeline-lines.js': /name: 'Tailor CV \+ cover letter'/, 'lib/run-history.js': /tailor: 'Tailor CV \+ cover letter'/,
    'renderer/pages/activity-basics.js': /name: 'Tailor CV \+ cover letter'/, 'renderer/pages/runs-page.js': /Tailor CV \+ cover letter for top matches/,
    'renderer/onboarding.js': /Tailor CV \+ cover letter for top matches/, 'renderer/index.html': /<b>Tailor CV \+ cover letter for top matches<\/b>/,
    'renderer/pages/jobs-render.js': /'Tailor CV \+ cover letter'/, 'renderer/pages/nav.js': /tailor: 'tailor cv cover letter/,
  };
  for (const [file, pattern] of Object.entries(places)) assert.match(fs.readFileSync(path.join(here, '..', file), 'utf8'), pattern, file);
});
