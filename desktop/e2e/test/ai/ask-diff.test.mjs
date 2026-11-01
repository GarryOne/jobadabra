// lib/ask-diff.mjs: the lines where a replay's ask differs from the live run's, per route in order.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {askDiff} from '../../lib/ask-diff.mjs';

const live = [{route: '/extension/account-judge', request: {phase: 'form', sketch: {controls: [{label: 'Name', state: 'filled'}, {label: 'Email', state: 'filled'}], buttons: ['Apply']}}}];
const ask = sketch => [{route: '/extension/account-judge', body: JSON.stringify({phase: 'form', sketch, tab: 7})}];

test('the same ask has no difference; a key only the replay has (tab) is not compared', () => {
  assert.deepEqual(askDiff(live, ask({controls: [{label: 'Name', state: 'filled'}, {label: 'Email', state: 'filled'}], buttons: ['Apply']})), []);
});

test('a control state, a missing button and an extra control are named with their path', () => {
  const lines = askDiff(live, ask({controls: [{label: 'Name', state: 'filled'}, {label: 'Email', state: 'empty'}, {label: 'Phone', state: 'empty'}], buttons: []}));
  assert.ok(lines.some(line => line.includes('sketch.controls[1].state: live filled | now empty')));
  assert.ok(lines.some(line => line.includes('sketch.buttons[0]: live Apply | now undefined')));
  assert.ok(lines.some(line => line.includes('sketch.controls[2]: live undefined | now {')));
});

test('an ask the live run made and the replay did not is said; asks pair by route in order', () => {
  assert.match(askDiff(live, [])[0], /live asked, the replay never did/);
  assert.equal(askDiff([...live, ...live], [...ask({controls: [], buttons: []}), ...ask({controls: [{label: 'Name', state: 'filled'}, {label: 'Email', state: 'filled'}], buttons: ['Apply']})]).every(line => line.includes('#1')), true, 'only the first pair differs');
});
