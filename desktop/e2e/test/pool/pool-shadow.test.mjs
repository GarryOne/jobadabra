// The shadow question's agree / would_act / worse table (lib/pool-shadow.mjs; spec 2026-10-12-one-next-move.md switch-on criteria): a real stop joined by its door id to the question asked at it, judged from the stop's
// own ending; silent shadow notices are not stops; a stop with no question line is "not asked", never a guess.
import assert from 'node:assert/strict';
import test from 'node:test';
import {personPrecision, shadowTable, stopsOf, verdictOf} from '../../lib/pool-shadow.mjs';

const at = '2026-10-13T00:00:00.000Z';
const stop = (why, fields) => `${at} [extension] fill: dead end: ${why} ${JSON.stringify(fields)}`;
const asked = (fields, note = '') => `${at} [extension] fill: dead end fallback (shadow)${note ? `: ${note}` : ''} ${JSON.stringify({shadow: true, ...fields})}`;

test('a stop is joined to its question by the door id, never by order or words', () => {
  const log = [stop('account', {door: 1, ending: 'unresolved', host: 'a.example'}), stop('other', {door: 2, ending: 'unresolved'}),
    asked({door: 2, actWhy: 'agreed', wouldAct: true, agree: true, confidence: 0.9, verb: 'press', number: 3, usd: 0.0008}), asked({door: 1, actWhy: 'person', wouldAct: false, confidence: -1, usd: 0.0004})].join('\n');
  const found = stopsOf(log);
  assert.deepEqual(found.map(item => [item.door, item.why, item.asked, item.wouldAct, item.actWhy]), [[1, 'account', 'asked', false, 'person'], [2, 'other', 'asked', true, 'agreed']]);
});

test('the verdicts: not asked, agree, would_act (a move where the stop made none), worse (a move where the page was handed to the person)', () => {
  const base = {asked: 'asked', wouldAct: false, ending: 'unresolved'};
  assert.equal(verdictOf({...base, asked: 'asked already'}), 'not_asked');
  assert.equal(verdictOf({...base, asked: 'missing'}), 'not_asked');
  assert.equal(verdictOf(base), 'agree');
  assert.equal(verdictOf({...base, wouldAct: true}), 'would_act');
  assert.equal(verdictOf({...base, wouldAct: true, ending: 'handed'}), 'worse');
  assert.equal(verdictOf({...base, ending: 'handed'}), 'agree', 'not acting where a person is needed is the stop\'s own answer');
});

test('the table: silent shadow notices are not stops; a stop with no question line is not asked; worse rows are named', () => {
  const rows = [{row: 'r1', log: [stop('no-form', {door: 1, ending: 'handed'}), asked({door: 1, wouldAct: true, actWhy: 'agreed', usd: 0.001}),
    `${at} [extension] fill: dead end: silent ${JSON.stringify({shadow: true, silentMs: 30000})}`].join('\n')},
  {row: 'r2', log: [stop('account', {door: 1, ending: 'unresolved'}), asked({door: 1, wouldAct: true, actWhy: 'agreed', usd: 0.0004}), stop('account', {door: 2, ending: 'unresolved'})].join('\n')}];
  const table = shadowTable(rows);
  assert.equal(table.total, 3);
  assert.deepEqual(table.byWhy, {'no-form': {agree: 0, would_act: 0, worse: 1, not_asked: 0}, account: {agree: 0, would_act: 1, worse: 0, not_asked: 1}});
  assert.deepEqual(table.worse, [{row: 'r1', door: 1, why: 'no-form'}]);
  assert.deepEqual(table.would_act, [{row: 'r2', door: 1, why: 'account'}]);
  assert.equal(table.usd, 0.0014);
});

test('a silent stop is a stop of its own kind, asked like any other; a move that would act at an account page is not judged here (the acting run judges it by its effect)', () => {
  const kind = name => `${at} [extension] fill: page kind: ${name} ${JSON.stringify({by: 'ai'})}`;
  const silent = door => `${at} [extension] fill: dead end: silent ${JSON.stringify({shadow: true, door, ending: 'unresolved', host: 'a.example', kind: 'required_down', silentMs: 30500})}`;
  const rows = [{row: 'r', log: [kind('account'), silent(1), asked({door: 1, wouldAct: true, actWhy: 'acts'}),
    kind('account-form'), silent(2), asked({door: 2, wouldAct: false, actWhy: 'unsure'}),
    kind('posting'), silent(3), asked({door: 3, wouldAct: true, actWhy: 'acts'})].join('\n')}];
  const table = shadowTable(rows);
  assert.deepEqual(table.byWhy.silent, {agree: 1, would_act: 2, worse: 0, not_asked: 0}, 'handing to the person = agree; a would-act move = to act (unjudged), at an account page too');
  assert.deepEqual(table.worse, []);
  assert.equal(stopsOf(rows[0].log)[0].page, 'account', 'the page kind stays on the stop');
});

test('the person verb: precision on the pooled stops, judged by where the row ended (a row that went on to the form made "person" wrong)', () => {
  const said = (door, verb, confidence) => asked({door, verb, confidence, wouldAct: false, actWhy: 'person'});
  const rows = [
    {row: 'a', reached: 'account', log: [stop('other', {door: 1, ending: 'unresolved'}), said(1, 'tell_person', 0.9)].join('\n')},
    {row: 'b', reached: 'form', log: [stop('other', {door: 1, ending: 'unresolved'}), said(1, 'tell_person', 0.9)].join('\n')},
    {row: 'c', reached: 'form', log: [stop('other', {door: 1, ending: 'unresolved'}), said(1, 'tell_person', 0.5)].join('\n')},
    {row: 'd', log: [stop('other', {door: 1, ending: 'unresolved'}), said(1, 'tell_person', 0.9)].join('\n')},
    {row: 'f', reached: 'form', log: [stop('other', {door: 1, ending: 'unresolved'}), asked({door: 1}, 'asked already'), `${at} [extension] fill: dead end fallback (picture) ${JSON.stringify({shadow: false, door: 1, why: 'other', look: 'ask_person', ms: 5})}`].join('\n')},
    {row: 'e', reached: 'posting', log: [stop('other', {door: 1, ending: 'unresolved'}), said(1, 'press', 0.9)].join('\n')}];
  assert.deepEqual(personPrecision(rows), {answers: 5, judged: 4, right: 1, wrong: 3, wrongConfident: 2, unjudged: 1});
  assert.deepEqual(personPrecision([]), {answers: 0, judged: 0, right: 0, wrong: 0, wrongConfident: 0, unjudged: 0});
});
