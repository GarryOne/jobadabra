// The eligibility case set (lib/eligibility-cases.mjs) on a stub ask: the cases cover the applicant's constraints and both verdicts, every case is asked
// `times` times, and the summary names a wavering case and fails a wrong one. The real asks run by hand (npm run eligibility-cases).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CASES, answerBody, runCases, summarize} from '../../lib/eligibility-cases.mjs';

test('the cases cover each constraint the seeded applicant states, with both verdicts', () => {
  assert.deepEqual(CASES.map(item => item.id), ['sydney-hybrid', 'us-onsite', 'french-required', 'swiss-role', 'remote-europe']);
  assert.ok(CASES.some(item => item.expect) && CASES.some(item => !item.expect));
  for (const item of CASES) assert.match(answerBody(item).url, /^https:\/\/jobs\.example\.org\//, 'invented postings only');
});

test('every case is asked the given number of times; a split is named, a majority wrong fails', async () => {
  const asked = [];
  const truth = await runCases(async (item, round) => { asked.push(`${item.id}#${round}`); return {eligible: item.expect, note: 'stub'}; }, {times: 3});
  assert.equal(asked.length, CASES.length * 3);
  assert.deepEqual(summarize(truth), {...summarize(truth), ok: true, line: 'eligibility cases: 5/5 as expected every time'});
  const wavering = await runCases(async (item, round) => ({eligible: item.id === 'swiss-role' && round === 2 ? false : item.expect}), {times: 3});
  assert.equal(summarize(wavering).ok, true);
  assert.match(summarize(wavering).line, /wavers: swiss-role 2\/3/);
  const wrong = await runCases(async item => ({eligible: item.id === 'sydney-hybrid' ? true : item.expect}), {times: 3});
  assert.equal(summarize(wrong).ok, false);
  assert.match(summarize(wrong).line, /WRONG: sydney-hybrid 0\/3/);
});

test('an ask that fails counts as no verdict, never as the expected one', async () => {
  const results = await runCases(async () => { throw new Error('usage limit'); }, {cases: CASES.slice(0, 1), times: 2});
  assert.deepEqual(results[0].verdicts, [null, null]);
  assert.equal(summarize(results).ok, false);
});
