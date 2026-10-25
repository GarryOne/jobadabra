// Sorting a library table: row order, the next state on a click, blanks last, and every Employers column has a sorter. Guards renderer/table-sort.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SORT_COLUMNS, FEED_TONES, FEED_HELP, QUALITY_HELP, qualityHelp} from '../renderer/employers-view.js';
import {loadSort, nextSort, sortRows} from '../renderer/table-sort.js';

const rows = [
  {name: 'beta', quality: 14, feed_status: 'Low relevance', origin: 'x', checked: '2026-10-24', active: false},
  {name: 'Alpha', quality: '', feed_status: 'No open jobs', origin: '', checked: '', active: true},
  {name: 'gamma', quality: 30, feed_status: 'Feed found', origin: 'y', checked: '2026-10-20', active: false},
];
const names = (key, dir) => sortRows(rows, {key, dir}, SORT_COLUMNS).map(row => row.name);

test('text sorts A to Z ignoring case, numbers and dates by value, blanks always last', () => {
  assert.deepEqual(names('name', 'asc'), ['Alpha', 'beta', 'gamma']);
  assert.deepEqual(names('name', 'desc'), ['gamma', 'beta', 'Alpha']);
  assert.deepEqual(names('quality', 'desc'), ['gamma', 'beta', 'Alpha']);
  assert.deepEqual(names('quality', 'asc'), ['beta', 'gamma', 'Alpha']);
  assert.deepEqual(names('checked', 'desc'), ['beta', 'gamma', 'Alpha']);
  assert.deepEqual(names('origin', 'asc'), ['beta', 'gamma', 'Alpha']);
  assert.deepEqual(names('active', 'desc'), ['Alpha', 'beta', 'gamma']);
});

test('feed status sorts in the status order (found first when biggest first)', () => {
  assert.deepEqual(names('feed', 'desc'), ['gamma', 'Alpha', 'beta']);
});

test('a click starts text at A to Z and numbers biggest first; the same column again reverses', () => {
  assert.deepEqual(nextSort({key: 'name', dir: 'asc'}, 'quality', SORT_COLUMNS), {key: 'quality', dir: 'desc'});
  assert.deepEqual(nextSort({key: 'quality', dir: 'desc'}, 'quality', SORT_COLUMNS), {key: 'quality', dir: 'asc'});
  assert.deepEqual(nextSort({key: 'quality', dir: 'desc'}, 'origin', SORT_COLUMNS), {key: 'origin', dir: 'asc'});
});

test('a saved choice is read back; a stale or broken one falls back', () => {
  const store = value => ({getItem: () => value});
  assert.deepEqual(loadSort('k', SORT_COLUMNS, {key: 'name', dir: 'asc'}, store('{"key":"quality","dir":"desc"}')), {key: 'quality', dir: 'desc'});
  assert.deepEqual(loadSort('k', SORT_COLUMNS, {key: 'name', dir: 'asc'}, store('{"key":"gone","dir":"desc"}')), {key: 'name', dir: 'asc'});
  assert.deepEqual(loadSort('k', SORT_COLUMNS, {key: 'name', dir: 'asc'}, store('not json')), {key: 'name', dir: 'asc'});
});

test('the table sorts all seven columns, and every feed status has a tooltip', () => {
  assert.deepEqual(SORT_COLUMNS.map(column => column.key), ['name', 'kind', 'feed', 'quality', 'origin', 'checked', 'active']);
  for (const status of Object.keys(FEED_TONES)) assert.ok(FEED_HELP[status], `${status} has no tooltip`);
  assert.match(QUALITY_HELP, /0 to 100/);
  assert.equal(qualityHelp({quality: 30, notes: '5 postings; 2 matching'}), 'Quality 30 of 100. 5 postings; 2 matching');
});
