// The Finder scorecard (lib/finder-scorecard.mjs): precision and false-positive causes per detector, severity changes from the filed level, and the change since last time.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {previousOf, scorecard, scorecardComment} from '../../lib/finder-scorecard.mjs';

const issue = (source, state, labels = [], body = '') => ({state, stateReason: state === 'CLOSED' ? 'NOT_PLANNED' : null, labels: [`source:${source}`, ...labels].map(name => ({name})), comments: [], body, createdAt: '2026-10-13T00:00:00Z'});
const ISSUES = [
  issue('layout-check', 'CLOSED', ['resolution:fp:detector', 'wontfix-auto']),
  issue('layout-check', 'CLOSED', ['resolution:fp:detector', 'wontfix-auto']),
  issue('layout-check', 'OPEN', ['confirmed', 'severity:high'], '**HIGH**\n<!-- severity-filed:medium -->'),
  issue('ai-review', 'CLOSED', ['resolution:fixed', 'confirmed', 'severity:low'], '<!-- severity-filed:medium -->'),
  issue('ai-review', 'OPEN', ['severity:medium']),
];

test('per detector: real, false with its cause, open, precision, severity changes', () => {
  const card = scorecard(ISSUES, {now: new Date('2026-10-14T00:00:00Z')});
  const layout = card.detectors.find(row => row.source === 'layout-check'), review = card.detectors.find(row => row.source === 'ai-review');
  assert.deepEqual({filed: layout.filed, real: layout.real, falsePositive: layout.falsePositive, precision: layout.precision}, {filed: 3, real: 1, falsePositive: 2, precision: 33});
  assert.deepEqual(layout.causes, {'fp:detector': 2});
  assert.deepEqual(layout.severityChanged, {judged: 1, raised: 1, lowered: 0});
  assert.deepEqual(review.severityChanged, {judged: 1, raised: 0, lowered: 1});
  assert.equal(review.open, 1);
  assert.equal(card.totals.precision, 50);
});

test('the comment shows the change since the last scorecard and carries its data back', () => {
  const before = scorecard(ISSUES.slice(0, 2), {now: new Date('2026-10-06T00:00:00Z')});
  const first = scorecardComment(before);
  assert.deepEqual(previousOf([{body: 'hello'}, {body: first}]), before);
  const now = scorecard(ISSUES, {now: new Date('2026-10-14T00:00:00Z')});
  const text = scorecardComment(now, previousOf([{body: first}]));
  assert.match(text, /\*\*Precision 50% \(\+50\)\*\*/);
  assert.match(text, /\| Layout and DOM checks \| 3 \| 1 \| 2 \| 0 \| 33% \(\+33\) \| fp:detector 2 \| 1↑ 0↓ \|/);
  assert.match(text, /since 2026-10-06/);
});

test('the yield: real and false findings this week vs the week before, with a warning when real bugs fall', () => {
  const at = (days, item) => ({...item, createdAt: new Date(Date.parse('2026-10-14T00:00:00Z') - days * 86400000).toISOString()});
  const real = issue('ai-review', 'CLOSED', ['resolution:fixed', 'confirmed']), fp = issue('layout-check', 'CLOSED', ['resolution:fp:detector', 'wontfix-auto']);
  const card = scorecard([at(1, fp), at(2, real), at(8, real), at(9, real)], {now: new Date('2026-10-14T00:00:00Z')});
  assert.deepEqual(card.yield, {thisWeek: {real: 1, falsePositive: 1}, lastWeek: {real: 2, falsePositive: 0}});
  assert.match(scorecardComment(card), /This week 1 real · 1 false\*\* \(the week before: 2 real · 0 false\) · ⚠️ fewer real bugs/);
});
