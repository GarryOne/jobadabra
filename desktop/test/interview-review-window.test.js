// The interview review's duplicate window (lib/interview-review-window.js, used by the ivReview handler): one review of an interview at most every 2 minutes, whoever asks.
// Moved from the e2e `interviews` step "Review again right after a review starts nothing" (R2, 1 Nov 2026): the window lives in the main process, which only an e2e step could reach.
// The clock is injected: no test here waits for time.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {REVIEW_WINDOW_MS, mayStart} from '../lib/interview-review-window.js';

const T0 = Date.parse('2026-11-01T10:00:00Z');

test('the first review of an interview may start', () => {
  assert.equal(mayStart(new Map(), 'page-1', T0), true);
});

test('a second ask for the same interview right after the first starts nothing, whoever asks', () => {
  const started = new Map([['page-1', T0]]);
  assert.equal(mayStart(started, 'page-1', T0 + 1000), false, 'a second press a second later');
  assert.equal(mayStart(started, 'page-1', T0 + REVIEW_WINDOW_MS - 1), false, 'one millisecond before the window ends');
  assert.equal(mayStart(started, 1, T0 + 1000), true, 'another interview is not held by it');
});

test('a deliberate Review again after the window runs; a failed review (the caller deletes its start) retries at once', () => {
  const started = new Map([['page-1', T0]]);
  assert.equal(mayStart(started, 'page-1', T0 + REVIEW_WINDOW_MS), true);
  started.delete('page-1');
  assert.equal(mayStart(started, 'page-1', T0 + 500), true);
});

test('the handler uses it for every ivReview (no second inline copy of the rule)', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../lib/interview-handlers.js', import.meta.url), 'utf8');
  assert.match(source, /mayStart\(reviewingStarted, id\)/);
  assert.doesNotMatch(source, /Date\.now\(\) - \(reviewingStarted\.get/);
});
