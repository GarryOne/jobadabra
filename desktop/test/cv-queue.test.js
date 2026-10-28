// What the CV states or implies, as "check it" items of the review queue (lib/cv-queue.js; owner, 27 Oct 2026): the base facts read by one AI call per CV file,
// the contact proposals the setup read left, a confirm saving into the right home, an old install read once. The AI is a fake (no spend).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as contactDetails from '../lib/contact.js';
import * as sections from '../lib/profile-sections.js';
import * as review from '../lib/details-review.js';
import * as cvQueue from '../lib/cv-queue.js';
import {ranked} from '../renderer/question-filter.js';

const plainCrypto = {encrypt: v => v, decrypt: v => v};
const fresh = () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cvq-')), plainCrypto);
  storage.saveSettings({store: 'sqlite', telemetry: false, missingFacts: {since: '2020-01-01'}});
  fs.writeFileSync(storage.path('cv.pdf'), 'fake cv');
  return storage;
};
// The AI's fixed answer: a work permit implied by citizenship and jobs, never stated.
const calls = [];
const client = {messages: {create: async request => {
  calls.push(request);
  if (typeof request.messages[0].content === 'string' && request.messages[0].content.startsWith('<facts>')) {   // the question writer for the base facts
    const ids = [...request.messages[0].content.matchAll(/^(\w+):/gm)].map(each => each[1]);
    return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({asks: ids.map(field => ({field, question: `Q-${field}`, hint: ''}))})}]};
  }
  if (request.system.includes('contact details are missing')) {   // the question writer: its own wording, a rating, and what the saved lines already answer
    const keys = [...request.messages[0].content.match(/<empty>\n([\s\S]*?)\n<\/empty>/)[1].matchAll(/^(\w+):/gm)].map(each => each[1]);
    return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({asks: keys.map(field => ({field, question: `Q-${field}`, hint: '', importance: field === 'last_name' ? 3 : field === 'github' ? 0 : 2, held: field === 'phone'}))})}]};
  }
  const text = JSON.stringify(request.system.includes('job-application facts')
    ? {facts: [{id: 'nationality', value: 'Moldova', how: 'inferred', reason: 'Studied and worked only in Moldova'}, {id: 'languages', value: 'Romanian (native), English', how: 'stated', reason: 'Language lines'}, {id: 'nope', value: 'x', how: 'stated', reason: ''},
      {id: 'zone_eu', value: 'EU citizen', how: 'inferred', reason: 'Moldova borders the EU'}]}
    : {proposals: [{field: 'first_name', value: 'Ana', sure: true, source: 'cv', how: 'stated'}, {field: 'location', value: 'Chișinău, Moldova', sure: false, source: 'cv', how: 'inferred'}]});
  return {stop_reason: 'end_turn', content: [{type: 'text', text}]};
}}};

test('the CV read gives base-fact proposals, once per CV file, only for known facts nothing holds', async () => {
  const storage = fresh();
  calls.length = 0;
  const wanted = cvQueue.wantedFacts(['Languages']);
  assert.ok(!wanted.includes('languages'), 'a fact Your details holds is not asked');
  const first = await cvQueue.factProposals(storage, {client, wanted: cvQueue.wantedFacts([])});
  assert.deepEqual(first.map(each => each.id).sort(), ['languages', 'nationality'], 'an id the AI invented, or a zone value outside the fixed statuses (#2322), keeps nothing');
  await cvQueue.factProposals(storage, {client, wanted: cvQueue.wantedFacts([])});
  assert.equal(calls.length, 1, 'the same CV is not read twice');
});

test('an install set up before the CV read: the queue opening reads it once, saves the plain facts, queues the rest', async () => {
  const storage = fresh();
  calls.length = 0;
  const items = await review.pending(storage, {ai: {client}});
  assert.equal((await contactDetails.read(storage)).first_name, 'Ana', 'what the CV states plainly is saved');
  const kinds = items.filter(each => each.details.kind === 'cvcheck');
  assert.deepEqual(kinds.map(each => each.question).sort(), ['Q-languages', 'Q-location', 'Q-nationality'], 'worded by the question writer, never typed');
  const permit = kinds.find(each => each.question === 'Q-nationality');
  assert.equal(permit.value, 'Moldova');
  assert.match(permit.details.source, /Inferred from your CV/);
  assert.match(permit.hint, /only in Moldova/, 'the AI says why');
  const reads = calls.length;
  await review.pending(storage, {ai: {client}});
  assert.equal(calls.length, reads, 'a second list asks the AI nothing again (contact read, facts read and question writer are kept)');
  assert.ok(!items.some(each => each.details.kind === 'missing' && /nationality|languages/.test(each.question)), 'a fact the CV proposes is not asked again as an empty one');
});

