// The Focus line for "Allow in Incognito": shown only when the extension lacks the switch and sites wait for it. Guard for pages/focus-incognito.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {waitingOf, lineOf} from '../renderer/pages/incognito-rows.js';

test('the line shows only with the setting on, the switch missing and sites waiting', () => {
  const base = {refusedNeedsIncognito: true, refusedIncognitoWaiting: ['a.ch', 'b.ch']};
  assert.equal(waitingOf(base), 2);
  assert.equal(waitingOf({...base, refusedNeedsIncognito: false}), 0);
  assert.equal(waitingOf({...base, refusedIncognitoWaiting: []}), 0);
  assert.equal(waitingOf(undefined), 0);
  assert.equal(lineOf(1), '1 site needs one Chrome switch to be read');
  assert.equal(lineOf(3), '3 sites need one Chrome switch to be read');
});
