// The next move checked (extension/ladder/next-move.js; spec 2026-10-12-one-next-move.md phase 2 box 5, "Making the next move right"): a move may act only when sure, past the
// floors, and for a press only when two asks agree; each verb has the effect it must show right after acting, else it failed and is never repeated.
import assert from 'node:assert/strict';
import test from 'node:test';
import {ACT_FROM, effectOf, mayAct, needsSecondAsk} from '../../extension/ladder/next-move.js';

const press = (extra = {}) => ({signal: 'confident', verb: 'press', number: 3, pressKind: 'apply', confidence: 0.9, floor: 'ok', ...extra});

test('a move acts only when sure, past the floors, and a press only when a second ask names the same control', () => {
  assert.equal(ACT_FROM, 0.8);
  assert.deepEqual(mayAct(press(), press()), {act: true, why: 'agreed'});
  assert.deepEqual(mayAct(press(), null), {act: false, why: 'one_ask'}, 'a press is never acted on from one ask');
  assert.deepEqual(mayAct(press(), press({number: 4})), {act: false, why: 'disagree'});
  assert.deepEqual(mayAct(press(), press({verb: 'open'})), {act: false, why: 'disagree'});
  assert.deepEqual(mayAct(press(), press({confidence: 0.5})), {act: false, why: 'disagree'}, 'the second must be sure too');
  assert.deepEqual(mayAct(press({confidence: 0.79}), press()), {act: false, why: 'unsure'}, 'below 0.8: climb, never act');
  assert.deepEqual(mayAct(press({signal: 'unsure'}), press()), {act: false, why: 'unsure'});
  assert.deepEqual(mayAct(press({floor: 'refused'}), press()), {act: false, why: 'floor'});
  assert.deepEqual(mayAct(press({verb: 'tell_person', floor: 'none'})), {act: false, why: 'person'}, 'the person is told: today\'s worst case');
  assert.deepEqual(mayAct(press({verb: 'none', floor: 'none'})), {act: false, why: 'person'});
  assert.deepEqual(mayAct(null), {act: false, why: 'person'});
  assert.deepEqual(mayAct(press({verb: 'not_listed', floor: 'none'})), {act: false, why: 'blind'}, 'the way on is not in the list: never a guess');
  assert.deepEqual(mayAct(press({signal: 'blind'})), {act: false, why: 'blind'});
});

test('the second ask is spent only where it can change the answer: a sure press the floors let through', () => {
  assert.equal(needsSecondAsk(press()), true);
  assert.equal(needsSecondAsk(press({verb: 'open'})), true);
  for (const move of [press({confidence: 0.6}), press({floor: 'refused'}), press({verb: 'tell_person', floor: 'none'}), press({signal: 'failed'}), null]) assert.equal(needsSecondAsk(move), false, JSON.stringify(move));
});

test('each verb has its effect, checked right after acting; no effect is a failure', () => {
  const apply = press();
  assert.equal(effectOf(apply, {form: true}), 'worked', 'an apply press: a form');
  assert.equal(effectOf(apply, {navigated: true, fields: 4}), 'worked', 'or a new page WITH fields');
  assert.equal(effectOf(apply, {navigated: true, fields: 0}), 'failed', 'a new page with no fields is not the application');
  assert.equal(effectOf(apply, {}), 'failed');
  const next = press({pressKind: 'continue'});
  assert.equal(effectOf(next, {changed: true}), 'worked', 'a continue press: the page changed');
  assert.equal(effectOf(next, {changed: true, requiredLost: 1}), 'failed', 'and no required value was lost');
  assert.equal(effectOf(next, {}), 'failed');
  const fill = {verb: 'fill'};
  assert.equal(effectOf(fill, {valueStayed: true}), 'worked');
  assert.equal(effectOf(fill, {valueStayed: false}), 'failed');
  assert.equal(effectOf({verb: 'tell_person'}, {}), 'none', 'telling the person has no page effect to check');
});
