import assert from 'node:assert/strict';
import {test} from 'node:test';
import {confirmsJob, jobId, judgePage, pageBrief, reportedConfirmations} from '../lib/confirmation.js';
import {judgeConfirmation, markReportedConfirmations} from '../lib/server.js';

const JOB = 'https://job-boards.greenhouse.io/anthropic/jobs/5114768008';
const CONFIRM = `${JOB}/confirmation`;

test('a Greenhouse confirmation is this job, including a query on the posting', () => {
  assert.equal(jobId(JOB), '5114768008');
  assert.equal(jobId(`${JOB}?gh_src=abc`), '5114768008');
  assert.equal(jobId(`${JOB}/application`), '5114768008');
  assert.equal(confirmsJob(CONFIRM, JOB), true);
  assert.equal(confirmsJob(`${CONFIRM}?submitted=1`, `${JOB}?gh_src=abc`), true);
  assert.equal(confirmsJob('https://jobs.lever.co/acme/abc/thanks', 'https://jobs.lever.co/acme/abc'), true);
});

test('the open form, another role, and a thank-you page are not a submission', () => {
  assert.equal(confirmsJob(JOB, JOB), false);
  assert.equal(confirmsJob('https://job-boards.greenhouse.io/anthropic/jobs/5002072/confirmation', JOB), false);
  assert.equal(confirmsJob('https://www.google.com/search?q=thank+you+for+applying', JOB), false);
  assert.equal(confirmsJob('https://example.com/5114768008/confirmation', JOB), false);
  assert.equal(confirmsJob('', JOB), false);
});

test('a confirmation-shaped address is only logged: it does not mark the job', async () => {
  const calls = [];
  const session = {url: JOB, company: 'Anthropic', outcome: ''};
  await markReportedConfirmations({}, [CONFIRM], {
    setStatus: async (_storage, job, status) => { calls.push([job, status]); return {ok: true}; },
    submitted: job => { session.outcome = 'submitted'; calls.push(['submitted', job]); },
    sessions: () => [session],
    log: () => {},
  });
  assert.deepEqual(calls, []);
  assert.equal(session.outcome, '');
});

test('a reported confirmation page is logged once, matched or not', async () => {
  const lines = [];
  const orphan = 'https://job-boards.greenhouse.io/acme/jobs/42/thanks?token=secret';
  assert.deepEqual(reportedConfirmations([orphan, JOB], []), [
    {host: 'job-boards.greenhouse.io', id: '42', path: 'thanks', matched: false},
  ]);
  await markReportedConfirmations({}, [orphan, orphan], {
    setStatus: async () => ({ok: true}), submitted: () => {}, sessions: () => [], log: (area, message, fields) => lines.push([area, message, fields]),
  });
  await markReportedConfirmations({}, [orphan], {
    setStatus: async () => ({ok: true}), submitted: () => {}, sessions: () => [], log: (area, message, fields) => lines.push([area, message, fields]),
  });
  assert.deepEqual(lines, [['extension', 'confirmation-shaped page reported, no open session: not marked',
    {host: 'job-boards.greenhouse.io', id: '42', path: 'thanks'}]]);
  assert.equal(JSON.stringify(lines).includes('secret'), false);
});

test('the page sent to the model drops the query string', () => {
  const brief = pageBrief({url: 'https://jobs.example/apply/done?token=secret', title: 'Thanks', headings: ['Received'], text: 'We received your application', inputs: 0});
  assert.equal(brief.host, 'jobs.example');
  assert.equal(brief.path, '/apply/done');
  assert.equal(JSON.stringify(brief).includes('secret'), false);
});

