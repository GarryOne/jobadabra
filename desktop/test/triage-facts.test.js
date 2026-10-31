// The triage fact rule trusts only required answers with saved provenance, never guesses or drafts.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {allFactsSavedOf} from '../../extension/triage-facts.js';

const field = (name, extra = {}) => ({field: name, type: 'text', required: true, ...extra});
const saved = (name, extra = {}) => ({field: name, use: 'fill', fact: 'other_saved', category: 'normal', ...extra});

for (const [name, answers, expected] of [
  ['all saved', [saved('a'), saved('b')], true],
  ['one proposal', [saved('a'), saved('b', {use: 'propose'})], false],
  ['no fact', [saved('a'), saved('b', {fact: 'none'})], false],
  ['missing fact', [saved('a'), saved('b', {fact: undefined})], false],
  ['written answer', [saved('a'), saved('b', {category: 'written'})], false],
  ['legal answer', [saved('a'), saved('b', {category: 'legal'})], false],
  ['demographic answer', [saved('a'), saved('b', {category: 'demographic'})], false],
  ['guess', [saved('a'), saved('b', {guess: true})], false],
  ['required answer missing', [saved('a')], false],
  ['failed or dropped call', null, null],
]) test(name, () => {
  assert.equal(allFactsSavedOf({form: [field('a'), field('b')], contactFields: [], answers}), expected);
});

test('profile contact entries cover required fields; optional questions and uploads are ignored', () => {
  assert.equal(allFactsSavedOf({form: [field('person'), field('cv', {type: 'file'}), field('optional', {required: false})], contactFields: new Set(['person']), answers: []}), true);
});

test('a readable form with zero required fields is saved', () => {
  assert.equal(allFactsSavedOf({form: [field('optional', {required: false})], contactFields: [], answers: []}), true);
});

test('no fields or an unreadable form stays unknown', () => {
  for (const form of [[], null, undefined]) assert.equal(allFactsSavedOf({form, contactFields: [], answers: []}), null);
});
