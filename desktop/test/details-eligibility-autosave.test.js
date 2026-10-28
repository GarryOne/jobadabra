// Your details saves what the AI concludes by itself (owner, 28 Oct 2026, "Save them automatically"): the older Work eligibility lines folded into Nationality and the zones
// (#2322), and the zones a saved Nationality opens (#2346), are written when Your details opens, a backup first and an Undo after, so nothing is left as an unsaved change and
// leaving Profile asks nothing. Only the person's own edits are drafts. The owner's state: old fact answers saved, the AI answering, nothing typed. Values are fictional.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {registerDetailsFactsHandlers} from '../lib/details-facts-handlers.js';
import * as sections from '../lib/profile-sections.js';
import * as store from '../lib/store/index.js';
import {INSTRUCTIONS as OLDER} from '../lib/eligibility-older.js';
import {INSTRUCTIONS as ZONES} from '../lib/zone-suggest.js';

const answer = body => ({content: [{type: 'text', text: JSON.stringify(body)}]});
// The AI of every step: it answers only the two eligibility questions; any other step fails and is caught (its own tests cover it).
const client = ({older, zones}) => ({messages: {create: async request => {
  if (request.system === OLDER) return answer(older);
  if (request.system === ZONES) return answer(zones);
  throw new Error('not this test');
}}});
const ROMANIA = {lines: [{id: '0', about: 'eligibility', nationality: ['RO'], rows: [{row: 'eu', status: 'yes, freely'}]}, {id: '1', about: 'per_job', nationality: [], rows: []}]};

async function harness({profile, ai = client({older: ROMANIA, zones: {zones: []}})}) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-autosave-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite', profileMovedAt: '2026-10-01T00:00:00Z'});
  await store.openStore(storage).page('profile').write(profile);
  const handlers = {}, copies = [];
  registerDetailsFactsHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = (...args) => fn(null, ...args); }}, storage, DEMO: false, connected: () => true, needsNotion: () => null,
    log: () => {}, ai: () => ({client: ai}), copy: async () => { copies.push((await sections.read(storage)).eligibility.map(line => line.label)); }});
  return {storage, handlers, copies};
}
const WORK = '## 🛂 Work eligibility\n- Work permit / visa: EU citizen (Romania)\n- Authorised to work in Iasi, Romania?: Yes\n';
const rows = lines => Object.fromEntries(lines.filter(line => line.kind === 'per_country').map(line => [line.label, line.value]));

test('old fact answers: Nationality and the zones are saved at once, the old lines folded, a backup first, nothing left as a draft', async () => {
  const {storage, handlers, copies} = await harness({profile: WORK});
  const got = await handlers.detailsFacts();
  const lines = (await sections.read(storage)).eligibility;
  assert.equal(lines.find(line => line.label === 'Nationality')?.value, 'Romania');
  assert.deepEqual(rows(lines), {'EU / EEA + Switzerland': 'yes, freely', 'United Kingdom': 'no, needs sponsorship', 'United States': 'no, needs sponsorship'});
  assert.deepEqual(lines.filter(line => /permit|Authorised/.test(line.label)), [], 'the folded lines are gone');
  assert.deepEqual(copies, [['Work permit / visa', 'Authorised to work in Iasi, Romania?']], 'the backup ran before the write, on the lines as they were');
  assert.deepEqual(got.older || [], [], 'nothing is left for the screen to propose');
  assert.equal(got.tidied.changed >= 3, true, 'the tidy notice (with its Undo) counts what was concluded');
  assert.equal(storage.settings().eligibilityFold.before.length, 2, 'Undo has the section as it was');
});

test('a second open changes nothing and backs nothing up', async () => {
  const {handlers, copies} = await harness({profile: WORK});
  await handlers.detailsFacts();
  await handlers.detailsFacts();
  assert.equal(copies.length, 1);
});

test('a saved Nationality opens its zones: Europe by the table, no AI needed', async () => {
  const {storage, handlers} = await harness({profile: '## 🛂 Work eligibility\n- Nationality: Romania\n', ai: client({older: {lines: []}, zones: {zones: []}})});
  await handlers.detailsFacts();
  assert.deepEqual(rows((await sections.read(storage)).eligibility), {'EU / EEA + Switzerland': 'yes, freely', 'United Kingdom': 'no, needs sponsorship', 'United States': 'no, needs sponsorship'});
});

test('a Canadian: the zones are saved when the AI answers; with no answer nothing is guessed and the next open tries again', async () => {
  const profile = '## 🛂 Work eligibility\n- Nationality: Canada\n';
  const none = await harness({profile, ai: client({older: {lines: []}, zones: {zones: []}})});
  await none.handlers.detailsFacts();
  assert.deepEqual(rows((await sections.read(none.storage)).eligibility), {}, 'no AI answer: no guess');
  const zones = {zones: [{zone: 'uk', status: 'yes, with a permit'}, {zone: 'us', status: 'yes, with a permit'}, {zone: 'eu', status: 'no, needs sponsorship'}]};
  const answered = await harness({profile, ai: client({older: {lines: []}, zones})});
  await answered.handlers.detailsFacts();
  assert.deepEqual(rows((await sections.read(answered.storage)).eligibility), {'EU / EEA + Switzerland': 'no, needs sponsorship', 'United Kingdom': 'yes, with a permit', 'United States': 'yes, with a permit'});
});

test('a zone the person already answered is never overwritten', async () => {
  const {storage, handlers} = await harness({profile: `${WORK}- United Kingdom: yes, freely [per country]\n`});
  await handlers.detailsFacts();
  assert.equal(rows((await sections.read(storage)).eligibility)['United Kingdom'], 'yes, freely');
});

test('Undo puts the old lines back and they are not concluded again for the same lines', async () => {
  const {storage, handlers} = await harness({profile: WORK});
  await handlers.detailsFacts();
  assert.deepEqual(await handlers.undoDetailsTidy(), {ok: true});
  assert.equal((await sections.read(storage)).eligibility.some(line => /Authorised/.test(line.label)), true, 'the old lines are back');
  await handlers.detailsFacts();
  const lines = (await sections.read(storage)).eligibility;
  assert.equal(lines.some(line => /Authorised/.test(line.label)), true, 'the same lines are not folded again');
  assert.equal(lines.some(line => line.label === 'Nationality'), false);
});