test('the read is a confirmation only when the model says so, and an empty or failed read is not', async () => {
  assert.equal((await judgePage(null, {url: 'https://jobs.example/a', title: 'Thanks', text: 'Received'})).error, 'no AI');
  let called = false;
  const quiet = {messages: {create: async () => { called = true; return {}; }}};
  assert.equal((await judgePage(quiet, {url: 'https://jobs.example/a'})).error, 'empty page');
  assert.equal(called, false);
  const no = {messages: {create: async () => ({content: [{type: 'text', text: '{"confirmation":false}'}], usage: {}})}};
  assert.equal((await judgePage(no, {title: 'Apply', text: 'First name', inputs: 6})).confirmation, false);
  let prompt = '';
  const yes = {messages: {create: async ({messages}) => { prompt = messages[0].content; return {content: [{type: 'text', text: '{"confirmation":true}'}], usage: {input_tokens: 10, output_tokens: 4}}; }}};
  const verdict = await judgePage(yes, {url: 'https://jobs.example/apply/done?token=secret', title: 'Thanks', headings: ['Received'], text: 'We received your application', inputs: 0});
  assert.equal(verdict.confirmation, true);
  assert.equal(prompt.includes('secret'), false);
  const broken = {messages: {create: async () => { throw new Error('offline'); }}};
  assert.equal((await judgePage(broken, {title: 'Thanks', text: 'Received'})).confirmation, false);
});

test('a yes marks the job and a no does not', async () => {
  const marks = [];
  const yes = await judgeConfirmation({}, {job: JOB, page: CONFIRM, title: 'Thanks', text: 'Received'}, {
    client: null,
    judge: async () => ({confirmation: true, host: 'job-boards.greenhouse.io', path: '/jobs/5114768008/confirmation', inputs: 0}),
    mark: async url => { marks.push(url); return {ok: true, message: 'ok'}; },
  });
  assert.equal(yes.ok, true);
  assert.equal(yes.confirmation, true);
  assert.deepEqual(marks, [JOB]);
  const no = await judgeConfirmation({}, {job: JOB, page: JOB, title: 'Apply', text: 'First name'}, {
    client: null,
    judge: async () => ({confirmation: false, host: 'job-boards.greenhouse.io', path: '/jobs/5114768008', inputs: 8}),
    mark: async url => { marks.push(url); return {ok: true}; },
  });
  assert.equal(no.confirmation, false);
  assert.deepEqual(marks, [JOB]);
});

test('actual challenge evidence overrides a contradictory receipt answer and hands off without marking Applied', async () => {
  const client = {messages: {create: async () => ({content: [{type: 'text', text: '{"confirmation":true,"bot_check":true}'}]})}};
  const judged = await judgePage(client, {url: 'https://jobs.example.test/result', title: 'Check', text: 'Human verification challenge'});
  assert.equal(judged.botCheck, true);
  assert.equal(judged.confirmation, false);
  const handed = [], marked = [];
  const verdict = await judgeConfirmation({}, {job: 'https://jobs.example.test/app', page: 'https://jobs.example.test/result', title: 'Check', background: {session: 'fictional', owner: 'owned'}}, {
    client: null, judge: async () => judged, mark: async url => { marked.push(url); return {ok: true}; },
    background: {handle: async payload => { handed.push(payload); return {ok: true}; }},
  });
  assert.equal(verdict.manual, true);
  assert.equal(handed[0].reason, 'captcha_runtime');
  assert.deepEqual(marked, []);
});

// Applied for a background job comes only from a page the judge reads as the site's confirmation (spec 2026-10-27 "Applied only from a receipt"); the hand-off after the watcher's last read is the extension's, not this route's.
test('a background job is marked Applied only after the judge reads the page as a confirmation', async () => {
  const run = async verdict => {
    const receipts = [], marked = [];
    const answer = await judgeConfirmation({}, {job: 'https://jobs.example.test/app', page: 'https://jobs.example.test/result', background: {session: 'fictional', owner: 'owned'}}, {
      client: null, judge: async () => verdict, mark: async url => { marked.push(url); return {ok: true}; },
      background: {outcome: async (context, confirmed) => { receipts.push(confirmed); return {ok: true}; }, handle: async () => ({ok: true})},
    });
    return {answer, receipts, marked};
  };
  const no = await run({confirmation: false, botCheck: false, host: 'jobs.example.test', path: '/result'});
  assert.deepEqual([no.receipts, no.marked, no.answer.confirmation], [[], [], false]);
  const unread = await run({confirmation: false, error: 'AI busy'});
  assert.deepEqual([unread.receipts, unread.marked], [[], []]);
  const yes = await run({confirmation: true, botCheck: false, host: 'jobs.example.test', path: '/result'});
  assert.deepEqual([yes.receipts, yes.marked.length, yes.answer.confirmation], [[true], 1, true]);
});
