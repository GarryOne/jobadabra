// The Jobs Show menu as one multi-select: every old menu entry and chip is there once, a job shows when ANY ticked filter holds it, and the rules the two old lists had still hold.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {VIEWS} from '../renderer/jobs-board-rules.js';
import {BOARD_FILTERS, FILTER_OPTIONS, boardIds, countFor, hasViewOption, inFilters, inFiltersLoose, normalize, soleFilter, summary, toggled} from '../renderer/jobs-filters.js';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const match = status => ({url: `m-${status}`, status, source: 'Job Pilotto app'});
const app = (stage, extra = {}) => ({url: `a-${stage}`, stage, status: 'applied', source: 'Job Pilotto app', ...extra});
const inbound = stage => ({url: `i-${stage}`, stage, source: 'Gmail'});
const shows = (job, ...ids) => inFilters(job, ids, NOW);

test('every old menu entry and every chip is an option once (Saved and Dismissed merged)', () => {
  const ids = FILTER_OPTIONS.map(option => option.id);
  assert.equal(new Set(ids).size, ids.length, 'no id twice');
  assert.deepEqual(ids.filter(id => !id.startsWith('view:')), ['open', 'applied', 'saved', 'dismissed', 'all', 'inbound', 'everything']);
  const views = VIEWS.map(view => view.id).filter(id => !['saved', 'dismissed'].includes(id));
  assert.deepEqual(ids.filter(id => id.startsWith('view:')), views.map(id => `view:${id}`));
  const labels = FILTER_OPTIONS.map(option => option.label);
  assert.equal(new Set(labels).size, labels.length, 'no label twice (the chip "All" is "Any stage" beside "All matches")');
});

test('the old menu entries hold the same jobs', () => {
  assert.ok(shows(match('unreviewed'), 'open') && !shows(match('saved'), 'open') && !shows(inbound('Recruiter lead'), 'open'));
  assert.ok(shows(match('saved'), 'saved') && shows(match('dismissed'), 'dismissed') && shows(match('applied'), 'applied'));
  assert.ok(shows(match('unreviewed'), 'all') && shows(match('saved'), 'all') && !shows(match('applied'), 'all'), 'All matches leaves applied jobs out');
  assert.ok(shows(inbound('Recruiter lead'), 'inbound') && !shows(match('saved'), 'inbound'));
  assert.ok(shows(match('applied'), 'everything') && shows(inbound('Screening'), 'everything'));
  // A job a chip called Saved (its stage) is Saved here too, even with another status.
  assert.ok(shows({url: 's', stage: 'Saved', status: 'unreviewed'}, 'saved'));
});

test('each chip view holds the jobs it held', () => {
  const jobs = [app('Applied'), app('Screening'), app('Rejected'), app('Applying'), app('Kit ready'), app('Closed'), match('saved'), match('dismissed'), match('unreviewed')];
  for (const view of VIEWS.filter(one => !['saved', 'dismissed'].includes(one.id)))
    assert.deepEqual(jobs.filter(job => shows(job, `view:${view.id}`)).map(job => job.url), jobs.filter(job => view.test(job, NOW)).map(job => job.url), view.id);
});

test('ticking several shows the union; unticking the last goes back to New matches', () => {
  const ids = ['saved', 'view:active'];
  assert.ok(shows(match('saved'), ...ids) && shows(app('Screening'), ...ids) && !shows(match('unreviewed'), ...ids));
  assert.deepEqual(toggled(['open'], 'saved'), ['open', 'saved']);
  assert.deepEqual(toggled(['open', 'saved'], 'open'), ['saved']);
  assert.deepEqual(toggled(['saved'], 'saved'), ['open']);
  assert.deepEqual(normalize(['nope', 'saved', 'saved']), ['saved']);
  assert.deepEqual(normalize([]), ['open']);
});

test('the counts, the button text and the sole filter a counter reads', () => {
  const jobs = [match('saved'), match('saved'), match('unreviewed'), inbound('Recruiter lead')];
  assert.equal(countFor(jobs, 'saved', NOW), 2);
  assert.equal(countFor(jobs, 'inbound', NOW), 1);
  assert.equal(summary(['saved']), 'Saved');
  assert.equal(summary(['saved', 'view:active', 'inbound']), 'Saved + 2');
  assert.equal(soleFilter(['all']), 'all');
  assert.equal(soleFilter(['all', 'saved']), '');
});

test('inside a counter\'s own list, All matches and Everything let every job through', () => {
  const applied = match('applied');
  assert.ok(inFiltersLoose(applied, ['all'], NOW) && inFiltersLoose(applied, ['everything'], NOW));
  assert.ok(!inFiltersLoose(applied, ['saved'], NOW), 'a narrower tick still narrows it');
});

test('the board keeps every application unless a stage filter is ticked', () => {
  assert.deepEqual(boardIds(['open', 'inbound', 'all', 'everything']), []);
  assert.deepEqual(boardIds(['open', 'saved', 'view:active']), ['saved', 'view:active']);
  assert.ok(hasViewOption(['view:active']) && !hasViewOption(['saved']));
  for (const id of BOARD_FILTERS) assert.ok(FILTER_OPTIONS.some(option => option.id === id), id);
});
