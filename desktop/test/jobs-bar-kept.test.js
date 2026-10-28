// The Jobs bar's four states (renderer/suggestions.js barView; #2382, owner 28 Oct 2026: "I clicked on it. It vanished"): kept paint, Focus unavailable, Focus read, zero.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {barView} from '../renderer/suggestions.js';

const KEPT = {shown: true, count: 3, line: 'Cover letter missing · 2 search suggestions'};

test('the owner\'s scenario: a start on Jobs with a kept bar, then the click (open) and the count arriving, before Focus is read: the bar stays', () => {
  const folded = barView({focusRead: false, kept: KEPT});
  assert.deepEqual([folded.shown, folded.rows, folded.title], [true, false, KEPT.line], 'the kept line, list left alone');
  const clicked = barView({focusRead: false, kept: KEPT, open: true, entries: []});
  assert.equal(clicked.shown, true, 'the click does not hide it (red before: entries were empty until Focus was read)');
  assert.equal(clicked.rows, false);
});

test('Focus read: the bar shows its entries and the list may be redrawn; zero entries hide it', () => {
  const entries = [{kind: 'insight'}, {kind: 'tune'}];
  assert.deepEqual([barView({focusRead: true, entries, line: 'x'}).shown, barView({focusRead: true, entries}).rows], [true, true]);
  assert.equal(barView({focusRead: true, entries: [], kept: KEPT}).shown, false);
});

test('Focus unavailable (gated store, failed read): the kept bar goes, it has nothing to fill it; no kept bar stays hidden', () => {
  assert.equal(barView({focusRead: false, unavailable: true, kept: KEPT}).shown, false);
  assert.equal(barView({focusRead: false, kept: null}).shown, false);
  assert.equal(barView({focusRead: false, kept: {shown: false}}).shown, false);
});
