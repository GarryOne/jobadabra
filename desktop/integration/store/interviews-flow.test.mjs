// Layer 3 (Node + the real engine + a temp store, no window): what the Interviews page WRITES through the app's own module (lib/interviews.js), with the engine's real review and the e2e stored
// AI answers (e2e/fixtures/golden/ai-answers.json, suite interviews). Moved from the e2e `interviews` suite (1 Nov 2026, R2): a transcript that fails to review leaves one saved row, a
// transcript imported and reviewed for real, Review again on an older review, Refresh insights without a new review. Link/unlink (journey J18) and Delete are
// here too; nothing of Interviews stays in e2e (owner, 1 Nov 2026: only Tier 1 journeys are e2e). The window side of all of them, and the setup banner, is screen-interviews.test.js. Data comes from the store's own commands (kit.data), never hand-written rows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {TRANSCRIPT, addDays} from '../../e2e/lib/interview-data.mjs';
import {addInterview, addTrackedJob} from '../../e2e/lib/seed-data.mjs';
import {startEngineKit} from './engine-kit.mjs';

let kit, interviews;
const seed = {};
const sameId = (a, b) => String(a || '').replace(/-/g, '') === String(b || '').replace(/-/g, '');
const headingsOf = markdown => String(markdown || '').split('\n').map(line => /^#{1,4}\s+(.+?)\s*$/.exec(line)?.[1]).filter(Boolean);
const interviewOf = id => kit.data('interviews', 'get', {interview_id: id});
const allInterviews = async () => (await kit.data('interviews', 'list', {})) || [];

/** The page's "Save & review" on a transcript file: the draft (interviews.add), its title and job (saveDraft), then the save into the store and the review of the saved row. */
async function importAndReview(name, jobUrl) {
  const file = path.join(kit.profile, `${name}.txt`);
  fs.writeFileSync(file, TRANSCRIPT);
  const draft = interviews.add(kit.storage, file);
  assert.equal(draft.status, 'ready', 'a transcript file should be a ready draft');
  interviews.saveDraft(kit.storage, draft.id, {title: name, jobUrl});
  const saved = await interviews.save(kit.storage, draft.id);
  assert.ok(saved.ok, `the transcript was not saved: ${JSON.stringify(saved)}`);
  return {id: saved.id, review: () => interviews.review(kit.storage, saved.id)};
}

before(async () => {
  kit = await startEngineKit({answers: 'interviews'});
  interviews = await import('../../lib/interviews.js');
  const today = new Date().toISOString().slice(0, 10);
  for (const [key, role, company, n] of [['acme', 'Senior Site Reliability Engineer', 'E2E Acme', 9001], ['beta', 'Platform Engineer', 'E2E Beta', 9002], ['gamma', 'Senior Site Reliability Engineer', 'E2E Gamma', 9003]]) {
    const url = `https://boards.e2e.test/job/${n}`;
    seed[key] = {...(await addTrackedJob(kit, {role, company, url})), url};
  }
  const review = text => `${text}\n\n### Strengths\n\n- SEED strength: clear incident handling\n\n### Questions\n\n- ✅ [Incidents] How do you handle an unclear root cause? — rollback, then timeline\n`;
  const make = async (key, fields, withReview) => { seed[key] = await addInterview(kit, {...fields, transcript: TRANSCRIPT, ...(withReview ? {review: review(`SEED summary ${key}`)} : {})}); };
  await make('ivPositive', {name: 'E2E Acme · Round 1', day: addDays(today, -10), round: 'Recruiter screen', overall: 'positive', nextStep: 'Technical interview', applicationId: seed.acme.id}, true);
  await make('ivNegative', {name: 'E2E Loose · Round 1', day: addDays(today, -3), round: 'Hiring manager', overall: 'negative'}, true);
});
after(async () => { await kit?.close(); });

test('an interview can be linked to a job and unlinked again, and the store follows', async () => {
  const linked = await interviews.link(kit.storage, seed.ivNegative.id, seed.beta.url);
  assert.ok(linked.ok, `link failed: ${JSON.stringify(linked)}`);
  assert.ok(sameId((await interviewOf(seed.ivNegative.id)).app_id, seed.beta.id), 'the store does not link the interview to the Beta job');
  const unlinked = await interviews.link(kit.storage, seed.ivNegative.id, '');
  assert.ok(unlinked.ok, `unlink failed: ${JSON.stringify(unlinked)}`);
  assert.ok(!(await interviewOf(seed.ivNegative.id)).app_id, 'the store still links the interview to a job after it was unlinked');
});

test('a transcript that fails to review leaves one saved row, not reviewed, and a clear message', async () => {
  const before = (await allInterviews()).length;
  const item = await importAndReview('recruiter-call-failing', seed.gamma.url);
  const fault = kit.proxy.setMode('no-credit');
  const calls = kit.proxy.stats.calls;
  let result;
  try { result = await item.review(); } finally { kit.proxy.setMode('pass'); }
  assert.ok(kit.proxy.stats.calls > calls, 'the review never reached the AI path (test setup)');
  assert.ok(fault.failed > 0, 'the fault never fired');
  assert.equal(result.ok, false);
  const said = String(result.error || '').trim();
  assert.ok(said && !/Traceback|\{'type'|\{"type"|BadRequestError|Error code|undefined|\[object/.test(said), `the failure message is not a clear sentence: "${said.slice(0, 200)}"`);
  const after = await allInterviews();
  assert.equal(after.length, before + 1, 'the failed review should leave the saved transcript once');
  const saved = await interviewOf(item.id);
  assert.ok(!saved.overall, 'the interview has an outcome although its review failed');
  assert.ok(!headingsOf(saved.review).some(text => ['Strengths', 'Questions', 'Weak spots'].includes(text)), `a half-written review was saved: ${headingsOf(saved.review)}`);
  assert.match(saved.transcript || '', /Terraform at scale/, 'the saved row lost its transcript');
});

test('a transcript imported through the page is reviewed for real: outcome, strengths, next step, the right job, and the insights follow', async () => {
  const before = await allInterviews();
  const item = await importAndReview('recruiter-call-gamma', seed.gamma.url);
  const calls = kit.proxy.stats.calls;
  const result = await item.review();
  assert.ok(result.ok, `the review did not finish: ${JSON.stringify(result).slice(0, 300)}`);
  assert.ok(kit.proxy.stats.calls > calls, 'no AI call: the stored answer path was never asked');
  seed.imported = item.id;
  assert.equal((await allInterviews()).filter(row => !before.some(old => old.id === row.id)).length, 1, 'one import should add one interview row');
  const reviewed = await interviewOf(item.id);
  assert.ok(['positive', 'neutral', 'negative'].includes(reviewed.overall), `the row has no outcome (Overall "${reviewed.overall}")`);
  assert.ok(sameId(reviewed.app_id, seed.gamma.id), 'the interview is not linked to the Gamma job that was chosen');
  assert.ok(String(reviewed.next_step || '').trim(), 'the review has no next step although the call names one');
  const headings = headingsOf(reviewed.review);
  for (const wanted of ['Strengths', 'Questions']) assert.ok(headings.includes(wanted), `the review has no "${wanted}" section: ${headings}`);
  assert.ok(headings.some(text => ['Weak spots', 'Practise before the next round'].includes(text)), `the review names no gap and no practice step: ${headings}`);
  const patterns = ((await kit.data('insights', 'list', {category: 'Interview patterns'})) || []).filter(row => row.category === 'Interview patterns');
  assert.equal(patterns.length, 1, `${patterns.length} "Interview patterns" insights in the store, expected exactly 1`);
});

test('Review again on an older review replaces it: same row, one review, the old text gone', async () => {
  const before = await allInterviews();
  const result = await interviews.review(kit.storage, seed.ivPositive.id);
  assert.ok(result.ok, `review again did not finish: ${JSON.stringify(result).slice(0, 300)}`);
  assert.equal((await allInterviews()).length, before.length, 'review again changed the number of rows');
  const again = await interviewOf(seed.ivPositive.id);
  assert.ok(!/SEED/.test(again.review || ''), 'the old (seeded) review text is still in the review');
  for (const heading of ['Strengths', 'Questions']) assert.equal(headingsOf(again.review).filter(text => text === heading).length, 1, `"${heading}" should be in the review once after review again`);
  assert.match(again.transcript || '', /Terraform at scale/, 'review again lost the transcript');
});

test('Refresh insights without a new review says it is up to date and spends nothing', async () => {
  const first = await interviews.refreshInsights(kit.storage);
  assert.ok(first.ok, `the first refresh failed: ${JSON.stringify(first).slice(0, 300)}`);   // the reviews above changed rows: one refresh brings the card up to date
  const calls = kit.proxy.stats.calls;
  const second = await interviews.refreshInsights(kit.storage);
  assert.ok(second.ok, `the second refresh failed: ${JSON.stringify(second).slice(0, 300)}`);
  assert.equal(second.status, 'unchanged', `the second refresh should find nothing to do, it says: ${JSON.stringify(second).slice(0, 200)}`);
  assert.equal(kit.proxy.stats.calls, calls, 'a refresh with nothing changed still called the AI');
});

test('Delete takes an interview out of the store, and only that one (the id the page sends)', async () => {
  const before = (await allInterviews()).map(item => item.id);
  assert.ok(before.some(id => sameId(id, seed.ivPositive.id)), 'the control: the interview is in the store before Delete');
  const gone = await interviews.remove(kit.storage, seed.ivPositive.id);
  assert.ok(gone?.ok, `delete failed: ${JSON.stringify(gone)}`);
  const after = (await allInterviews()).map(item => item.id);
  assert.ok(!after.some(id => sameId(id, seed.ivPositive.id)), 'the interview is still in the store after Delete');
  assert.equal(after.length, before.length - 1, 'Delete took more than the one interview');
});
