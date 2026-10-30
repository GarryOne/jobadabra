// The popup picks the best jobs by fit (decision 2), or the ones above a fit, and each read's chip says its mode, never a guess (lib/apply-triage-pick.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chipOf, pickForTriage} from '../renderer/apply-triage-pick.js';

const jobs = [
  {url: 'https://a.example/1', fit: 66}, {url: 'https://a.example/2', fit: 88}, {url: 'https://a.example/3', fit: 79},
  {url: 'https://a.example/4'}, {title: 'no url'},
];

test('the default picks the best matches by fit, capped at n, and skips jobs without a link', () => {
  assert.deepEqual(pickForTriage(jobs, {n: 2}).map(job => job.fit), [88, 79]);
});

test('fit above picks every job at or above the fit, capped at n', () => {
  assert.deepEqual(pickForTriage(jobs, {choice: 'fit', minFit: 70, n: 10}).map(job => job.fit), [88, 79]);
  assert.deepEqual(pickForTriage(jobs, {choice: 'fit', minFit: 70, n: 1}).map(job => job.fit), [88]);
});

test('the input is not changed, and a missing fit ranks last', () => {
  const before = jobs.map(job => job.url);
  pickForTriage(jobs, {n: 10});
  assert.deepEqual(jobs.map(job => job.url), before);
  assert.equal(pickForTriage(jobs, {n: 10}).at(-1).url, 'https://a.example/4');
});

test('a job with no read is Not checked, and each read says its mode and reason', () => {
  assert.deepEqual(chipOf(null), {label: 'Not checked', tone: 'neutral', detail: ''});
  const clean = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: true};
  assert.equal(chipOf(clean).label, 'Can apply automatically');
  assert.equal(chipOf({...clean, allFactsSaved: false}).label, 'You review and submit');
  assert.equal(chipOf({...clean, captcha: true}).detail, 'captcha');
  assert.equal(chipOf({...clean, eligible: false}).label, 'Skipped');
});
