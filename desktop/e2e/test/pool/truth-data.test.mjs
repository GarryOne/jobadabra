// Screen against source: the Jobs list and the store's Job Matches agree job for job (lib/truth-data.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {agreeWithin, compareJobs} from '../../lib/truth-data.mjs';

const row = (url, score, status = 'New', title = 'SRE') => ({url, fit: score, status, title});   // a Job Matches record as the store gives it (on any store)

test('the same jobs with the same scores agree', () => {
  assert.deepEqual(compareJobs([{url: 'https://a/1', title: 'SRE', fit: 80}], [row('https://a/1/', 80)]), []);
});
test('a rescored, an extra and a missing job are each named', () => {
  const problems = compareJobs([{url: 'https://a/1', title: 'SRE', fit: 70}, {url: 'https://a/2', title: 'Ghost', fit: 60}], [row('https://a/1', 80), row('https://a/3', 75, 'New', 'Lost one')]);
  assert.equal(problems.length, 3);
  assert.match(problems.join('\n'), /shows fit 70 but its Job Matches record says 80/);
  assert.match(problems.join('\n'), /"Ghost" .* no Job Matches record/);
  assert.match(problems.join('\n'), /"Lost one" .* missing from the Jobs list/);
});
test('a dismissed or low-scored row may be absent from the list', () => {
  assert.deepEqual(compareJobs([], [row('https://a/1', 80, 'Dismissed'), row('https://a/2', 30)]), []);
});

// The list redraws a moment after the store is written (Windows CI, 17 Oct 2026: the step read the list while a reload was still in flight and called a listed job "missing"): agree within a time, fail on what stays wrong.
const noWait = () => Promise.resolve();
test('a list that catches up with the store within the time agrees', async () => {
  const reads = [[[{url: 'https://a/2', title: 'Platform', fit: 78}], [row('https://a/1', 84), row('https://a/2', 78)]],
    [[{url: 'https://a/1', title: 'SRE', fit: 84}, {url: 'https://a/2', title: 'Platform', fit: 78}], [row('https://a/1', 84), row('https://a/2', 78)]]];
  let n = 0;
  assert.deepEqual(await agreeWithin(async () => reads[Math.min(n++, reads.length - 1)], {wait: noWait}), []);
  assert.equal(n, 2, 'read again after the first disagreement, stopped at the first agreement');
});

test('a job that stays missing from the list is still reported once the time is up', async () => {
  let n = 0;
  const problems = await agreeWithin(async () => { n++; return [[], [row('https://a/1', 84, 'New', 'SRE')]]; }, {wait: noWait, timeoutMs: 9000, everyMs: 3000});
  assert.match(problems[0], /"SRE" is a Job Matches record in the store but is missing from the Jobs list/);
  assert.equal(n, 4, 'one read now, then one every 3 s up to 9 s');
});

test('a score that stays wrong is reported too, and agreement on the first read does not wait', async () => {
  const waits = [];
  const wait = ms => { waits.push(ms); return Promise.resolve(); };
  assert.deepEqual(await agreeWithin(async () => [[{url: 'https://a/1', title: 'SRE', fit: 80}], [row('https://a/1', 80)]], {wait}), []);
  assert.deepEqual(waits, []);
  const wrong = await agreeWithin(async () => [[{url: 'https://a/1', title: 'SRE', fit: 70}], [row('https://a/1', 80)]], {wait, timeoutMs: 3000, everyMs: 3000});
  assert.match(wrong[0], /shows fit 70 but its Job Matches record says 80/);
});
