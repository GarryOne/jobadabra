// The live card of a hidden-browser session (renderer/live-card.js; owner's live view design, 28 Oct 2026): four states drawn from the session's
// background state and the page's facts, Submit on only when the form judge's ready stands and no required field is empty; presses and keys map to the page.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {keyMessage, liveCard, toPage} from '../renderer/live-card.js';

const at = () => '21:48';
const facts = (left, extra = {}) => ({address: 'jobs.example.test/apply', fields: 12, filled: 12 - left, left: Array.from({length: left}, (_, i) => ({label: `Field ${i}`, x: 0, y: 0, w: 1, h: 0.1})), active: '', ...extra});

test('Filling: watch only, the count from the page, the field being filled, Stop and no Submit', () => {
  const card = liveCard({state: 'filling'}, facts(3, {active: 'Bachelor\'s degree result'}), {at});
  assert.deepEqual([card.kind, card.title, card.pill[0], card.pill[1], card.input, card.filling, card.submit], ['filling', 'Filling the application', 'Filling · 9 of 12 fields', 'info', false, 'Bachelor\'s degree result', null]);
  assert.equal(liveCard({state: 'queued'}, null, {at}).pill[0], 'Filling', 'no count before the page is read');
});

test('A bot check: framed, never solved by us, Submit off with what to do', () => {
  const card = liveCard({state: 'manual_submit_required', reason: 'captcha_runtime', readyAt: 1}, facts(0), {at});
  assert.deepEqual([card.kind, card.title, card.meta, card.frame, card.submit.on], ['check', 'A bot check needs you', '· filled at 21:48, then the page asked', 'warn', false]);
  assert.match(card.note, /never solves bot checks/);
});

test('Review: the required fields left are framed and counted; Submit off until none is left', () => {
  const card = liveCard({state: 'ready_for_review', readyAt: 1}, facts(2), {at});
  assert.deepEqual([card.kind, card.pill[0], card.marks, card.submit.on, card.submit.hint], ['review', 'Ready for review', true, false, '2 required fields left']);
  assert.equal(liveCard({state: 'ready_for_review'}, facts(1), {at}).submit.hint, '1 required field left');
  assert.equal(liveCard({state: 'ready_for_review'}, null, {at}).submit.hint, 'Reading the page…', 'unknown is not ready');
});

test('Ready to submit: the judge\'s ready and no required field left; green frame; pressing it is the person submitting', () => {
  const card = liveCard({state: 'ready_for_review', readyAt: 1}, facts(0), {at});
  assert.deepEqual([card.kind, card.title, card.pill, card.frame, card.submit.on], ['ready', 'Ready to submit', ['Ready to submit', 'good'], 'good', true]);
  assert.match(card.note, /you submitting/);
});

test('handed to the person for another reason: the controller\'s words, the page\'s own Submit only', () => {
  const card = liveCard({state: 'needs_user_handoff', reason: 'stopped'}, facts(0), {at, note: 'Background application stopped. Review and submit this form yourself.'});
  assert.deepEqual([card.kind, card.pill[0], card.submit.on, card.submit.hint], ['review', 'Needs you', false, 'Use the page\'s own Submit']);
  assert.match(card.note, /stopped/);
});

test('class: in every state and every page reading, Submit is on only for the judge\'s ready with no required field empty', () => {
  const states = ['queued', 'preflight', 'filling', 'ready_for_review', 'needs_user_handoff', 'manual_submit_required', 'waiting_to_submit', 'submitting', 'receipt_confirmed', ''];
  for (const state of states) for (const reason of ['', 'captcha_runtime', 'stopped']) for (const read of [null, facts(0), facts(1), facts(4)]) {
    const card = liveCard({state, reason}, read, {at});
    assert.equal(!!card.submit?.on, state === 'ready_for_review' && read?.left.length === 0, `${state}/${reason}/${read?.left.length ?? 'unread'}`);
  }
});

test('a press on the picture lands on the same spot of the page at any picture size; keys type what they type', () => {
  assert.deepEqual(toPage(110, 70, {left: 10, top: 20, width: 640, height: 360}, 1280, 720), {x: 200, y: 100});
  assert.deepEqual(keyMessage({key: 'a', keyCode: 65}), {t: 'key', key: 'a', code: 65, up: false, text: 'a'});
  assert.equal(keyMessage({key: 'Enter', keyCode: 13}).text, '\r');
  assert.equal(keyMessage({key: 'Backspace', keyCode: 8}).text, undefined);
  assert.deepEqual(keyMessage({key: 'a', keyCode: 65}, true), {t: 'key', key: 'a', code: 65, up: true, text: undefined});
});
