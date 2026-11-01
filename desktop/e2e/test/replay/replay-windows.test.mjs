// Guards the "must not happen" windows of the recorded cases: a case that only watches for something that must NOT happen waits out its whole window, so the window is the case's cost.
// A window under 15 s needs its numbers (when the extension decides, when the forbidden action would happen, the longest wait before it) and must be at least 5x the largest.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadCases} from '../../lib/page-replay.mjs';

const POSITIVE = ['told', 'filled', 'attached', 'judged', 'asked', 'pressed', 'gone'];

test('a short window on a "must not happen" case carries its measured numbers and a 5x margin', () => {
  const short = loadCases().filter(item => !POSITIVE.some(kind => (item.expect?.[kind] || []).length) && (item.expect?.seconds || 40) < 15);
  assert.ok(short.length >= 2, 'the trimmed cases exist');
  for (const item of short) {
    const why = item.windowWhy;
    assert.ok(why, `${item.name}: a window under 15 s needs windowWhy {decidesAt, forbiddenAt, longestWait, margin, control}`);
    for (const key of ['decidesAt', 'forbiddenAt', 'longestWait']) assert.equal(typeof why[key], 'number', `${item.name}: windowWhy.${key} is a number of seconds`);
    assert.ok(why.control && why.margin, `${item.name}: windowWhy says its margin and the control that still fails inside the window`);
    const slowest = Math.max(why.decidesAt, why.forbiddenAt, why.longestWait);
    assert.ok(item.expect.seconds >= 5 * slowest, `${item.name}: ${item.expect.seconds} s is less than 5x the slowest measured wait (${slowest} s)`);
  }
});

test('the tab loop of cookie-banner-links-1 shows only after the extension\'s 8 s wait: its window stays', () => {
  // the first press is at ~1 s, then the extension waits 8 s ("no form came") before it could press again: a window under ~9 s plus a margin would miss the loop
  const cookie = loadCases().find(item => item.name === 'cookie-banner-links-1');
  assert.ok(cookie.expect.seconds >= 15);
});
