// The Bug Tracker's missed bugs become the weekly self-review's first lessons: critical and high first, with the session's root cause and test idea.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {missedLessons} from '../../lib/bug-tracker.mjs';

const row = (bug, caught, extra = {}) => ({properties: {Bug: {title: [{plain_text: bug}]}, 'Caught by e2e': {select: {name: caught}}, 'Found on': {date: {start: '2026-10-04'}},
  Severity: {select: {name: extra.severity || 'Medium'}}, Area: {select: {name: 'Activity/Runs'}}, 'Critical path': {checkbox: !!extra.critical}, 'Found by': {select: {name: 'User report'}},
  'Root cause': {rich_text: extra.cause ? [{plain_text: extra.cause}] : []}, 'e2e test idea': {rich_text: extra.idea ? [{plain_text: extra.idea}] : []}}});

test('missed and late bugs, critical high first, with root cause and test idea; caught ones and old ones are not lessons', () => {
  const text = missedLessons([
    row('Caught one', 'Yes'),
    row('Minor gap', 'No - gap'),
    row('Run stays Running after a quit', 'No - gap', {critical: true, severity: 'High', cause: 'the row was never closed', idea: 'quit mid-run and read the Notion row'}),
    row('Seen only by users', 'Late (only after users or manual)'),
    {...row('Old gap', 'No - gap'), properties: {...row('Old gap', 'No - gap').properties, 'Found on': {date: {start: '2026-08-01'}}}},
  ], {now: Date.parse('2026-10-06T00:00:00Z')});
  assert.match(text, /Bugs the Finder missed/);
  const order = ['Run stays Running', 'Minor gap', 'Seen only by users'].map(name => text.indexOf(name));
  assert.ok(order.every((at, i) => at > 0 && (!i || at > order[i - 1])), text);
  assert.match(text, /Root cause: the row was never closed\n  - Test idea from the session: quit mid-run and read the Notion row/);
  assert.doesNotMatch(text, /Caught one|Old gap/);
  assert.equal(missedLessons([row('ok', 'Yes')]), '');
});
