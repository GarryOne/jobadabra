// lib/lost-answers.mjs on the logs of 14 Oct 2026: 5afa5a8's failing run (answers, then 41 s of nothing, then a silent dead end) and a run that went on typing.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {lostAnswers} from '../../lib/lost-answers.mjs';

const answered = '23:47:50.984Z [fill] Claude answered 4 of 4 question(s) {"fields":4,"returned":4,"kept":4}';
test('answers kept, then only a silent dead end: lost', () => {
  const log = ['23:47:47.889Z [extension] fill: first fields filled {"waiting":4}', answered, '23:48:01.000Z [extension] worker: kept alive {}',
    '23:48:32.779Z [extension] fill: dead end: silent {"kind":"navigated","silentMs":41528}'].join('\n');
  assert.equal(lostAnswers(log).lost, true);
  assert.equal(lostAnswers([answered].join('\n')).lost, true, 'nothing after the answers at all');
});
test('answers kept, then the fill went on: not lost; no answers or none kept: not lost', () => {
  assert.equal(lostAnswers([answered, '[extension] fill: a menu showed no choice that matched {}', '[extension] fill: dead end: silent {}'].join('\n')).lost, false);
  assert.equal(lostAnswers('[extension] fill: first fields filled {}').lost, false);
  assert.equal(lostAnswers('[fill] Claude answered 0 of 2 question(s) {"kept":0}\n[extension] fill: dead end: silent {}').lost, false);
});
