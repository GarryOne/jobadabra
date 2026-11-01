// The acted presses of a CI pool run (lib/pool-acted.mjs; spec 2026-10-12-one-next-move.md phase 3 step 2 "press"): each "dead end fallback (acted)" line is judged by its EFFECT: worked (a form, or a new page with
// fields), failed, and WORSE when the next page the run judged is an account page (a sign-in or password step) or the row's final reading left the application. Pooled across doors; per-door counts are the kill switch.
import assert from 'node:assert/strict';
import test from 'node:test';
import {actedTable, actedOf} from '../../lib/pool-acted.mjs';

const at = '2026-10-14T01:00:00.000Z';
const acted = fields => `${at} [extension] fill: dead end fallback (acted) ${JSON.stringify({shadow: false, why: 'no-form', number: 3, pressKind: 'apply', ms: 900, ...fields})}`;
const kind = name => `${at} [extension] fill: page kind: ${name} ${JSON.stringify({by: 'ai'})}`;

test('an acted press is read with its door, effect, and the next page kind the run judged', () => {
  const log = [kind('posting'), acted({door: 4, effect: 'worked'}), kind('form')].join('\n');
  assert.deepEqual(actedOf(log), [{door: 4, why: 'no-form', effect: 'worked', pressKind: 'apply', ms: 900, next: 'form'}]);
  assert.deepEqual(actedOf(`${kind('posting')}\n${acted({door: 5, effect: 'failed'})}`), [{door: 5, why: 'no-form', effect: 'failed', pressKind: 'apply', ms: 900, next: ''}]);
  assert.deepEqual(actedOf('nothing here'), []);
});

test('worse by effect: the press led to an account page, or the row ended away from the application; worked and failed are counted apart', () => {
  const rows = [
    {row: 'a', reached: 'form', log: [acted({door: 1, effect: 'worked'}), kind('form')].join('\n')},
    {row: 'b', reached: 'account', log: [acted({door: 1, effect: 'worked'}), kind('account-form')].join('\n')},
    {row: 'c', reached: 'posting', log: [acted({door: 1, effect: 'failed'})].join('\n')},
    {row: 'd', reached: 'left', log: [acted({door: 2, why: 'other', effect: 'worked'}), kind('posting')].join('\n')}];
  const table = actedTable(rows);
  assert.equal(table.acted, 4);
  assert.deepEqual([table.worked, table.failed, table.worse.length], [3, 1, 2]);
  assert.deepEqual(table.worse.map(item => item.row), ['b', 'd']);
  assert.equal(table.unblockRate, 0.25, 'unblocked = worked and not worse: 1 of 4; a press that led to a sign-in page worked on the page but did not unblock');
  assert.deepEqual(table.byDoor, {'no-form': {acted: 3, worked: 2, failed: 1, worse: 1}, other: {acted: 1, worked: 1, failed: 0, worse: 1}});
  assert.deepEqual(actedTable([]), {acted: 0, worked: 0, failed: 0, worse: [], unblockRate: 0, byDoor: {}});
});
