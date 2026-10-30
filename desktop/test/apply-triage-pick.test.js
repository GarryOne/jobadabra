// The popup picks the best N jobs by fit that were not checked before (owner, 30 Oct 2026), and each read's chip says its mode, never a guess (lib/apply-triage-pick.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chipOf, estimateOf, pickForTriage} from '../renderer/apply-triage-pick.js';

const jobs = [
  {url: 'https://a.example/1', fit: 66}, {url: 'https://a.example/2', fit: 88}, {url: 'https://a.example/3', fit: 79},
  {url: 'https://a.example/4'}, {title: 'no url'},
];

test('the default picks the best matches by fit, capped at n, and skips jobs without a link', () => {
  assert.deepEqual(pickForTriage(jobs, {n: 2}).map(job => job.fit), [88, 79]);
});

test('jobs that were checked before are left out, so the next N are the best new ones', () => {
  const checked = new Set(['https://a.example/2']);
  assert.deepEqual(pickForTriage(jobs, {n: 2, isChecked: job => checked.has(job.url)}).map(job => job.fit), [79, 66]);
  assert.deepEqual(pickForTriage(jobs, {n: 10, isChecked: () => true}), [], 'all checked: nothing to pick');
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

test('before any read the estimate is a first guess of a minute a job, and says so', () => {
  assert.deepEqual(estimateOf(10, []), {seconds: 600, text: 'about 10 minutes', measured: false});
  assert.deepEqual(estimateOf(1, []), {seconds: 60, text: 'about 1 minute', measured: false});
});

test('after reads the estimate is the median of the last ten, so one slow read does not move it', () => {
  const real = estimateOf(10, [40, 42, 44, 46, 48, 50, 52, 54, 56, 400]);
  assert.equal(real.measured, true);
  assert.equal(real.seconds, 490);   // median 49 s a job, ten jobs
  assert.equal(real.text, 'about 8 minutes');
  assert.equal(estimateOf(2, [900, 900, 900, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50]).seconds, 100, 'only the last ten count: three old slow reads are forgotten');
});

test('a short check says seconds, nothing to check says nothing, and bad timings are ignored', () => {
  assert.equal(estimateOf(2, [20, 20]).text, 'about 40 seconds');
  assert.equal(estimateOf(0, [50]).text, '');
  assert.equal(estimateOf(1, [2]).text, 'about 5 seconds', 'a very fast read never says about 0 seconds');
  assert.equal(estimateOf(5, [NaN, -3, 0, Infinity]).measured, false, 'no usable timing is a first guess');
});
