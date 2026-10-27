// The contact questions of the review queue are generated from what Your details lacks, never typed (lib/contact-review.js; owner, 27 Oct 2026: "This should not be
// hard-coded. There should be a pool of questions being dynamically generated out of the missing details"; "if the user does have already these details, how are we asking him again?").
// The AI is a fake that words, rates and drops held fields (no spend).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as contactDetails from '../lib/contact.js';
import * as review from '../lib/details-review.js';
import {BLOCKED, MUST} from '../renderer/question-filter.js';
import {weightOf} from '../lib/contact-review.js';

const plainCrypto = {encrypt: v => v, decrypt: v => v};
const fresh = () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-contact-')), plainCrypto);
  storage.saveSettings({store: 'sqlite', telemetry: false, missingFacts: {since: '2020-01-01'}});
  return storage;
};
let calls = 0;
const client = {messages: {create: async request => {
  calls += 1;
  const keys = [...request.messages[0].content.match(/<empty>\n([\s\S]*?)\n<\/empty>/)[1].matchAll(/^(\w+):/gm)].map(each => each[1]);
  return {content: [{type: 'text', text: JSON.stringify({asks: keys.map(field => ({field, question: `Q-${field}`, hint: '', importance: field === 'last_name' ? 3 : field === 'github' ? 0 : 2, held: field === 'phone'}))})}]};
}}};
const contactItems = async (storage, ai) => (await review.pending(storage, {ai})).filter(each => each.details.kind === 'contact');

test('the questions are worded and rated by the AI; a held field and a not-worth-asking one are not asked', async () => {
  const items = await contactItems(fresh(), {client});
  const asked = items.map(each => each.question);
  assert.ok(asked.includes('Q-last_name') && asked.includes('Q-email'));
  assert.ok(!asked.includes('Q-phone') && !asked.includes('Q-github'), `held and importance 0 stay out: ${asked}`);
  const weight = field => items.find(each => each.question === `Q-${field}`).details.weight;
  assert.ok(weight('last_name') > weight('email'), 'importance 3 outweighs 2');
});

test('what the AI wrote is kept for the same set of empty fields: a second list asks nothing', async () => {
  const storage = fresh();
  calls = 0;
  await contactItems(storage, {client});
  const first = calls;
  await contactItems(storage, {client});
  assert.equal(calls, first);
});

test('a detail Your details already has is not asked again', async () => {
  const storage = fresh();
  await contactDetails.save(storage, {first_name: 'Ana', last_name: 'Lupu', email: 'ana@example.org', phone: '+373 1'});
  const asked = (await contactItems(storage, {client})).map(each => each.question);
  assert.ok(!asked.some(each => /first_name|last_name|email|phone/.test(each)), `nothing held is asked: ${asked}`);
});

test('no AI at all: the first four empty fields by their label, outranking a blocked fill; an answer lands in its field', async () => {
  const storage = fresh();
  const items = await contactItems(storage, {});
  assert.deepEqual(items.map(each => each.question), ['First name', 'Last name', 'Email', 'Phone']);
  assert.ok(items.every(each => each.details.weight === MUST));
  assert.equal((await review.answer(storage, items[0].key, 'Ana')).ok, true);
  assert.equal((await contactDetails.read(storage)).first_name, 'Ana');
});

test('the weight of a rating: 3 above any blocked fill, 2 right below them, 0 none', () => {
  assert.ok(weightOf(3) > BLOCKED && weightOf(2) < BLOCKED && weightOf(2) > weightOf(1) && weightOf(0) === 0);
});
