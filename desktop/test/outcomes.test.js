// The outcome tap: what a click records, what is counted anonymously, and which choices a job offers at which stage.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DAY_BUCKETS, OUTCOMES, STAGES, anonymous, daysBucket} from '../lib/outcomes.js';
import {outcomeChoices, reopenable} from '../renderer/outcome-tap.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');

test('every outcome the window can send maps to a stage the engine accepts', () => {
  assert.deepEqual(OUTCOMES, ['reply', 'screening', 'offer', 'rejected', 'no_response', 'withdrawn']);
  assert.deepEqual(Object.values(STAGES), ['Reply received', 'Interview scheduled', 'Offer', 'Rejected', 'No response', 'Withdrawn']);
});

test('days are counted in coarse buckets, and an unknown date counts as none', () => {
  assert.deepEqual([0, 3, 4, 7, 8, 14, 15, 30, 31, 90].map(n => daysBucket(new Date(NOW - n * 86400000).toISOString().slice(0, 10), NOW)),
    ['0-3', '0-3', '4-7', '4-7', '8-14', '8-14', '15-30', '15-30', '31+', '31+']);
  assert.equal(daysBucket('', NOW), '');
  assert.equal(daysBucket('not a date', NOW), '');
  assert.ok(DAY_BUCKETS.includes(daysBucket('2026-09-01', NOW)));
});

test('what is counted is the board, the outcome and the days: never the company, the role or the address', () => {
  const sent = anonymous({url: 'https://job-boards.greenhouse.io/grafanalabs/jobs/12345?gh_src=x', outcome: 'reply', appliedOn: '2026-10-10'}, NOW);
  assert.deepEqual(sent, {board: 'greenhouse', outcome: 'reply', days: '8-14'});
  assert.equal(JSON.stringify(sent).includes('grafana'), false);
  const other = anonymous({url: 'https://careers.small-company.example/jobs/9', outcome: 'rejected', appliedOn: '2026-10-19'}, NOW);
  assert.match(other.board, /^h:[0-9a-f]{10}$/);   // an unknown site is a hash
  assert.equal(JSON.stringify(other).includes('small-company'), false);
  assert.equal(anonymous({url: 'https://x.test/y', outcome: 'hired', appliedOn: ''}, NOW), null);   // not an outcome
  assert.equal(anonymous({url: 'not a url', outcome: 'reply'}, NOW), null);
});

test('a job offers the outcomes that make sense for its stage', () => {
  assert.deepEqual(outcomeChoices('Applied').map(c => c.outcome), ['reply', 'screening', 'offer', 'rejected', 'no_response']);
  assert.deepEqual(outcomeChoices('Confirmation received').map(c => c.outcome), ['reply', 'screening', 'offer', 'rejected', 'no_response']);
  assert.deepEqual(outcomeChoices('Interviewing').map(c => c.outcome), ['offer', 'rejected']);
  assert.deepEqual(outcomeChoices('Screening').map(c => c.outcome), ['offer', 'rejected']);
  for (const stage of ['Applying', 'Kit ready', 'Offer', 'Rejected', 'Withdrawn', 'No response', undefined]) assert.deepEqual(outcomeChoices(stage), [], String(stage));
  assert.ok(outcomeChoices('Applied').every(c => OUTCOMES.includes(c.outcome) && /anonymously by job board and days only/.test(c.title)));
  assert.ok(outcomeChoices('Applied', 'Jobadabra').every(c => c.title.includes('Recorded in Jobadabra.')), 'the note names the store it is kept in');
});

test('sources fold into known job-board kinds; any other site is "other" and nothing hashed leaves', async () => {
  const {sourceStats} = await import('../lib/outcomes.js');
  const {boardName} = await import('../lib/control-events.js');
  const out = sourceStats([{host: 'boards.greenhouse.io', seen: 5, acted: 2, dismissed: 1, heard: 1}, {host: 'job-boards.greenhouse.io', seen: 5, acted: 0, dismissed: 3, heard: 0},
    {host: 'careers.acme.com', seen: 2, acted: 1, dismissed: 0, heard: 0}, {host: 'jobs.lever.co', seen: 1}], boardName);
  assert.deepEqual(out, [{board: 'greenhouse', seen: 10, acted: 2, dismissed: 4, heard: 1, good: 0, hours: null}, {board: 'other', seen: 2, acted: 1, dismissed: 0, heard: 0, good: 0, hours: null},
    {board: 'lever', seen: 1, acted: 0, dismissed: 0, heard: 0, good: 0, hours: null}]);
});

test('job boards and aggregators are source kinds of their own, with jobs scored 70+ and the median hours to discovery', async () => {
  const {sourceStats} = await import('../lib/outcomes.js');
  const {boardName} = await import('../lib/control-events.js');
  const out = sourceStats([{host: 'www.arbeitnow.com', seen: 4, good: 2, hours: [30, 10, 50]}, {host: 'www.jobs.ch', seen: 3, good: 1, hours: [5]},
    {host: 'jobicy.com', seen: 1}, {host: 'recruitingapp-2824.umantis.com', seen: 2}], boardName);
  assert.deepEqual(out.map(o => [o.board, o.good, o.hours]), [['arbeitnow', 2, 30], ['jobsch', 1, 5], ['jobicy', 0, null], ['umantis', 0, null]]);
});

test('every closed stage can be reopened, and no other stage offers it', () => {
  for (const stage of ['Rejected', 'Withdrawn', 'No response']) assert.equal(reopenable(stage), true, stage);
  for (const stage of ['Saved', 'Kit ready', 'Applying', 'Applied', 'Confirmation received', 'Screening', 'Interviewing', 'Offer', 'Closed', 'Dismissed', '']) assert.equal(reopenable(stage), false, stage);
});
