// Layer 3 (Node + the app's own modules over a temp folder on this Mac's store, no window, no browser, no AI): Tailor CV (night journey J8, Tier 2 since 1 Nov 2026, so no longer an e2e step).
// Moved from the e2e `apply` suite's two Tailor steps: "Tailor CV on a job writes a CV from its posting: the PDF on this Mac, ... and the extension attaches it, not the base CV" and "Tailor on the
// session page of a form restarts the form with the tailored CV under its own name". The AI and Chromium that write the PDF are the tailor's own tests (cv.test.js, cv-inplace*.test.js); here the
// PDF is saved the way the app saves it (lib/cv.js save) and what the app hands the extension is read: lib/server-contact.js `me`, the details the extension asks for with the form's address.
// The extension attaching exactly what it is given is extension-form-shapes.test.mjs ("a form whose app hands it a tailored CV ..."). Isolation: a temp storage, no Keychain, Notion, AI or window.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {loadAppModule} from '../../e2e/lib/app-module.mjs';

const plainCrypto = {encrypt: value => value, decrypt: value => value};
const GREENHOUSE = 'https://boards.greenhouse.io/e2e-labs/jobs/4001';
const LEVER = 'https://jobs.lever.co/e2e-systems/4002';
const BASE_BYTES = '%PDF-1.4 BASE CV', TAILORED_BYTES = '%PDF-1.4 TAILORED CV for Greenhouse Labs';
let storage, cv, me, restartFormsOf, folder;

const record = (code, url, company) => ({job: {code, url, title: 'Platform Engineer', company}, createdAt: '2026-11-01T00:00:00.000Z', model: cv.MODEL, usd: 0, changes: [], warnings: [], cv: {}, review: {}});
const bytesOf = resume => Buffer.from(resume.data, 'base64').toString();

before(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-tailored-cv-'));
  const {createStorage} = await loadAppModule('storage.js');
  cv = await loadAppModule('cv.js');
  ({me} = await loadAppModule('server-contact.js'));
  ({restartFormsOf} = await loadAppModule('tailored-restart.js'));
  storage = createStorage(folder, plainCrypto);
  storage.saveSettings({store: 'sqlite', telemetry: false, cvName: 'CV.pdf'});
  fs.mkdirSync(cv.dir(storage), {recursive: true});
  fs.writeFileSync(path.join(cv.dir(storage), 'cv.json'), JSON.stringify({name: 'Ada Tester'}));   // the base CV's data: the tailored file's name carries the person's name
  fs.writeFileSync(storage.path('cv.pdf'), BASE_BYTES);
});
after(() => fs.rmSync(folder, {recursive: true, force: true}));

test('Tailor CV on a job: that job\'s form gets the tailored PDF under its own name, every other form the general CV', async () => {
  const general = (await me(storage, GREENHOUSE)).resume;
  assert.deepEqual([general.name, general.tailored, bytesOf(general)], ['CV.pdf', false, BASE_BYTES], 'the control: before Tailor the form has the general CV');

  cv.save(storage, 'gh001', record('gh001', GREENHOUSE, 'E2E Greenhouse Labs'), Buffer.from(TAILORED_BYTES));
  assert.ok(cv.exists(storage, 'gh001'), 'the tailored PDF is not kept on this Mac under the job\'s code');
  assert.ok(fs.statSync(cv.pdfPath(storage, 'gh001')).size !== Buffer.byteLength(BASE_BYTES), 'the tailored PDF is the size of the base CV: it was not written from the posting');

  const mine = (await me(storage, `${GREENHOUSE}#jobpilotto-fill`)).resume;
  assert.deepEqual([mine.name, mine.tailored, bytesOf(mine)], ['CV_Ada_Tester_E2E_Greenhouse_Labs.pdf', true, TAILORED_BYTES], 'the form of the tailored job did not get the tailored CV');
  const other = (await me(storage, LEVER)).resume;
  assert.deepEqual([other.name, other.tailored, bytesOf(other)], ['CV.pdf', false, BASE_BYTES], 'another job\'s form got the tailored CV of Greenhouse Labs');
});

test('Tailor on the session page restarts only that job\'s open form, and it is handed the tailored CV under its own name', async () => {
  const sessions = [{id: 'open', kind: 'form', url: LEVER}, {id: 'closed-tab', kind: 'form', url: LEVER}, {id: 'stopped', kind: 'form', url: LEVER, stuck: 'stopped'},
    {id: 'submitted', kind: 'form', url: LEVER, outcome: 'submitted'}, {id: 'elsewhere', kind: 'form', url: GREENHOUSE}];
  const reloaded = [], seams = {sessions, tabOpen: id => id !== 'closed-tab', reload: id => reloaded.push(id)};
  assert.deepEqual(restartFormsOf(storage, 'lv002', seams), [], 'the control: nothing restarts while the job has no tailored CV');
  assert.equal((await me(storage, LEVER)).resume.name, 'CV.pdf', 'the control: before Tailor the form has the general CV');

  cv.save(storage, 'lv002', record('lv002', LEVER, 'E2E Lever Systems'), Buffer.from('%PDF-1.4 TAILORED CV for Lever Systems'));
  assert.deepEqual(restartFormsOf(storage, 'lv002', seams), ['open'], 'Tailor must restart the job\'s open form, and not a closed tab, a stopped or submitted form, or another job\'s');
  assert.deepEqual(reloaded, ['open']);
  const again = (await me(storage, `${LEVER}#jobpilotto-fill`)).resume;
  assert.deepEqual([again.name, again.tailored, bytesOf(again)], ['CV_Ada_Tester_E2E_Lever_Systems.pdf', true, '%PDF-1.4 TAILORED CV for Lever Systems'], 'the restarted form did not get the tailored CV');
});
