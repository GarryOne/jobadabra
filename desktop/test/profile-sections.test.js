// Your details' new sections (owner, 17 Oct 2026: Work eligibility, Availability & compensation, Languages) on every store: read, replaced whole, other
// sections and the rest of the Profile untouched. One scenario per adapter (this Mac's files and Notion through test/fake-notion.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as sections from '../lib/profile-sections.js';
import {fakeNotion} from './fake-notion.js';

const plain = {encrypt: v => v, decrypt: v => v};
function storageWith(settings, secrets = {}) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-sections-')), plain);
  storage.saveSettings(settings);
  for (const [name, value] of Object.entries(secrets)) storage.setSecret(name, value);
  return storage;
}
export const ADAPTERS = {
  sqlite: () => ({storage: storageWith({store: 'sqlite'}), fetcher: undefined}),
  notion: () => {
    const fake = fakeNotion();
    return {storage: storageWith({store: 'notion', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}}, {NOTION_TOKEN: 'secret'}), fetcher: fake.fetcher};
  },
};

for (const [name, make] of Object.entries(ADAPTERS)) {
  test(`${name}: a section is written under its own heading, read back, replaced whole; the rest of the Profile stays`, async () => {
    const {storage, fetcher} = make();
    const page = store.openStore(storage, {fetcher}).page('profile');
    const contact = await page.appendHeading('📇 Contact details');
    await page.insertAfter(contact, ['Email: a@b.c']);
    await page.append(['Targets stay here']);
    assert.deepEqual(await sections.read(storage, fetcher), {eligibility: [], availability: [], languages: []});
    await sections.save(storage, 'eligibility', [{label: 'Switzerland', value: 'B permit'}, {label: 'Sponsorship needed', value: 'No'}], fetcher);
    await sections.save(storage, 'languages', [{label: 'English', value: 'fluent'}], fetcher);
    assert.deepEqual((await sections.read(storage, fetcher)).eligibility, [{label: 'Switzerland', value: 'B permit'}, {label: 'Sponsorship needed', value: 'No'}]);
    await sections.save(storage, 'eligibility', [{label: 'Switzerland', value: 'C permit'}], fetcher);
    const read = await sections.read(storage, fetcher);
    assert.deepEqual(read.eligibility, [{label: 'Switzerland', value: 'C permit'}]);
    assert.deepEqual(read.languages, [{label: 'English', value: 'fluent'}]);
    const texts = (await page.blocks()).map(block => block.text);
    for (const kept of ['📇 Contact details', 'Email: a@b.c', 'Targets stay here']) assert.ok(texts.includes(kept), kept);
    assert.equal(texts.filter(text => text === sections.SECTIONS.eligibility).length, 1, 'one heading per section');
  });

  // Why (28 Oct 2026, owner, #2322): Nationality and each zone, a permit's date and "only in" included, read back the same on every store.
  test(`${name}: Nationality and each zone row read back whole, with their kind`, async () => {
    const {storage, fetcher} = make();
    const rows = [{label: 'Nationality', value: 'Romania, Moldova'}, {label: 'EU / EEA + Switzerland', value: 'yes, freely', kind: 'per_country'},
      {label: 'United Kingdom', value: 'yes, with a permit, valid until 2027-06-30, only in United Kingdom', kind: 'per_country'},
      {label: 'United States', value: 'no, needs sponsorship', kind: 'per_country'}, {label: 'Canada', value: 'yes, with a permit', kind: 'per_country'}];
    await sections.save(storage, 'eligibility', rows, fetcher);
    assert.deepEqual((await sections.read(storage, fetcher)).eligibility, rows);
  });
}

test('a value with a colon in it reads back whole; an unknown section is refused', async () => {
  const {storage} = ADAPTERS.sqlite();
  await sections.save(storage, 'availability', [{label: 'Start', value: 'after 3 months: notice'}]);
  assert.deepEqual((await sections.read(storage)).availability, [{label: 'Start', value: 'after 3 months: notice'}]);
  await assert.rejects(() => sections.save(storage, 'hobbies', []), /not a Your details section/);
});