test('Confirm saves a base fact into its section and a contact value into Contact details; both leave the queue', async () => {
  const storage = fresh();
  const items = await review.pending(storage, {ai: {client}});
  const permit = items.find(each => each.question === 'Q-nationality'), place = items.find(each => each.details.kind === 'cvcheck' && each.question === 'Q-location');
  assert.equal((await review.answer(storage, permit.key, 'Moldova')).ok, true);
  assert.equal((await review.answer(storage, place.key, 'Chișinău')).ok, true, 'an edit replaces the proposal');
  assert.ok((await sections.read(storage)).eligibility.some(line => line.label === 'Nationality' && line.value === 'Moldova'));
  assert.equal((await contactDetails.read(storage)).location, 'Chișinău');
  const left = (await review.pending(storage, {ai: {client}})).filter(each => each.details.kind === 'cvcheck');
  assert.deepEqual(left.map(each => each.question), ['Q-languages']);
});

// Why (28 Oct 2026, owner, #2322): "Questions name a country, never a city": a nationality that is a city, or a zone without a fixed status, is never proposed.
test('a city is never a nationality, and a zone needs one of its fixed statuses', async () => {
  const storage = fresh();
  const cityClient = {messages: {create: async () => ({stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({facts: [{id: 'nationality', value: 'Iasi', how: 'inferred', reason: 'Lives in Iasi'},
    {id: 'zone_uk', value: 'yes, with a permit, valid until 2027-06-30', how: 'stated', reason: 'Skilled Worker visa'}]})}]})}};
  const got = await cvQueue.factProposals(storage, {client: cityClient, wanted: cvQueue.wantedFacts([])});
  assert.deepEqual(got.map(each => [each.id, each.value]), [['zone_uk', 'yes, with a permit, valid until 2027-06-30']]);
});

test('a nationality comes as ISO codes and is saved by the country names, whatever the spelling would have been', async () => {
  const client = {messages: {create: async () => ({stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({facts: [{id: 'nationality', value: 'CZ, TR', how: 'stated', reason: 'Passports'}]})}]})}};
  const got = await cvQueue.factProposals(fresh(), {client, wanted: cvQueue.wantedFacts([])});
  const english = new Intl.DisplayNames(['en'], {type: 'region'});
  assert.deepEqual(got.map(each => each.value), [`${english.of('CZ')}, ${english.of('TR')}`]);
});

test('a name nobody gave stays the first question; "check it" items rank after it', async () => {
  const storage = fresh();
  const nameless = {messages: {create: async request => ({stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(request.system.includes('job-application facts') ? {facts: [{id: 'nationality', value: 'Romania', how: 'inferred', reason: 'Jobs in Romania'}]} : {proposals: [{field: 'location', value: 'Chisinau', sure: false, source: 'cv', how: 'inferred'}]})}]})}};
  const list = ranked(await review.pending(storage, {ai: {client: nameless}}));
  assert.equal(list[0].question, 'First name', 'the name comes first');
  assert.ok(list.some(each => each.details.kind === 'cvcheck'), 'and the CV items follow');
  assert.ok(list.findIndex(each => each.details.kind === 'cvcheck') > list.findIndex(each => each.details.kind === 'contact'));
});

test('the contact questions are generated from what is empty: the AI words and rates them, drops a held field and a not-worth-asking one', async () => {
  const storage = fresh();
  const items = (await review.pending(storage, {ai: {client}})).filter(each => each.details.kind === 'contact');
  const asked = items.map(each => each.question);
  assert.ok(asked.includes('Q-last_name') && !asked.includes('Q-phone') && !asked.includes('Q-github'), `held and importance 0 are not asked: ${asked}`);
  assert.equal(items.find(each => each.question === 'Q-last_name').details.weight > items.find(each => each.question === 'Q-email').details.weight, true, 'importance 3 outweighs 2');
  assert.equal((await review.answer(storage, items.find(each => each.question === 'Q-email').key, 'ana@example.org')).ok, true);
  assert.equal((await contactDetails.read(storage)).email, 'ana@example.org');
});

test('a detail Your details already has is not asked again', async () => {
  const storage = fresh();
  await contactDetails.save(storage, {first_name: 'Ana', last_name: 'Lupu', email: 'ana@example.org', phone: '+373 1', location: 'Chișinău'});
  const asked = (await review.pending(storage, {ai: {client}})).filter(each => each.details.kind === 'contact').map(each => each.question);
  assert.ok(!asked.some(each => /first_name|last_name|email|phone|location/.test(each)), `nothing held is asked: ${asked}`);
});
