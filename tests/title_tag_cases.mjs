// Cases for tools/title-tag.mjs, run by tests/test_title_tag.py: an edit that drops the "[xx] " tag gets it back, every other edit is left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {restoredTitle, retitle} from '../tools/title-tag.mjs';

test('the tag of the old title is put back on a title that lost it (#2549)', () => {
  assert.equal(restoredTitle('[ac] 1/2 Class test sees the twin', 'Class test sees the twin; doc says how a test sets its port'), '[ac] Class test sees the twin; doc says how a test sets its port');
});

test('a title that still has a tag is left alone, whichever tag it is', () => {
  assert.equal(restoredTitle('[ac] Old words', '[ac] New words'), null);
  assert.equal(restoredTitle('[ac] Old words', '[27] New words'), null);
});

test('an old title without a tag, or an empty new title, restores nothing', () => {
  assert.equal(restoredTitle('Old words', 'New words'), null);
  assert.equal(restoredTitle(undefined, 'New words'), null);
  assert.equal(restoredTitle('[ac] Old words', '   '), null);
  assert.equal(restoredTitle('[ac] Old words', undefined), null);
});

test('retitle sets the title on that PR in that repo', () => {
  const calls = [];
  retitle('GarryOne/jobadabra', 2549, '[ac] Words', (...args) => calls.push(args));
  assert.deepEqual(calls, [['pr', 'edit', '2549', '--title', '[ac] Words', '-R', 'GarryOne/jobadabra']]);
});
