// The label that accepts a worse replay row (replay-accepts.mjs): who may accept, what a comment names, which PRs count. Pure: gh is a fake.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {acceptFor, entriesOf, readAccepts} from '../../replay-accepts.mjs';

const pr = (number, labels, comments) => ({number, title: `PR ${number}`, labels: labels.map(name => ({name})), comments: comments.map(([body, authorAssociation = 'OWNER']) => ({body, authorAssociation}))});

test('only a labeled PR with a trusted Replay-accept comment gives an entry; a labeled PR without one gives an empty reason', () => {
  const entries = entriesOf([pr(1, ['replay-accepted'], [['Replay-accept: field moved']]), pr(2, [], [['Replay-accept: no label']]), pr(3, ['replay-accepted'], []),
    pr(4, ['replay-accepted'], [['Replay-accept: a stranger said so', 'NONE']]), pr(5, ['replay-accepted'], [['looks good\nReplay-accept: row x — why', 'COLLABORATOR']])]);
  assert.deepEqual(entries, [{pr: 1, text: 'field moved'}, {pr: 3, text: ''}, {pr: 4, text: ''}, {pr: 5, text: 'row x — why'}]);
});

test('a named entry accepts that row only; a plain one all; no reason says so', () => {
  const names = ['a -> b: x', 'c'];
  assert.deepEqual(acceptFor('a -> b: x', [{pr: 1, text: 'a -> b: x — new field'}], names), {pr: 1, reason: 'new field'});
  assert.equal(acceptFor('c', [{pr: 1, text: 'a -> b: x — new field'}], names), null);
  assert.deepEqual(acceptFor('c', [{pr: 2, text: 'all moved — on purpose'}], names), {pr: 2, reason: 'all moved — on purpose'});
  assert.deepEqual(acceptFor('c', [{pr: 3, text: ''}], names), {pr: 3, reason: ''});
  assert.equal(acceptFor('c', [], names), null);
});

test('only PRs merged after the baseline sha count; no sha, no accepts; a failing gh is no accept', () => {
  const calls = [], list = [{...pr(10, ['replay-accepted'], [['Replay-accept: ok']]), mergeCommit: {oid: 'new'}}, {...pr(11, ['replay-accepted'], [['Replay-accept: old']]), mergeCommit: {oid: 'old'}}];
  const fetcher = args => { calls.push(args[0]); return args[0] === 'api' ? 'new\n' : JSON.stringify(list); };
  const got = readAccepts('base', {env: {GITHUB_REPOSITORY: 'o/r'}, fetcher});
  assert.deepEqual([got.merged.map(item => item.number), got.entries], [[10], [{pr: 10, text: 'ok'}]]);
  assert.deepEqual(readAccepts('', {env: {}, fetcher}), {merged: [], entries: []});
  assert.deepEqual(readAccepts('base', {env: {GITHUB_REPOSITORY: 'o/r'}, fetcher: () => { throw new Error('boom'); }}), {merged: [], entries: []});
});
