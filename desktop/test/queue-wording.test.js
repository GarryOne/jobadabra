// Every fact the review queue asks is worded by its one question writer (lib/queue-wording.js), never typed (owner, 27 Oct 2026: contact questions "should not be
// hard-coded"; the six base facts "Yes, write them too"). The class: the base facts of lib/fact-catalog.js (kinds "missing" and "cvcheck") and the contact fields
// (kinds "contact" and "cvcheck"). Fails when a fact is added with a typed question or hint, or when a queue path words a fact itself. The AI is a fake (no spend).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as contactDetails from '../lib/contact.js';
import * as review from '../lib/details-review.js';
import * as missing from '../lib/missing-facts.js';
import {CATALOG} from '../lib/fact-catalog.js';
import {formatFor} from '../renderer/question-kind.js';

const plainCrypto = {encrypt: v => v, decrypt: v => v};
// Every base fact blocked a fill, so all six are asked today (beyond the daily cap), and a CV is there to read.
const fresh = () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-wording-')), plainCrypto);
  storage.saveSettings({store: 'sqlite', telemetry: false, missingFacts: {since: '2020-01-01'},
    questionVerdicts: Object.fromEntries(CATALOG.map(fact => [fact.id, {reuse: 'details', fact: fact.label, asked: 1, blocked: true}]))});
  fs.writeFileSync(storage.path('cv.pdf'), 'fake cv');
  return storage;
};
const listed = (request, tag) => [...(request.messages[0].content.match?.(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`))?.[1] || '').matchAll(/^(\w+):/gm)].map(each => each[1]);
// The writer words each field "Q-<field>"; the CV read proposes a nationality (a base fact) and a location (a contact field).
const fakeClient = (calls = []) => ({messages: {create: async request => {
  calls.push(request);
  const text = typeof request.messages[0].content === 'string' ? request.messages[0].content : '';
  if (/<empty>|<facts>/.test(text)) {
    const keys = [...listed(request, 'empty'), ...listed(request, 'facts')];
    return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({asks: keys.map(field => ({field, question: `Q-${field}`, hint: `H-${field}`, importance: 3, held: false}))})}]};
  }
  const answer = request.system.includes('job-application facts')
    ? {facts: [{id: 'nationality', value: 'Moldova', how: 'inferred', reason: 'Studied and worked only in Moldova'}]}
    : {proposals: [{field: 'location', value: 'Chișinău, Moldova', sure: false, source: 'cv', how: 'inferred'}]};
  return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(answer)}]};
}}});
const ZONE = fact => fact.kind === 'per_country';
const FACT_KINDS = new Set(['missing', 'cvcheck', 'contact']);
const factOf = item => { const ref = JSON.parse(item.key.slice(item.key.indexOf('{'))); return ref.field || ref.contact || ref.id || ref.fact; };   // the fact or field an item asks

test('a base fact is its schema only: no question or hint text in the catalogue', () => {
  for (const fact of CATALOG) assert.deepEqual(Object.keys(fact).sort(), ['home', 'id', 'kind', 'label'], `${fact.id}: words are generated, never typed (${Object.keys(fact)})`);
});

test('every fact the queue asks is worded by the question writer: all six base facts, each contact field, and the CV proposals', async () => {
  const storage = fresh();
  const items = (await review.pending(storage, {ai: {client: fakeClient()}})).filter(each => FACT_KINDS.has(each.details.kind));
  for (const item of items) assert.equal(item.question, `Q-${factOf(item)}`, `${item.details.kind} words its question itself: ${item.question}`);
  const asked = new Set(items.map(factOf));
  for (const fact of CATALOG) assert.equal(asked.has(fact.id), !ZONE(fact), `${fact.id}: asked unless a zone, which waits for Nationality (#2322): ${[...asked]}`);
  for (const field of ['first_name', 'last_name', 'email', 'phone', 'location']) assert.ok(asked.has(field), `${field} is asked: ${[...asked]}`);
  const permit = items.find(each => factOf(each) === 'nationality');
  assert.equal(permit.details.kind, 'cvcheck', 'a fact the CV proposes is checked there, once');
  assert.equal(permit.value, 'Moldova');
  assert.match(permit.hint, /only in Moldova/, 'a CV check keeps the AI\'s evidence as its hint');
  const notice = items.find(each => factOf(each) === 'notice');
  assert.equal(notice.hint, 'H-notice', 'a missing fact takes the writer\'s hint');
});

test('each base fact keeps its value kind and control; the writer is told the kind and words the catalogue once', async () => {
  const storage = fresh(), calls = [];
  const items = (await review.pending(storage, {ai: {client: fakeClient(calls)}})).filter(each => ['missing', 'cvcheck'].includes(each.details.kind));
  for (const fact of CATALOG.filter(each => !ZONE(each))) {
    const item = items.find(each => factOf(each) === fact.id);
    assert.deepEqual(item.format, formatFor({marked: {kind: fact.kind}}), `${fact.id} keeps its ${fact.kind} control`);
  }
  const writes = () => calls.filter(each => /<facts>/.test(typeof each.messages[0].content === 'string' ? each.messages[0].content : ''));
  assert.equal(writes().length, 1);
  for (const fact of CATALOG) assert.match(writes()[0].messages[0].content, new RegExp(`^${fact.id}: .*answer: ${fact.kind}$`, 'm'));
  await review.pending(storage, {ai: {client: fakeClient(calls)}});
  assert.equal(writes().length, 1, 'kept: a second list words nothing again');
});

test('no AI: a base fact is asked by its own name, with no typed hint', () => {
  const list = missing.pick(fresh(), [], {now: new Date('2026-10-27T09:00:00Z')});
  assert.equal(list.length, CATALOG.filter(each => !ZONE(each)).length, 'the zones wait for Nationality');
  for (const item of list) {
    assert.equal(item.question, item.label);
    assert.equal(item.hint, '');
  }
});

test('the contact wording asks a CV contact proposal and the empty fields alike', async () => {
  const storage = fresh();
  const items = await review.pending(storage, {ai: {client: fakeClient()}});
  const place = items.find(each => each.details.kind === 'cvcheck' && each.key.includes('"contact"'));
  assert.equal(place.question, 'Q-location');
  assert.ok(!items.some(each => each.details.kind === 'contact' && each.question === 'Q-location'), 'a field the CV proposes is not asked twice');
  assert.equal((await contactDetails.read(storage)).location || '', '', 'a proposal is never saved without Confirm');
});
