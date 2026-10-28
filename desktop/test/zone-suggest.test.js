// The zone statuses preselected for a nationality outside Europe and the US come from the AI, kept to the fixed sets, once per country (owner, 28 Oct 2026:
// "use AI if the nationality is not US or Europe"). A fictional Canadian; the client is a stub.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {suggest} from '../lib/zone-suggest.js';
import {freer, inZones} from '../renderer/work-eligibility.js';

const fresh = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-zones-')), {encrypt: v => v, decrypt: v => v});
const SAID = {zones: [{zone: 'eu', status: 'no, needs sponsorship'}, {zone: 'uk', status: 'yes, with a permit'}, {zone: 'us', status: 'yes, freely'}, {zone: 'mars', status: 'yes, freely'}, {zone: 'eu', status: 'maybe'}]};
const client = (calls = [], answer = SAID) => ({messages: {create: async request => { calls.push(request); return {content: [{type: 'text', text: JSON.stringify(answer)}]}; }}});

test('Europe and the US are the fixed table; any other country goes to the AI', () => {
  assert.ok(inZones('Romania') && inZones('United Kingdom') && inZones('United States'));
  assert.ok(!inZones('Canada') && !inZones('India'));
  assert.equal(freer('no, needs sponsorship', 'yes, with a permit'), 'yes, with a permit');
  assert.equal(freer('', 'yes, freely'), 'yes, freely');
});

test('suggest: the AI answer is kept to the fixed zones and statuses, and read once per country', async () => {
  const storage = fresh(), calls = [];
  const first = await suggest(storage, ['Canada'], {ai: {client: client(calls)}});
  assert.deepEqual(first, {eu: 'no, needs sponsorship', uk: 'yes, with a permit', us: 'yes, freely'}, 'no "mars" zone, no "maybe" status');
  assert.deepEqual(await suggest(storage, ['Canada'], {ai: {client: client(calls)}}), first);
  assert.equal(calls.length, 1, 'the second ask is answered from the kept answer');
  assert.match(calls[0].messages[0].content, /Canada/);
});

test('suggest: two nationalities take the freer status per zone; no AI or a failed call suggests nothing and caches nothing', async () => {
  const storage = fresh();
  const two = await suggest(storage, ['Canada', 'India'], {ai: {client: client([], {zones: [{zone: 'eu', status: 'yes, with a permit'}]})}});
  assert.deepEqual(two, {eu: 'yes, with a permit'});
  const other = fresh();
  assert.deepEqual(await suggest(other, ['Canada'], {}), {});
  assert.deepEqual(await suggest(other, ['Canada'], {ai: {client: {messages: {create: async () => { throw new Error('busy'); }}}}}), {});
  assert.equal(other.settings().zoneSuggestions, undefined);
});
