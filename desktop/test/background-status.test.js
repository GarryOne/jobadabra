// A hidden-browser session's words in the sessions list, dock and Applying card come from its own background state, never from a Chrome tab it does not have
// (owner screenshots, 28 Oct 2026: Air France, queued behind GLOCK, said "Filling" with a broken picture and "Tab not found"; GLOCK, filling, said "Can't reach form").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {backgroundStatus} from '../renderer/background-status.js';
import {liveCard} from '../renderer/live-card.js';

const status = state => backgroundStatus({background: {state}});

test('each background state has its own words and tone; a session that is not a hidden-browser one has none', () => {
  assert.deepEqual(status('queued'), ['Queued', 'neutral']);
  assert.deepEqual(status('preflight'), ['Filling', 'info']);
  assert.deepEqual(status('filling'), ['Filling', 'info']);
  assert.deepEqual(status('ready_for_review'), ['Ready for review', 'warn']);
  assert.deepEqual(status('needs_user_handoff'), ['Needs you', 'warn']);
  assert.deepEqual(status('manual_submit_required'), ['Needs you', 'warn']);
  assert.deepEqual(status('waiting_to_submit'), ['Submitting soon', 'info']);
  assert.deepEqual(status('submitting'), ['Submitting…', 'info']);
  assert.equal(backgroundStatus({}), null, 'a Chrome session keeps the Chrome words');
  assert.equal(backgroundStatus({background: {state: 'receipt_confirmed'}}), null, 'a finished one falls through to the usual words');
});

test('a queued job waits for its turn: no live picture, no Filling, Stop only; only the job that is filling gets the live view', () => {
  const queued = liveCard({state: 'queued'}, null);
  assert.deepEqual([queued.kind, queued.title, queued.pill, queued.live], ['waiting', 'Waiting for its turn', ['Queued', 'neutral'], false]);
  assert.match(queued.note, /one application at a time/);
  for (const state of ['preflight', 'filling']) assert.deepEqual([liveCard({state}, null).kind, liveCard({state}, null).live], ['filling', true], state);
  for (const state of ['ready_for_review', 'needs_user_handoff', 'manual_submit_required']) assert.equal(liveCard({state}, null).live, true, `${state} shows the page`);
});

test('the dock counts a filling hidden-browser job as active, a queued one as waiting its turn, and never calls one "closed" for lacking a Chrome tab', async () => {
  const {dockCounts, dockOrder, tabClosed} = await import('../renderer/session-state.js');
  const filling = {id: 'g', kind: 'form', status: 'running', startedAt: '2026-10-28T16:00:00Z', background: {state: 'filling'}};
  const queued = {id: 'a', kind: 'form', status: 'running', startedAt: '2026-10-28T16:00:00Z', background: {state: 'queued'}};
  assert.equal(dockCounts([filling, queued]).active, 1, 'only the one that fills is active');
  const forms = {known: true, ids: [], unsure: []};
  assert.equal(tabClosed(filling, forms, true, Date.parse('2026-10-28T20:00:00Z')), false, 'a hidden-browser session has no Chrome tab to lose');
  assert.equal(tabClosed({...filling, background: undefined}, forms, true), true, 'a Chrome session still reads closed');
  assert.ok(dockOrder(filling, item => tabClosed(item, forms, true)) < 9, 'the filling job is not sorted last as if closed');
});
