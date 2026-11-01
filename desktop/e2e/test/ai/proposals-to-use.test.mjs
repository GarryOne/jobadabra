// Which proposals a harness run accepts (lib/proposals-to-use.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import {proposalsToUse} from '../../lib/proposals-to-use.mjs';

const states = [{id: 's1', proposals: [
  {label: 'Street', value: 'Main St 1', options: []},
  {label: 'How Did You Hear About Us?', value: 'linkedin', options: ['Referral', 'LinkedIn']},
  {label: 'Country', value: 'Atlantis', options: ['Switzerland']},
  {label: 'Phone', value: '', key: 'phone', options: []},
]}];

test('takes a free answer as it is and a menu answer as the form\'s own choice', () => {
  const {use} = proposalsToUse(states);
  assert.deepEqual(use.map(item => [item.label, item.value]), [['Street', 'Main St 1'], ['How Did You Hear About Us?', 'LinkedIn']]);
});
test('says which menu proposal no choice matched, and leaves a contact key alone', () => {
  const {skipped} = proposalsToUse(states);
  assert.deepEqual(skipped.map(item => item.label), ['Country']);
});
test('each answer is taken once per session', () => {
  const first = proposalsToUse(states);
  const again = proposalsToUse(states, new Set(first.use.map(item => item.key)));
  assert.equal(again.use.length, 0);
});
