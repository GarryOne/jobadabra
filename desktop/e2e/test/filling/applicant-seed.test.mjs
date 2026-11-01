// Which applicant a capture was made with (lib/applicant-seed.mjs): every capture writer records it, and a row replay names a capture made with another one
// (its fill asks carry another profile, so they miss the kept answers: 9f6ff67, 11 Oct 2026, the plain-node app's 250-character profile became the full one).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {OLD_SEED, SEED_FILE, seedNote, seedVersion} from '../../lib/applicant-seed.mjs';
import {saveCandidate} from '../../lib/replay-candidate.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-seed-'));
const caseWith = item => { const dir = temp(); fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify(item)); return dir; };

test('the seed version is a short hash of the applicant both e2e apps seed, and changes when that applicant does', () => {
  assert.match(seedVersion(), /^[0-9a-f]{12}$/);
  assert.equal(seedVersion(), seedVersion(), 'stable');
  const file = path.join(temp(), 'draft.json'), seeded = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  fs.writeFileSync(file, JSON.stringify(seeded));
  assert.equal(seedVersion(file), seedVersion());
  fs.writeFileSync(file, JSON.stringify({...seeded, draft: {...seeded.draft, profile_markdown: `${seeded.draft.profile_markdown}\nOne more line.`}}));
  assert.notEqual(seedVersion(file), seedVersion());
});

// Every place a capture's case.json is written (the smoke's candidate here; the plain-node live row in test/replay/live-row.test.mjs) records the seed.
test('a capture records the seed it ran with; a replay names one recorded with another seed or none, and says what to do', () => {
  const folder = saveCandidate({dir: temp(), day: '2026-10-11', shape: 'Teamtailor form', result: {url: 'https://jobs.example.com/o/1', reached: 'posting'}, html: '<p>x</p>'});
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'case.json'), 'utf8')).seed, seedVersion());
  assert.equal(seedNote(folder), '', 'a capture of this seed replays without a word');
  for (const [name, item] of Object.entries({'no seed (before 9f6ff67)': {pages: []}, 'another seed': {pages: [], seed: '000000000000'}})) {
    assert.equal(seedNote(caseWith(item)), OLD_SEED, name);
  }
  assert.match(OLD_SEED, /older applicant seed: fill asks will miss; re-capture/);
});

// 12 Oct 2026 (Valora: the postal-code box stayed empty): the fake applicant has a street with its number and a postal code, and the seed version moves with them.
test('the fake applicant has a street with its number and a postal code, and the seed version covers its contact', async () => {
  const {CONTACT} = await import('../../lib/apply-fixtures.mjs');
  assert.match(CONTACT.street, /\S+\s+\d+/, 'street and house number');
  assert.match(CONTACT.postal_code, /^\d{4}$/, 'a Swiss postal code');
  assert.match(fs.readFileSync(new URL('../../lib/applicant-seed.mjs', import.meta.url), 'utf8'), /cvJson, CONTACT\]/, 'a contact change must change the seed version');
});

// 12 Oct 2026 (HelloFresh pair): the plain-node app held the imported CV (cv/cv.json) and the Electron live leg did not ("cv facts: none (CV not imported yet)"),
// so the two legs of one pool row filled different applicants. Both apps seed it through one helper; the never-imported control still works.
test('both e2e apps that fill a live row seed the imported CV through one helper, with the never-imported control', async () => {
  const {seedImportedCv} = await import('../../lib/applicant-seed.mjs');
  const dir = temp();
  assert.equal(seedImportedCv(dir, {}), true);
  assert.equal(fs.readFileSync(path.join(dir, 'cv', 'cv.json'), 'utf8'), fs.readFileSync(new URL('../../fixtures/cv.json', import.meta.url), 'utf8'), 'the CV the seed version hashes');
  for (const control of ['E2E_NO_IMPORTED_CV', 'E2E_IMPORT_VIA_UPLOAD']) {
    const none = temp();
    assert.equal(seedImportedCv(none, {[control]: '1'}), false, control);
    assert.equal(fs.existsSync(path.join(none, 'cv', 'cv.json')), false, control);
  }
  for (const file of ['offline-app-child.mjs', 'apply-live.mjs']) {
    assert.match(fs.readFileSync(new URL(`../../lib/${file}`, import.meta.url), 'utf8'), /seedImportedCv\(/, `${file} seeds the imported CV`);
  }
});
