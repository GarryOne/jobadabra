import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as cv from '../lib/cv.js';
import {me} from '../lib/server.js';
import {createStorage} from '../lib/storage.js';
import {render, pages} from '../cv/template.js';

const fakeCrypto = {encrypt: v => v, decrypt: v => v};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-cv-')), fakeCrypto);

const BASE = {
  name: 'Ada Example', location: 'Zurich', summary: 'Engineer focused on reliability with AWS and Terraform.',
  links: [{text: 'ada@example.test', href: 'mailto:ada@example.test'}],
  jobs: [
    {company: 'Acme', roles: [{title: 'SRE', period: '2024 – Present', place: 'Zurich', bullets: [
      'Cut monitoring costs by **50%** with Datadog.',
      'Migrated 20 RDS clusters using blue/green strategies.',
      'Ran the incident process with Rootly.',
      'Wrote internal docs.',
      'Mentored two engineers.'], skills: 'AWS, Terraform, Datadog'}]},
    {company: 'Beta', roles: [{title: 'Developer', period: '2020 – 2023', place: 'Remote', bullets: ['Built APIs in Node.js.']}]},
  ],
};

const answer = overrides => ({
  summary: 'Engineer focused on incident response and reliability with AWS and Terraform.',
  jobs: [
    {company: 'Acme', roles: [{title: 'SRE', skills: 'Datadog, AWS, Terraform', bullets: [
      {source: 2, text: 'Ran incident management with Rootly.'},
      {source: 0, text: 'Cut monitoring costs by **50%** with Datadog.'},
      {source: 1, text: 'Migrated 20 RDS clusters using blue/green strategies.'},
      {source: 4, text: 'Mentored two engineers.'}]}]},
    {company: 'Beta', roles: [{title: 'Developer', skills: '', bullets: [{source: 0, text: 'Built APIs in Node.js.'}]}]},
  ],
  changes: [{where: 'Summary', change: 'Leads with incident response', why: 'The posting centres on incidents'}],
  ...overrides,
});

test('tailoring reorders, rewords and drops bullets, and marks each change for review', () => {
  const {cv: tailored, review, warnings} = cv.applyTailoring(BASE, answer());
  assert.deepEqual(warnings, []);
  assert.equal(tailored.jobs[0].roles[0].bullets[0], 'Ran incident management with Rootly.');
  assert.equal(tailored.jobs[0].roles[0].bullets.length, 4);
  assert.equal(tailored.jobs[0].roles[0].skills, 'Datadog, AWS, Terraform');
  assert.equal(tailored.jobs[0].roles[0].title, 'SRE');  // titles, dates, places come from the base CV
  assert.equal(tailored.jobs[0].roles[0].period, '2024 – Present');
  const marks = review.jobs[0].roles[0].bullets.map(b => b.mark);
  assert.deepEqual(marks, ['reworded', 'kept', 'kept', 'kept']);
  assert.match(review.jobs[0].roles[0].bullets[0].diff, /<ins>management<\/ins>/);
  const moved = answer();
  moved.jobs[0].roles[0].bullets = [1, 0, 2, 3, 4].map(source => ({source, text: BASE.jobs[0].roles[0].bullets[source]}));
  assert.deepEqual(cv.applyTailoring(BASE, moved).review.jobs[0].roles[0].bullets.map(b => b.mark), ['moved', 'kept', 'kept', 'kept', 'kept']);
  assert.deepEqual(review.jobs[0].roles[0].dropped, ['Wrote internal docs.']);
  assert.ok(review.summaryMark);
  assert.match(review.summaryDiff, /<ins>incident response and<\/ins>/);
  // Nothing changed about the base CV itself.
  assert.equal(BASE.jobs[0].roles[0].bullets[0], 'Cut monitoring costs by **50%** with Datadog.');
});

test('a reworded bullet that changes a number keeps the original wording', () => {
  const bad = answer();
  bad.jobs[0].roles[0].bullets[1] = {source: 0, text: 'Cut monitoring costs by **60%** with Datadog.'};
  const {cv: tailored, warnings} = cv.applyTailoring(BASE, bad);
  assert.equal(tailored.jobs[0].roles[0].bullets[1], 'Cut monitoring costs by **50%** with Datadog.');
  assert.match(warnings.join(), /changed a number/);
});

