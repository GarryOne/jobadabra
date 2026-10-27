// Every Free AI screen says its AI is a bit weaker (owner, 27 Oct 2026): the engine chooser's Free card, the one-time hint and the Plan card's Free column all carry the shared words.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {HINT, TEXT} from '../renderer/ai-engine-view.js';
import {PLAN_CHOICES} from '../renderer/plan-view.js';
import {FREE_WEAKER, FREE_WEAKER_SHORT} from '../renderer/ai-tier-words.js';

const weaker = /a bit weaker/i;

test('the Free card, the hint and the Plan card each say the AI is a bit weaker', () => {
  assert.ok(weaker.test(FREE_WEAKER) && weaker.test(FREE_WEAKER_SHORT));
  assert.ok(TEXT.free.text.includes(FREE_WEAKER), 'engine chooser: Free card');
  assert.match(TEXT.free.short, weaker, 'engine chooser: short line');
  assert.match(HINT.text, weaker, 'hint after Free-written text');
  assert.match(PLAN_CHOICES.find(choice => choice.id === 'free').text, weaker, 'Plan card: Free column');
});

test('Pro never claims to be weaker', () => {
  assert.doesNotMatch(PLAN_CHOICES.find(choice => choice.id === 'pro').text, weaker);
});
