// Focus → Suggestions' answers (lib/suggestion-answers.js): Not now and Not true are kept in 💡 Insights where src/suggestions.answered reads
// them (a finding on its own row, a computed entry on one Suggestion row per key), and Reports leaves set-aside rows out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {ANSWER_CATEGORY, NOT_NOW_DAYS, answer, hiddenUntil, visibleInReports} from '../lib/suggestion-answers.js';

const NOW = Date.parse('2026-10-28T09:00:00Z');
const store = rows => {
  const writes = [];
  const call = async (_s, entity, method, kwargs) => {
    if (method === 'list') return rows.filter(row => !kwargs.category || row.category === kwargs.category);
    writes.push([method, kwargs]);
    return {};
  };
  return {call, writes};
};

test('the engine and the app count Not now the same: 14 days, one category for answer rows', () => {
  const engine = fs.readFileSync(new URL('../../src/suggestions.py', import.meta.url), 'utf8');
  const data = fs.readFileSync(new URL('../../src/ai/insights_data.py', import.meta.url), 'utf8');
  assert.match(engine, new RegExp(`^NOT_NOW_DAYS = ${NOT_NOW_DAYS}\\b`, 'm'));
  assert.match(data, new RegExp(`^ANSWER_CATEGORY = '${ANSWER_CATEGORY}'`, 'm'));
  assert.equal(hiddenUntil(NOW), '2026-11-11');
});

test('a finding keeps the answer on its own row, merged over its other fields', async () => {
  const {call, writes} = store([{id: 'w1', category: 'Weekly report', fields: {action: 'Apply early', feedback: 'Useful'}}]);
  assert.deepEqual(await answer({}, {key: 'row:w1', title: 'Your week'}, 'Not now', {call, now: NOW}), {ok: true});
  assert.deepEqual(writes, [['update', {insight_id: 'w1', fields: {fields: {action: 'Apply early', feedback: 'Useful', state: 'Not now', hidden_until: '2026-11-11'}}}]]);
  assert.equal((await answer({}, {key: 'row:gone'}, 'Not true', {call, now: NOW})).ok, false);
});

test('a computed entry gets one answer row per key: added once, then updated', async () => {
  const first = store([]);
  await answer({}, {key: 'tune:a|b', title: '2 changes your results support'}, 'Not true', {call: first.call, now: NOW});
  assert.deepEqual(first.writes, [['add', {record: {day: '2026-10-28', category: 'Suggestion', title: '2 changes your results support',
    fields: {state: 'Not true', hidden_until: '', input_hash: 'tune:a|b'}}}]]);
  const again = store([{id: 'a1', category: 'Suggestion', fields: {state: 'Not now', hidden_until: '2026-10-20', input_hash: 'tune:a|b'}}]);
  await answer({}, {key: 'tune:a|b'}, 'Not now', {call: again.call, now: NOW});
  assert.deepEqual(again.writes, [['update', {insight_id: 'a1', fields: {day: '2026-10-28', fields: {state: 'Not now', hidden_until: '2026-11-11', input_hash: 'tune:a|b'}}}]]);
});

test('a Not true on role ideas keeps their words in the row\'s Data, and a second one adds to them (#2350, Gitar: they held on one Mac only)', async () => {
  const first = store([]);
  await answer({}, {key: 'ideas:k1', title: 'Add Cashier', aside: ['caissier', 'vendeur']}, 'Not true', {call: first.call, now: NOW});
  assert.deepEqual(first.writes[0][1].record.fields, {state: 'Not true', hidden_until: '', data: '{"aside":["caissier","vendeur"]}', input_hash: 'ideas:k1'});
  const again = store([{id: 'a1', category: 'Suggestion', fields: {state: 'Not true', data: '{"aside":["caissier"]}', input_hash: 'ideas:k1'}}]);
  await answer({}, {key: 'ideas:k1', aside: ['retouche']}, 'Not true', {call: again.call, now: NOW});
  assert.equal(again.writes[0][1].fields.fields.data, '{"aside":["caissier","retouche"]}');
  const later = store([]);
  await answer({}, {key: 'ideas:k2', aside: ['caissier']}, 'Not now', {call: later.call, now: NOW});
  assert.equal(later.writes[0][1].record.fields.data, undefined, 'a Not now sets nothing aside');
});

test('only Not now and Not true are a person\'s answers', async () => {
  const {call, writes} = store([]);
  for (const state of ['Done', 'Stale', 'Hide', '']) assert.equal((await answer({}, {key: 'tune:x'}, state, {call})).ok, false, state);
  assert.deepEqual(writes, []);
});

test('Reports leaves out answer rows and insights set aside, until a Not now ends', () => {
  const day = (state, until = '') => ({category: 'Skills', fields: {state, hidden_until: until}});
  assert.equal(visibleInReports({category: 'Suggestion', fields: {state: 'Not now'}}, NOW), false);
  assert.equal(visibleInReports(day('Not true'), NOW), false);
  assert.equal(visibleInReports(day('Not now', '2026-11-11'), NOW), false);
  assert.equal(visibleInReports(day('Not now', '2026-10-28'), NOW), true);
  assert.equal(visibleInReports(day(''), NOW), true);
  assert.equal(visibleInReports({category: 'Weekly report', fields: {}}, NOW), true);
});