test('terms that appear nowhere in the CV or Profile are flagged, and the summary may not add numbers', () => {
  const invented = answer({summary: 'Engineer with 12 years of reliability work.'});
  invented.jobs[0].roles[0].bullets[0] = {source: 2, text: 'Ran incident management with PagerDuty and Rootly.'};
  const {cv: tailored, warnings} = cv.applyTailoring(BASE, invented);
  assert.equal(tailored.summary, BASE.summary);
  assert.match(warnings.join('\n'), /Summary: a new number/);
  assert.match(warnings.join('\n'), /new term "PagerDuty"/);
  const compound = answer();
  compound.jobs[0].roles[0].bullets[1] = {source: 0, text: 'Cut Datadog-based monitoring costs by **50%**.'};
  assert.deepEqual(cv.applyTailoring(BASE, compound).warnings, []);
  // Known from the Profile: no warning.
  assert.doesNotMatch(cv.applyTailoring(BASE, invented, 'Used PagerDuty at Acme').warnings.join('\n'), /PagerDuty/);
});

test('skills may only be reordered, at most 2 bullets dropped, and jobs never change', () => {
  const skills = answer();
  skills.jobs[0].roles[0].skills = 'AWS, Kubernetes';
  skills.jobs[0].roles[0].bullets = [{source: 0, text: 'Cut monitoring costs by **50%** with Datadog.'}];
  const {cv: tailored, warnings} = cv.applyTailoring(BASE, skills);
  assert.equal(tailored.jobs[0].roles[0].skills, 'AWS, Terraform, Datadog');
  assert.equal(tailored.jobs[0].roles[0].bullets.length, 3);  // 5 bullets, 2 may go
  assert.match(warnings.join('\n'), /skills line changed/);
  assert.match(warnings.join('\n'), /4 bullets were left out/);
  assert.throws(() => cv.applyTailoring(BASE, answer({jobs: [answer().jobs[0]]})), /list of jobs/);
  const renamed = answer();
  renamed.jobs[1].company = 'Gamma';
  assert.throws(() => cv.applyTailoring(BASE, renamed), /changed the jobs/);
});

test('word diff marks removed and added words', () => {
  assert.equal(cv.wordDiff('Ran the incident process', 'Ran the incident management process'),
    'Ran the incident <ins>management</ins> process');
  assert.equal(cv.wordDiff('a b c', 'a c'), 'a <del>b</del> c');
  assert.equal(cv.wordDiff('cut costs by **50%** fast', 'cut costs by **50%** quickly'), 'cut costs by <b>50%</b> <del>fast</del> <ins>quickly</ins>');
  assert.match(cv.wordDiff('one two three four', 'five six seven eight'), /^five six seven eight<span class="before">Before: one two three four<\/span>$/);
});

test('the template flows by default and uses fixed pages for a custom layout', () => {
  const html = render(BASE);
  assert.match(html, /class="page  flow"/);
  assert.match(html, /<b>50%<\/b>/);
  assert.match(html, /Inter/);
  const custom = {...BASE, layout: {pages: [{class: 'first'}, {class: 'contract', banner: 'b.png'}]},
    jobs: [{...BASE.jobs[0], page: 0}, {...BASE.jobs[1], page: 1}]};
  assert.deepEqual(pages(custom).map(p => p.jobs.map(j => j.company)), [['Acme'], ['Beta']]);
  const fixed = render(custom, {style: '.x{}'});
  assert.match(fixed, /class="page fixed first"/);
  assert.match(fixed, /class="banner" src="assets\/b.png"/);
  assert.doesNotMatch(fixed, /One clean column/);  // the user's style replaces the default one
  const {review} = cv.applyTailoring(BASE, answer());
  const marked = render(review, {review: true});
  assert.match(marked, /class="mark-reworded"/);
  assert.match(marked, /class="mark-dropped"/);
});

