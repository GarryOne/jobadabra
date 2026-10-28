// The Work eligibility lines saved before Nationality and the zones (#2322, lib/eligibility-older.js): the AI reads each once (cached per set of lines), the
// code keeps only zones, statuses, dates and countries from the fixed sets, and a line leaves the card only on your Save, after a backup, with Undo.
// Owner (28 Oct 2026): "we can deduce any of them, once we know the answer for the 3 above". Values are fictional.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as sections from '../lib/profile-sections.js';
import {beforeSave, folded, older, undoFold} from '../lib/eligibility-older.js';

const fresh = () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-older-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite'});
  return storage;
};
const LINES = [{label: 'Work permit / visa', value: 'EU citizen (Romania); needs a visa for the US'}, {label: 'Authorised to work in Iasi, Romania?', value: 'Yes'},
  {label: 'Eligible to work in the location you apply for?', value: 'Yes'}, {label: 'Remote from your base for a foreign employer?', value: 'Yes'},
  {label: 'Nationality', value: 'Romania'}, {label: 'United Kingdom', value: 'yes, with a permit', kind: 'per_country'}];
const READ = {lines: [
  {id: '0', about: 'eligibility', nationality: ['RO', 'XX'], rows: [{row: 'eu', status: 'yes, freely', until: '', only: ''}, {row: 'us', status: 'no, needs sponsorship', until: '', only: ''},
    {row: 'mars', status: 'yes, freely', until: '', only: ''}, {row: 'us', status: 'yes, freely', until: '', only: ''}]},
  {id: '1', about: 'eligibility', nationality: [], rows: [{row: 'eu', status: 'yes, freely', until: 'soon', only: ''}, {row: 'CH', status: 'yes, with a permit', until: '2027-06-30', only: 'CH'}]},
  {id: '2', about: 'per_job', nationality: ['RO'], rows: [{row: 'eu', status: 'yes, freely', until: '', only: ''}]},
  {id: '3', about: 'other', nationality: [], rows: []}]};
const client = (calls = [], answer = READ) => ({messages: {create: async request => { calls.push(request); return {content: [{type: 'text', text: JSON.stringify(answer)}]}; }}});

test('older: only the lines that are not Nationality or a row go to the AI; its answer is kept to the fixed sets', async () => {
  const storage = fresh(), calls = [];
  const got = await older(storage, LINES, {ai: {client: client(calls)}});
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].messages[0].content, /Nationality: Romania|United Kingdom/, 'the new shape is never sent');
  assert.deepEqual(got.map(line => line.about), ['eligibility', 'eligibility', 'per_job', 'other']);
  assert.deepEqual(got[0].nationality, ['Romania'], 'a code that is no country is dropped');
  assert.deepEqual(got[0].rows, [{label: 'EU / EEA + Switzerland', value: 'yes, freely'}, {label: 'United States', value: 'no, needs sponsorship'}], 'an unknown row is dropped; one answer per row');
  assert.deepEqual(got[1].rows, [{label: 'Switzerland', value: 'yes, with a permit, valid until 2027-06-30, only in Switzerland'}], 'a date that is not YYYY-MM-DD drops its row');
  assert.deepEqual([got[2].nationality, got[2].rows], [[], []], 'a per-job question states nothing of its own');
});

test('older: read once per set of lines; a changed line reads again; no AI or a failed call leaves every line unknown, uncached', async () => {
  const storage = fresh(), calls = [];
  await older(storage, LINES, {ai: {client: client(calls)}});
  await older(storage, [...LINES].reverse(), {ai: {client: client(calls)}});
  assert.equal(calls.length, 1, 'the same lines: no second call');
  await older(storage, [...LINES.slice(1), {label: 'Work permit / visa', value: 'EU citizen (Romania)'}], {ai: {client: client(calls)}});
  assert.equal(calls.length, 2);
  const none = fresh();
  assert.deepEqual((await older(none, LINES)).map(line => line.about), ['', '', '', '']);
  const broken = {messages: {create: async () => { throw new Error('busy'); }}};
  assert.deepEqual((await older(none, LINES, {ai: {client: broken}})).map(line => line.about), ['', '', '', '']);
  assert.equal(none.settings().eligibilityOlder, undefined, 'tried again at the next open');
});

test('folded: eligibility and per-job lines fold; "other" and an unread line stay', async () => {
  const storage = fresh();
  await older(storage, LINES, {ai: {client: client()}});
  assert.deepEqual(LINES.slice(0, 4).map(line => folded(storage, line)), [true, true, true, false]);
  assert.equal(folded(storage, {label: 'Something new', value: 'x'}), false);
});

test('nothing changes until Save: then a backup first, the section as it was kept, and Undo puts it back', async () => {
  const storage = fresh(), copies = [];
  await sections.save(storage, 'eligibility', LINES);
  await older(storage, LINES, {ai: {client: client()}});
  assert.deepEqual((await sections.read(storage)).eligibility.map(line => line.label), LINES.map(line => line.label), 'reading never removes a line');
  const copy = async () => { copies.push(1); };
  assert.equal(await beforeSave(storage, LINES, {copy}), 0, 'a Save that keeps every line folds nothing');
  assert.equal(copies.length, 0);
  const next = [LINES[3], {label: 'Nationality', value: 'Romania'}, {label: 'EU / EEA + Switzerland', value: 'yes, freely', kind: 'per_country'}];
  assert.equal(await beforeSave(storage, next, {copy, now: new Date('2026-10-28T10:00:00Z')}), 3);
  assert.equal(copies.length, 1, 'the pages are copied before the fold');
  assert.equal(storage.settings().eligibilityFold.before.length, LINES.length);
  await sections.save(storage, 'eligibility', next);
  assert.deepEqual(await undoFold(storage), {ok: true});
  assert.deepEqual((await sections.read(storage)).eligibility.map(line => line.label), LINES.map(line => line.label));
  assert.equal((await undoFold(storage)).ok, false, 'one Undo');
});
