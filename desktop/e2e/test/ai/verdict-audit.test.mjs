// The weekly verdict audit: a random sample of the week's verdicts, boxes to tick, and the score read back.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {auditBody, auditScore, sampleVerdicts} from '../../lib/verdict-audit.mjs';
import {verdictComment} from '../../lib/verdict-comment.mjs';

const now = Date.parse('2026-10-10T12:00:00Z');
const issue = (number, word, at) => ({number, title: `[auto-ui] jobs: thing ${number}`, comments: [{body: verdictComment(`${word}\nWhy: reason ${number}.`), createdAt: at}]});

test('only the week\'s verdicts are sampled, from issues and from the noise register, at most five', () => {
  const issues = [issue(1, 'real', '2026-10-09T00:00:00Z'), issue(2, 'false-positive', '2026-09-20T00:00:00Z'), ...[3, 4, 5, 6, 7].map(n => issue(n, 'needs-human', '2026-10-08T00:00:00Z'))];
  const register = [{id: 'x', view: 'focus', title: 'Ticker cut', word: 'false-positive', why: 'it scrolls', date: '2026-10-07'}];
  const all = sampleVerdicts({issues, register, now, n: 10, pick: () => 0});
  assert.deepEqual(all.map(item => item.key).sort(), ['i1', 'i3', 'i4', 'i5', 'i6', 'i7', 'rx']);
  assert.equal(sampleVerdicts({issues, register, now}).length, 5);
  assert.equal(all.find(item => item.key === 'i1').why, 'reason 1.');
});

test('the ticks are read back as a score', () => {
  const items = [{key: 'i1', word: 'real', what: 'a', why: 'w', where: '#1'}, {key: 'i2', word: 'real', what: 'b', why: 'w', where: '#2'}, {key: 'i3', word: 'harness', what: 'c', why: 'w', where: '#3'}];
  let body = auditBody(items, {right: 4, wrong: 1, size: 5});
  assert.match(body, /Last audit:\*\* 4 of 5 right\./);
  body = body.replace('- [ ] 👍 right <!-- audit:i1:right -->', '- [x] 👍 right <!-- audit:i1:right -->').replace('- [ ] 👎 wrong <!-- audit:i2:wrong -->', '- [X] 👎 wrong <!-- audit:i2:wrong -->');
  assert.deepEqual(auditScore(body), {right: 1, wrong: 1, size: 3});
});