test('the extension gets the tailored CV on that job\'s page and the base CV elsewhere', async () => {
  const storage = tempStorage();
  fs.writeFileSync(storage.path('cv.pdf'), 'BASE');
  const {cv: tailored, review} = cv.applyTailoring(BASE, answer());
  cv.save(storage, 'ab12cd34', {job: {code: 'ab12cd34', url: 'https://boards.example/jobs/1', title: 'SRE', company: 'Acme'},
    createdAt: new Date().toISOString(), model: cv.MODEL, usd: 0.05, changes: [], warnings: [], cv: tailored, review}, Buffer.from('TAILORED'));
  assert.ok(cv.exists(storage, 'ab12cd34'));
  assert.equal(cv.forUrl(storage, 'https://boards.example/jobs/1/#jobpilotto-fill').job.code, 'ab12cd34');
  // The form of a posting lives at another address (Ashby: <posting>/application): the tailored CV is still the one attached.
  cv.save(storage, 'aa11bb22', {job: {code: 'aa11bb22', url: 'https://jobs.ashbyhq.com/openai/621bb104-9daa-4c9e-949a-03d5730334e8', title: 'SE', company: 'OpenAI'},
    createdAt: new Date().toISOString(), model: cv.MODEL, usd: 0.05, changes: [], warnings: [], cv: tailored, review}, Buffer.from('FOR OPENAI'));
  assert.equal(cv.forUrl(storage, 'https://jobs.ashbyhq.com/openai/621bb104-9daa-4c9e-949a-03d5730334e8/application#jobpilotto-fill').job.code, 'aa11bb22');
  assert.equal(cv.forUrl(storage, 'https://jobs.ashbyhq.com/openai/aaaaaaaa-9daa-4c9e-949a-03d5730334e8/application'), null, 'another posting at the same company is not this job');
  const onJob = await me(storage, 'https://boards.example/jobs/1');
  assert.equal(Buffer.from(onJob.resume.data, 'base64').toString(), 'TAILORED');
  assert.equal(onJob.resume.tailored, true);
  assert.match(onJob.resume.name, /^CV_.*Acme\.pdf$/, 'the form shows the tailored CV\'s own name, not the base CV\'s');
  assert.equal(Buffer.from((await me(storage, 'https://other.example/jobs/2')).resume.data, 'base64').toString(), 'BASE');
  assert.equal(Buffer.from((await me(storage)).resume.data, 'base64').toString(), 'BASE');
  // A job from a LinkedIn chat has no posting link: the employer's form is found by the company's name in its address.
  cv.save(storage, 'cc00dd11', {job: {code: 'cc00dd11', url: 'https://www.linkedin.com/messaging/#jp-abc', title: 'Principal SRE', company: 'Kestrel Agency'},
    createdAt: new Date().toISOString(), model: cv.MODEL, usd: 0.05, changes: [], warnings: [], cv: tailored, review}, Buffer.from('FOR KESTREL'));
  assert.equal(cv.forUrl(storage, 'https://careers.kestrelagency.com/apply/42').job.code, 'cc00dd11');
  assert.equal(cv.forUrl(storage, 'https://careers.unrelated.com/apply/42'), null);
  cv.save(storage, 'ee22ff33', {job: {code: 'ee22ff33', url: 'https://mail.google.com/mail/u/0/#all/xyz', title: 'Staff SRE', company: 'Kestrel Agency'},
    createdAt: new Date().toISOString(), model: cv.MODEL, usd: 0.05, changes: [], warnings: [], cv: tailored, review}, Buffer.from('ANOTHER'));
  assert.equal(cv.forUrl(storage, 'https://careers.kestrelagency.com/apply/42'), null, 'two tailored CVs for one employer: the base CV, not a guess');
  // What the extension is handed on that employer's form (GET /extension/me): the chat job's tailored CV while it is the only one, the base CV after.
  fs.rmSync(path.join(cv.dir(storage), 'tailored', 'ee22ff33.json'));
  const forForm = await me(storage, 'https://careers.kestrelagency.com/apply/42');
  assert.equal(Buffer.from(forForm.resume.data, 'base64').toString(), 'FOR KESTREL');
  assert.equal(forForm.resume.tailored, true);
  const page = fs.readFileSync(cv.reviewPage(storage, cv.load(storage, 'ab12cd34')), 'utf8');
  assert.match(page, /What changed and why/);
  assert.match(page, /Hide highlights/);
  // The clean PDF has a name to send, and the window says which is the final CV and which only previews the changes.
  assert.match(page, /Final CV: send this one/);
  assert.match(page, /Preview of changes/);
  assert.match(page, /jobadabra-cv:reveal/);
  const finalPdf = cv.finalCopy(storage, cv.load(storage, 'ab12cd34'));
  assert.match(path.basename(finalPdf), /^CV_.*Acme\.pdf$/);
  assert.equal(fs.readFileSync(finalPdf, 'utf8'), 'TAILORED');
});
