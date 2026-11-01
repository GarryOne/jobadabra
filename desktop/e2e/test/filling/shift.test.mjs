// A page that moves by itself after it is ready is a finding; a click's own shift, a tiny one and a quiet page are not.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {lateShiftFindings} from '../../lib/shift.mjs';

const jump = (at, value, px, extra = {}) => ({at, value, px, input: false, node: 'div#strategy-coverage', ...extra});

test('a card that pushes the page down five seconds after it was ready is a finding', () => {
  const [finding] = lateShiftFindings({view: 'strategy', since: 1000, shifts: [jump(6200, 0.14, 150)]});
  assert.equal(finding.kind, 'late-shift');
  assert.match(finding.detail, /content on strategy moved by itself 5.2s after the page was ready \(shift score 0.14/);
  assert.match(finding.detail, /div#strategy-coverage/);
});

test('what a person caused, what is small, and what happened before ready are not findings', () => {
  assert.deepEqual(lateShiftFindings({view: 'jobs', since: 1000, shifts: [jump(3000, 0.2, 200, {input: true})]}), []);
  assert.deepEqual(lateShiftFindings({view: 'jobs', since: 1000, shifts: [jump(3000, 0.004, 12)]}), []);
  assert.deepEqual(lateShiftFindings({view: 'jobs', since: 5000, shifts: [jump(900, 0.3, 300)]}), []);
  assert.deepEqual(lateShiftFindings({view: 'jobs', since: 1000, shifts: []}), []);
});

test('several small jumps that add up are one finding', () => {
  const found = lateShiftFindings({view: 'actions', since: 0, shifts: [jump(2000, 0.03, 60), jump(2600, 0.03, 60)]});
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /2 jumps/);
});
