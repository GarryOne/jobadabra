// The "missing" kind of the one review queue (owner, 18 Oct 2026: "most important first, step by step, don't overwhelm"): the order comes from the queue's
// own score, at most PER_DAY new facts a day, a fact that blocked a fill at once, "Don't keep" is final, and the asking stops after FRESH_DAYS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as missing from '../lib/missing-facts.js';
import * as review from '../lib/details-review.js';

const plainCrypto = {encrypt: v => v, decrypt: v => v};
const fresh = settings => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-missing-')), plainCrypto); s.saveSettings({store: 'sqlite', telemetry: false, ...settings}); return s; };
const D1 = new Date('2026-10-18T09:00:00Z'), D2 = new Date('2026-10-19T09:00:00Z'), D20 = new Date('2026-11-10T09:00:00Z');
const ids = list => list.map(each => each.id);

test('a fresh install is asked 3 facts, in the catalogue order, and the same 3 all day', () => {
  const storage = fresh({});
  assert.deepEqual(ids(missing.pick(storage, [], {now: D1})), ['nationality', 'notice', 'start'], 'a zone waits for Nationality (#2322)');
  assert.deepEqual(ids(missing.pick(storage, ['Nationality'], {now: new Date('2026-10-18T18:00:00Z')})), ['notice', 'start'], 'an answered one leaves; none is added the same day');
});

test('the next day brings the facts not asked yet, and the ones still open come back after them', () => {
  const storage = fresh({});
  missing.pick(storage, [], {now: D1});
  assert.deepEqual(ids(missing.pick(storage, [], {now: D2})), ['salary', 'languages', 'nationality']);
  assert.deepEqual(ids(missing.pick(fresh({}), ['Nationality', 'EU / EEA + Switzerland'], {now: D1})), ['zone_uk', 'zone_us', 'notice'], 'with Nationality held, a zone it did not open is asked');
});

test('what forms asked most comes first (the queue\'s factScore): a fact a blocked fill needs is on top and is asked beyond the daily cap', () => {
  const storage = fresh({questionVerdicts: {a: {reuse: 'details', fact: 'Salary expectation', asked: 4}, b: {reuse: 'details', fact: 'Languages', asked: 1, blocked: true}, c: {reuse: 'details', fact: 'Notice period', asked: 2}}});
  const list = missing.pick(storage, [], {now: D1});
  assert.deepEqual(ids(list), ['languages', 'salary', 'notice', 'nationality']);
  assert.ok(list[0].score >= 1e6, 'blocked');
  assert.equal(list.length, 4, 'the blocked one is on top of the 3 of the day');
});

test('the facts nothing holds are listed for the question AI (value empty), except answered ones and ones the person never wants', () => {
  const storage = fresh({missingFacts: {never: ['salary'], covered: {sig: 'x', ids: ['nationality']}}});
  const labels = missing.listed(storage, ['Notice period']).map(fact => fact.label);
  assert.deepEqual(labels, ['EU / EEA + Switzerland', 'United Kingdom', 'United States', 'Earliest start date', 'Languages']);
  assert.ok(missing.listed(storage).every(fact => fact.value === ''));
});

test('"Don\'t keep" is final, and a fact the Profile or Your details holds is not asked', () => {
  const storage = fresh({});
  missing.never(storage, 'nationality');
  assert.ok(!ids(missing.pick(storage, ['Notice period'], {now: D1})).some(id => ['nationality', 'notice'].includes(id)));
});

test('after 14 days only the facts a fill is blocked on are asked', () => {
  const storage = fresh({questionVerdicts: {a: {reuse: 'details', fact: 'Salary expectation', asked: 1, blocked: true}}});
  missing.pick(storage, [], {now: D1});
  assert.deepEqual(ids(missing.pick(storage, [], {now: D20})), ['salary']);
});

test('answering a missing item with nothing keeps it away for good (the queue item leaves)', async () => {
  const storage = fresh({});
  const first = (await review.pending(storage, {now: D1})).find(each => each.details.kind === 'missing');
  assert.equal(first.details.source, 'Not filled in yet');
  assert.equal((await review.answer(storage, first.key, '')).ok, true);
  assert.ok(!(await review.pending(storage, {now: D2})).some(each => each.key === first.key));
});

const fake = (answer, calls = []) => ({client: {messages: {create: async request => { calls.push(request); return {content: [{type: 'text', text: JSON.stringify({covered: answer})}]}; }}}});

test('a saved line in other words answers a fact (by the AI), is asked once per set of labels, and an invented id keeps nothing', async () => {
  const storage = fresh({}), calls = [], labels = ['Staatsangehörigkeit', 'Kündigungsfrist'];
  assert.deepEqual(await missing.covered(storage, labels, {ai: fake(['nationality', 'notice', 'made-up'], calls)}), ['nationality', 'notice']);
  assert.deepEqual(await missing.covered(storage, labels, {ai: fake([], calls)}), ['nationality', 'notice'], 'kept: no second call');
  assert.equal(calls.length, 1);
  assert.ok(!/EU citizen|2 months/.test(JSON.stringify(calls[0])), 'labels only, never the values');
  assert.ok(!ids(missing.pick(storage, labels, {now: D1, covered: ['nationality', 'notice']})).some(id => ['nationality', 'notice'].includes(id)));
});

test('without an AI only a line with the fact\'s own label counts, and nothing is spent', async () => {
  const storage = fresh({});
  assert.deepEqual(await missing.covered(storage, ['Staatsangehörigkeit'], {ai: {}}), []);
  const calls = [];
  await missing.covered(storage, ['Notice period', 'Phone'], {ai: fake([], calls)});
  assert.ok(!/notice:/.test(calls[0].messages[0].content), 'a fact whose own label is saved is not sent to the AI');
});
