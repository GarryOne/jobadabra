// Employers & Sources without a window (renderer/employers-view.js): the filters, tones, stats line, links and detail lines.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {day, detailLines, feedName, feedStatuses, feedTone, filterEmployers, metaLine, researchLinks, statsLine} from '../renderer/employers-view.js';

const rows = [
  {id: 1, name: 'Acme', kind: 'Employer', active: true, feed_status: 'Feed found', ats: 'greenhouse', slug: 'acme', cities: 'Zürich', relevant_roles: 'Backend'},
  {id: 2, name: 'Board', kind: 'Job board', active: true, feed_status: 'Feed found', feed: 'https://board.example/api'},
  {id: 3, name: 'Quiet', active: false, feed_status: 'No public feed', website: 'javascript:alert(1)', glassdoor: 'https://glassdoor.example/q'},
];

test('filters: text over name, places, roles and job system; kind (no kind = Employer); feed status; active', () => {
  assert.deepEqual(filterEmployers(rows, {text: 'zür'}).map(r => r.id), [1]);
  assert.deepEqual(filterEmployers(rows, {text: 'GREENHOUSE'}).map(r => r.id), [1]);
  assert.deepEqual(filterEmployers(rows, {kind: 'Employer'}).map(r => r.id), [1, 3]);
  assert.deepEqual(filterEmployers(rows, {feed: 'No public feed'}).map(r => r.id), [3]);
  assert.deepEqual(filterEmployers(rows, {active: 'off'}).map(r => r.id), [3]);
});

test('stats, feed statuses, tones and names', () => {
  assert.equal(statsLine(rows), '3 tracked · 2 active · 2 feed found · 1 job board');
  assert.equal(statsLine(rows, rows.slice(0, 1)), '1 of 3 tracked · 2 active · 2 feed found · 1 job board');
  assert.deepEqual(feedStatuses([...rows, {feed_status: 'Custom'}]), ['Feed found', 'No public feed', 'Custom']);
  assert.equal(feedTone('Manual watch'), 'bad');
  assert.equal(feedTone('Unknown'), 'neutral');
  assert.equal(feedName(rows[0]), 'greenhouse · acme');
  assert.equal(feedName(rows[1]), 'board.example');
  assert.equal(metaLine(rows[0]), 'Zürich · Backend');
});

test('research links are http(s) only; detail lines skip empty values', () => {
  assert.deepEqual(researchLinks(rows[2]), [['Glassdoor', 'https://glassdoor.example/q']]);
  assert.deepEqual(detailLines({notes: '3 open', in_preferred_places: false, verification: ''}), [['Notes', '3 open'], ['In your preferred places', 'no']]);
  assert.equal(day('2026-10-08', Date.parse('2026-10-09')), '8 Oct');   // the screens' one format (renderer/date.js)
  assert.match(day('2025-03-01', Date.parse('2026-10-09')), /2025/);
  assert.equal(day(''), '');
});
