// The engine writes each task's message; the window reads it back from the run's Notion page (cron_runs.plain flattens it). Two copies
// of one format drift: on 5 Oct 2026 weekly_message moved to the plain layout (src/tgcard.py) and parseWeekly still wanted emoji headings,
// so the Search analysis card ran its sections together. test/fixtures/engine_messages.py runs the engine's OWN writers (no copy of
// their text here); each card's parser must read what they write. A new card kind = a new line in that fixture and a test here.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {parseWeekly} from '../renderer/weekly-card.js';
import {parseInsight} from '../renderer/insight-card.js';
import {parseKitsReady} from '../renderer/kits-ready.js';
import {parseInterviewReview} from '../renderer/interview-review.js';
import {reviewParts} from '../renderer/interview-review-view.js';
import {mailResults, parseMailReport} from '../renderer/mail-report.js';
import {parseRunMessage} from '../renderer/run-cards.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Windows has `python`, not `python3`; its console code page cannot print the engine's text: UTF-8 on (as lib/pipeline.js runs the engine).
const python = process.env.JOBADABRA_CHECK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const run = spawnSync(python, [path.join(here, 'fixtures/engine_messages.py')], {cwd: path.join(here, '../..'), encoding: 'utf8', env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'}});
assert.equal(run.status, 0, run.stderr);
const said = JSON.parse(run.stdout);
const lookAt = name => `${name}: ${JSON.stringify(said[name])}`;

test('weekly: headline, finding, summary, worked, change, focus', () => {
  const weekly = parseWeekly(said.weekly);
  assert.ok(weekly, lookAt('weekly'));
  assert.deepEqual([weekly.headline, weekly.finding, weekly.summary, weekly.worked, weekly.change, weekly.focus],
    ['Quiet week: 2 applications', 'Replies came from fresh jobs', 'You sent 2 applications.', ['Recruiter channel: 5 of 5'], ['Send the drafted kits', 'Log salary answers'], 'Send kits scored 60+']);
});

test('insight: category, headline, evidence, next step, confidence', () => {
  const insight = parseInsight(said.insight);
  assert.ok(insight, lookAt('insight'));
  assert.deepEqual([insight.category, insight.headline, insight.evidence, insight.action, insight.confidence, insight.sample],
    ['Skills', 'Go appears in 40% of roles', ['9 of 12 postings'], 'Add Go to your CV', 'medium', 12]);
});

test('tailored CVs: the same card shape as kits, from the message the app writes', () => {
  const message = '✂️ Tailored CVs ready\n2 of 3 tailored · 1 failed · check each before you apply\n\nSRE (https://jobs.example.com/1)\nAcme\n\nOps (https://jobs.example.com/2)\nBeta';
  const cvs = parseKitsReady(message);
  assert.equal(cvs.what, 'cv');
  assert.deepEqual(cvs.jobs.map(job => [job.title, job.company, job.url]), [['SRE', 'Acme', 'https://jobs.example.com/1'], ['Ops', 'Beta', 'https://jobs.example.com/2']]);
  assert.match(cvs.subtitle, /2 of 3 tailored/);
  assert.equal(parseKitsReady('📝 Application kits ready\n1 drafted\n\nSRE (https://a/1)\nAcme').what, 'kit');
});

test('kits: the count line and each job with its link and company', () => {
  const kits = parseKitsReady(said.kits);
  assert.ok(kits, lookAt('kits'));
  assert.deepEqual(kits.jobs.map(job => [job.title, job.company, job.url]),
    [['Site Reliability Engineer', 'DeepJudge AG', 'https://jobs.example.com/1'], ['Senior SRE (x/f/m)', 'Doctolib', 'https://jobs.example.com/2']]);
});

test('interview review: round, job, summary, sections, next step, stage', () => {
  const review = parseInterviewReview(said.interview);
  assert.ok(review, lookAt('interview'));
  assert.equal(review.round, 'Recruiter screen');
  assert.match(review.title, /Huxley/);
  assert.match(review.summary, /first call/);
  assert.deepEqual(review.sections.map(section => section.label.replace(/\s*\(.*/, '')), ['Strong', 'Weak answers', 'Practise']);
  assert.match(review.next, /updated CV/);
  assert.match(review.stage, /Interview scheduled/);
});

test('Find new employers: the counts and the source found', () => {
  const scout = parseRunMessage(said.scout);
  assert.ok(scout && scout.kind === 'scout', lookAt('scout'));
  assert.deepEqual([scout.checked, scout.first, scout.again, scout.againWhy, scout.left, scout.fresh, scout.items.map(item => item.company)], [15, 12, 3, 'no new names left', 52, 1, ['Acme']]);
});

test('job digest: the new count, the open count and the job listed', () => {
  const digest = parseRunMessage(said.digest);
  assert.ok(digest && digest.kind === 'digest', lookAt('digest'));
  assert.equal(digest.items[0]?.title, 'Site Reliability Engineer');
  assert.equal(digest.items[0]?.company, 'Acme');
});

test('Gmail check: the interview prep message reads as the interview card, not loose notes', () => {
  const mail = parseMailReport(said.mail_prep, 'Gmail check: 1 new email(s) read, 0 update(s) recorded', []);
  assert.ok(mail?.interview, lookAt('mail_prep'));
  assert.match(`${mail.interview.company} ${mail.interview.title}`, /Huxley.*Principal SRE/);
  assert.deepEqual(mail.topics, ['Salary expectations']);
  assert.match(mail.nextSteps.join(' '), /updated CV/);
  assert.equal(mail.url, 'https://app.notion.com/p/app');
});

test('Gmail check: the updates message and the "no new emails" message give no raw headings as notes', () => {
  for (const name of ['mail_updates', 'mail_none']) {
    const mail = parseMailReport(said[name], 'Gmail check: 0 new email(s) read, 0 update(s) recorded', []);
    assert.ok(mail, lookAt(name));
    const loose = mail.notes.map(note => note.text).filter(text => /^(Job emails & calendar|Gmail checked)\b/.test(text) && text.length > 40);
    assert.deepEqual(loose, [], lookAt(name));
  }
});

test('Gmail check: a rejection reads as the job\'s update and the AI\'s assessment, not loose notes', () => {
  const mail = parseMailReport(said.mail_rejected, 'Gmail check: 1 new email(s) read, 2 update(s) recorded', []);
  assert.ok(mail, lookAt('mail_rejected'));
  assert.deepEqual(mail.notes, [], lookAt('mail_rejected'));
  const [result] = mailResults(mail).results;
  assert.deepEqual([result.company, result.role, result.outcome.kind, result.outcome.summary],
    ['Huxley', 'Principal SRE', 'Rejected', 'Application rejected after consideration'], lookAt('mail_rejected'));
  assert.deepEqual([result.assessment.verdict, result.assessment.confidence, result.assessment.background],
    ['Hard skills', 'medium', 'SRE/platform.'], lookAt('mail_rejected'));
});

test('Gmail check: a newly recorded interview is an update on its job, not the interview reminder', () => {
  const mail = parseMailReport(said.mail_updates, 'Gmail check: 1 new email(s) read, 1 update(s) recorded', []);
  assert.equal(mail.interview, null, lookAt('mail_updates'));
  assert.deepEqual(mail.outcomes.map(o => [o.company, o.role, o.kind]), [['Huxley', 'Principal SRE', 'Interview']], lookAt('mail_updates'));
  assert.deepEqual(mail.notes, [], lookAt('mail_updates'));
});

// 7 Oct 2026: "N new to the search" was added to the scout card's second line (3c45aa3) and the app's own summary pattern (lib/pipeline.js TASKS.scout)
// stopped matching it: a run on this Mac had no result until its Notion row was read (the Windows employers suite read "" for the second run).
test('scout: the app\'s run summary reads the line the engine writes', async () => {
  const {taskSummary} = await import('../lib/pipeline.js');
  assert.equal(taskSummary('scout', said.scout.split('\n')), said.scout.split('\n')[1], lookAt('scout'));
});

test('an interview review as the store keeps it: every question with its verdict, the call facts with their job marks', () => {
  const parts = reviewParts({title: 'Huxley · Recruiter screen', review: said.interview_review});
  assert.deepEqual(parts.questions.map(q => [q.verdict, q.tone, q.topic, q.question, q.answer, q.better]), [
    ['Strong', 'good', 'On-call', 'Tell me about an incident', 'The DNS outage', ''],
    ['Weak', 'warn', 'Kafka', 'How do you size partitions?', 'By throughput', 'Name the consumer count'],
    ['Not answered', 'bad', 'Go', 'Have you shipped Go?', '', 'Say what you would learn first']], lookAt('interview_review'));
  assert.deepEqual(parts.callFacts.map(fact => [fact.mark, fact.current]), [['added', ''], ['differs', 'Basel']]);
  assert.match(parts.callFacts[0].text, /^Your ask: CHF 140k/);
  assert.equal(parts.callFacts[1].text, 'Location: Zürich');
  // Every other section of the page is still a group, in the page's order; the two structured ones are not repeated as plain lines.
  assert.deepEqual(parts.groups.map(g => g.title), ['Review', 'Strengths', 'Weak spots', 'Signals from them', 'Could count against you', 'Practise before the next round']);
});
