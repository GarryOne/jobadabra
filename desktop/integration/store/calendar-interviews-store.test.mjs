// Layer 3 (Node + the engine's real SQLite store in a temp folder, no window): the dummy meetings, jobs and interviews that the calendar and interviews e2e suites write are
// written and read back whole. Covers the data half of these e2e steps (the screens that show them are layer 2):
//   - calendar: "this suite writes its dummy meetings to the store"
//   - interviews: "this suite starts from its own dummy jobs and interviews in the store" and "the app reads the new jobs"
// Dates come from lib/interview-data.mjs at a fixed instant (the suites pass `new Date()`; test/interview-data.test.mjs sweeps the year), so nothing here reads the clock.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {TRANSCRIPT, addDays, calendarDates, meetingSlots} from '../../e2e/lib/interview-data.mjs';
import {addInterview, addTrackedJob} from '../../e2e/lib/seed-data.mjs';
import {storeCall} from '../../e2e/lib/store-call.mjs';

const NOW = new Date('2026-11-01T10:00:00Z');
const open = () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cal-iv-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({store: 'sqlite'}));
  const ctx = {profile, store: 'sqlite', token: ''};
  return {...ctx, data: (entity, method, kwargs) => storeCall(ctx, entity, method, kwargs)};
};
const sameId = (a, b) => String(a || '').replace(/-/g, '') === String(b || '').replace(/-/g, '');

test('calendar: six meetings on three days (four on one), a held recording of the first job and an old call with no job are written and read back', async () => {
  const ctx = open();
  const dates = calendarDates(NOW), {days: [, l2, l3], oldDay} = dates, slots = meetingSlots(dates);
  const meetings = [['acme', 'E2E Acme', 'Senior SRE', 'Screening'], ['beta', 'E2E Beta', 'Platform Engineer', 'Interviewing'], ['gamma', 'E2E Gamma', 'Staff SRE', 'Interviewing'],
    ['delta', 'E2E Delta', 'DevOps Engineer', 'Interviewing'], ['zeta', 'E2E Zeta', 'Cloud Engineer', 'Interviewing'], ['epsilon', 'E2E Epsilon', 'Infrastructure Engineer', 'Interviewing']];
  const seed = {};
  for (const [key, company, role, stage] of meetings) seed[key] = await addTrackedJob(ctx, {role, company, url: `https://boards.e2e.test/cal/${key}`, stage, nextInterview: slots[key].at});
  const held = await addInterview(ctx, {name: 'E2E Acme · Recruiter screen', day: l3, round: 'Recruiter screen', overall: 'positive', applicationId: seed.acme.id});
  const old = await addInterview(ctx, {name: 'E2E Old call', day: oldDay, round: 'Call'});

  const jobs = await ctx.data('applications', 'list', {});
  assert.equal(jobs.length, 6, `the store lists ${jobs.length} jobs, not the six meetings`);
  for (const [key, company, role, stage] of meetings) {
    const job = jobs.find(item => item.url === `https://boards.e2e.test/cal/${key}`);
    assert.ok(job, `${company}'s job is missing`);
    assert.deepEqual([job.company, job.title, job.stage], [company, role, stage]);
    assert.equal(Date.parse(job.next_interview), Date.parse(slots[key].at), `${company}'s next interview reads back as ${job.next_interview}, written ${slots[key].at}`);
  }
  assert.equal(jobs.filter(job => Date.parse(job.next_interview) >= Date.parse(`${l2}T00:00:00Z`) && Date.parse(job.next_interview) < Date.parse(`${addDays(l2, 1)}T00:00:00Z`)).length, 4,
    'four meetings on the busy day');
  const iv = await ctx.data('interviews', 'list', {});
  assert.equal(iv.length, 2);
  const heldBack = await ctx.data('interviews', 'get', {interview_id: held.id}), oldBack = await ctx.data('interviews', 'get', {interview_id: old.id});
  assert.ok(sameId(heldBack.app_id, seed.acme.id), 'the held recording is linked to the Acme job');
  assert.equal(heldBack.overall, 'positive');
  assert.ok(!oldBack.app_id, 'the old call has no job');
  assert.match(String(oldBack.at), new RegExp(`^${oldDay}`));
});

