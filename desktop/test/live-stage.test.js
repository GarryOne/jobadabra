// The live view never shows a broken image: until a picture has been painted the stage says what is going on, and when main refuses the page it says why and offers Try again
// (owner screenshot, 28 Oct 2026: "let's have a nicer UI handling when we cannot show the live preview for some reason, instead of this broken image").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stageState} from '../renderer/live-frames.js';

test('a painted picture wins; before one, an open ask is "opening", a refusal is "unavailable" with its reason, and nothing is a broken image', () => {
  assert.deepEqual(stageState({shown: true, error: 'x'}), {kind: 'picture'}, 'a picture on screen is never covered, even after a later refusal');
  assert.equal(stageState({shown: false, error: ''}).kind, 'waiting');
  const refused = stageState({shown: false, error: 'This application\'s hidden form is not open.'});
  assert.equal(refused.kind, 'unavailable');
  assert.equal(refused.title, 'The live page is not available right now');
  assert.equal(refused.text, 'This application\'s hidden form is not open.');
  assert.equal(refused.retry, true, 'the person can ask again');
  assert.match(stageState({shown: false, error: ''}).title, /Opening the page/);
});

test('every non-picture state has words for the person and none is empty', () => {
  for (const state of [{shown: false, error: ''}, {shown: false, error: 'The demo app has no hidden browser.'}]) {
    const out = stageState(state);
    assert.ok(out.title.length > 5, out.kind);
  }
});
