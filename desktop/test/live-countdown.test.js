// Full automation's 10-minute wait is visible: the Applying card counts down to the automatic Submit and offers Stop; before this it only showed a note line
// (owner, 28 Oct 2026: "Finish the 'Full automation' / background applying flow"; project safety rule: "10-minute wait with Stop").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {countdownLabel, liveCard} from '../renderer/live-card.js';

const NOW = Date.parse('2026-10-28T21:00:00Z');

test('the countdown reads minutes and seconds, never negative, and says so when the wait is over', () => {
  assert.equal(countdownLabel(NOW + 10 * 60000, NOW), '10:00');
  assert.equal(countdownLabel(NOW + 9 * 60000 + 41000, NOW), '9:41');
  assert.equal(countdownLabel(NOW + 5000, NOW), '0:05');
  assert.equal(countdownLabel(NOW + 400, NOW), '0:01', 'a started second counts');
  assert.equal(countdownLabel(NOW - 1000, NOW), '');
  assert.equal(countdownLabel(0, NOW), '', 'no due time, no clock');
});

test('a job waiting to submit shows its page, the time left and Stop; nothing but the timer sends it', () => {
  const card = liveCard({state: 'waiting_to_submit', dueAt: NOW + 9 * 60000 + 41000}, {left: [], fields: 4, filled: 4}, {now: () => NOW});
  assert.deepEqual([card.kind, card.live, card.title, card.pill], ['countdown', true, 'Submitting in 9:41', ['Submitting soon', 'info']]);
  assert.equal(card.stop, true, 'the card offers Stop');
  assert.equal(card.submit, null, 'no manual Submit while the timer runs: Stop first, then the person submits');
  assert.match(card.note, /Stop/);
  assert.equal(card.input, false, 'the page does not take clicks while the press is due');
});

test('when the time is up the card says it is submitting, and a job with no due time still offers Stop', () => {
  assert.equal(liveCard({state: 'waiting_to_submit', dueAt: NOW - 1}, null, {now: () => NOW}).title, 'Submitting now…');
  const none = liveCard({state: 'waiting_to_submit', dueAt: 0}, null, {now: () => NOW});
  assert.equal(none.kind, 'countdown');
  assert.equal(none.stop, true);
});

test('every other state is unchanged and offers no countdown Stop', () => {
  for (const state of ['queued', 'preflight', 'filling', 'ready_for_review', 'needs_user_handoff']) assert.notEqual(liveCard({state}, null, {now: () => NOW}).kind, 'countdown', state);
});