test('interviews: three jobs and four interviews (three reviewed with different outcomes, one not) are written, read back whole, and the jobs list holds the three', async () => {
  const ctx = open();
  const today = '2026-11-01', seed = {};
  for (const [key, role, company, n] of [['acme', 'Senior Site Reliability Engineer', 'E2E Acme', 9001], ['beta', 'Platform Engineer', 'E2E Beta', 9002], ['gamma', 'Senior Site Reliability Engineer', 'E2E Gamma', 9003]]) {
    const url = `https://boards.e2e.test/job/${n}`;
    seed[key] = {...(await addTrackedJob(ctx, {role, company, url})), url, company, role};
  }
  const review = text => `${text}\n\n### Strengths\n\n- SEED strength: clear incident handling\n\n### Questions\n\n- ✅ [Incidents] How do you handle an unclear root cause? — rollback, then timeline\n`;
  const make = async (key, fields, withReview) => { seed[key] = {...(seed[key] || {}), ...(await addInterview(ctx, {...fields, transcript: TRANSCRIPT, ...(withReview ? {review: review(`SEED summary ${key}`)} : {})})), day: fields.day}; };
  await make('ivPositive', {name: 'E2E Acme · Round 1', day: addDays(today, -10), round: 'Recruiter screen', overall: 'positive', nextStep: 'Technical interview', applicationId: seed.acme.id}, true);
  await make('ivNeutral', {name: 'E2E Beta · Round 2', day: addDays(today, -6), round: 'Technical', overall: 'neutral', nextStep: 'Wait for feedback', applicationId: seed.beta.id}, true);
  await make('ivNegative', {name: 'E2E Loose · Round 1', day: addDays(today, -3), round: 'Hiring manager', overall: 'negative'}, true);
  await make('ivFresh', {name: 'E2E Gamma · Not reviewed yet', day: addDays(today, -1), round: 'Call', applicationId: seed.gamma.id}, false);

  assert.equal((await ctx.data('applications', 'list', {})).length, 3, 'the store lists the three jobs');
  const list = await ctx.data('interviews', 'list', {});
  assert.equal(list.length, 4);
  const byTitle = title => list.find(item => item.title === title);
  const order = list.map(item => seed[Object.keys(seed).find(key => seed[key].id === item.id)]?.day);
  // The store lists them oldest first; the library page sorts newest first (a screen check, layer 2): here every date is read back as written.
  assert.deepEqual([...order].sort(), [-10, -6, -3, -1].map(n => addDays(today, n)));
  assert.deepEqual(['E2E Acme · Round 1', 'E2E Beta · Round 2', 'E2E Loose · Round 1'].map(title => byTitle(title).overall), ['positive', 'neutral', 'negative']);
  assert.ok(!byTitle('E2E Gamma · Not reviewed yet').overall, 'the fresh interview has an outcome');
  for (const key of ['ivPositive', 'ivNeutral', 'ivNegative', 'ivFresh']) {
    const full = await ctx.data('interviews', 'get', {interview_id: seed[key].id});
    assert.match(full.transcript, /Recruiter: Thanks for making time/);
    if (key === 'ivFresh') assert.ok(!full.review, 'the fresh interview has a review'); else assert.match(full.review, new RegExp(`SEED summary ${key}[\\s\\S]*### Strengths[\\s\\S]*### Questions`));
  }
  assert.ok(sameId((await ctx.data('interviews', 'get', {interview_id: seed.ivPositive.id})).app_id, seed.acme.id), 'the Acme interview is linked to the Acme job');
  assert.ok(!(await ctx.data('interviews', 'get', {interview_id: seed.ivNegative.id})).app_id, 'the loose interview has a job');
});
