// "On its recording" counts the asks the build makes (lib/own-asks.mjs), in every place that states it: isSame (the replay gate) and onRecording (verify-judge).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {onOwnAsks} from '../../lib/own-asks.mjs';
import {isSame} from '../../replay-records.mjs';
import {onRecording} from '../../lib/verify-judge.mjs';

const net = (hit, extra = 0, notRecorded = 0) => ({hit, extra, notRecorded});
const outcome = {reached: 'form', filled: 8, left: 3};

test('the old build hits all its keys, the new build only its own: both are on the recording; an extra ask, a missing site request or no answered ask is not', () => {
  const memo = 9;   // 7 answers of the old build + 2 the new build added; each build asks a subset
  const cases = [['the old build asks 7 of its keys', net(7), true], ['the new build asks 7 and none of 2 old ones', net(7), true], ['every key hit', net(9), true],
    ['an ask the memo lacks', net(7, 1), false], ['a site request not recorded', net(7, 0, 1), false], ['stopped before any ask', net(0), false]];
  for (const [what, network, expected] of cases) {
    assert.equal(isSame({network, live: {asks: memo}}), expected, `isSame: ${what}`);
    assert.equal(onRecording({outcome, network, live: {asks: memo}}), expected, `onRecording: ${what}`);
  }
  assert.equal(onOwnAsks(net(0), 0), true, 'a memo with no asks: nothing to answer');
  assert.equal(onOwnAsks(null, 3), false, 'no replay result');
  assert.equal(onRecording({network: net(7), live: {asks: memo}}), false, 'no outcome: not a replay result');
});
