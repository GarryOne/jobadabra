// Layer 3 (Node + the app's own modules over a temp folder on this Mac's store, no window, no browser, no AI): Profile → Your details reaches Apply (journey J14, Tier 1). The e2e step in the settings
// suite plays it in the window ("a phone edited in Your details is what the extension is handed"); this file proves the same rule below the browser, on every PR: Your details' Save
// (the app's own saveContact handler, lib/contact-handlers.js) writes the Profile, and what the extension is handed for the next form (server-contact.js me(), the body of GET /extension/me) is the
// new value with every other detail kept, also when the app starts again on the same folder. Fake applicant data, a temp folder, no Keychain, Notion, AI or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {loadAppModule} from '../../e2e/lib/app-module.mjs';

const plainCrypto = {encrypt: value => value, decrypt: value => value};
const ADA = {first_name: 'Ada', last_name: 'Tester', full_name: 'Ada Tester', email: 'ada.tester@example.test', phone: '+41 79 555 01 23', location: 'Zurich, Switzerland'};
const NEW_PHONE = '+41 79 555 99 88';
let folder, createStorage, registerContactHandlers, contactServer, openStore, contactDetails;

// The app started on this folder: its storage, the IPC handlers Your details calls, and the hook that refreshes what the extension is handed after a save (main wires it to server-contact.js).
function start() {
  const storage = createStorage(folder, plainCrypto), handlers = new Map();
  registerContactHandlers({ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, storage, DEMO: false, connected: () => true, needsNotion: () => null,
    contactSaved: saved => contactServer.contactSaved(storage, saved), log: () => {}});
  return {storage, call: (name, ...args) => handlers.get(name)({}, ...args)};
}

before(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-profile-handoff-'));
  ({createStorage} = await loadAppModule('storage.js'));
  ({registerContactHandlers} = await loadAppModule('contact-handlers.js'));
  contactServer = await loadAppModule('server-contact.js');
  ({openStore} = await loadAppModule('store/index.js'));
  contactDetails = await loadAppModule('contact.js');
  const seed = createStorage(folder, plainCrypto);
  seed.saveSettings({store: 'sqlite', telemetry: false});
  await openStore(seed).page('profile').write(`${contactDetails.markdown(ADA)}\n`);
});
after(() => fs.rmSync(folder, {recursive: true, force: true}));

test('a phone edited in Your details is what the extension is handed, the other details stay, and it is still handed after the app starts again', async () => {
  const app = start();
  const first = await contactServer.me(app.storage);
  assert.equal(first.contact.phone, ADA.phone, `the seeded phone was not handed to the extension: ${JSON.stringify(first.contact)}`);

  // What the save bar sends for Contact (renderer/pages/details-drafts.js): every filled box, the full name from first + last.
  const saved = await app.call('saveContact', {...ADA, phone: NEW_PHONE});
  assert.equal(saved.ok, true, `Your details was not saved: ${saved.error}`);

  const handed = await contactServer.me(app.storage);
  assert.equal(handed.contact.phone, NEW_PHONE, `the extension is still handed the old phone: ${JSON.stringify(handed.contact)}`);
  for (const key of ['first_name', 'last_name', 'email', 'location']) assert.equal(handed.contact[key], ADA[key], `saving the phone changed ${key}`);

  // The app starts again: a new storage and new handlers, the next form asks for the details and still gets the new phone.
  const again = start();
  assert.equal((await contactDetails.read(again.storage)).phone, NEW_PHONE, 'the Profile did not keep the new phone after the app started again');
  assert.equal((await contactServer.me(again.storage)).contact.phone, NEW_PHONE, 'the extension was handed the old phone after the app started again');
});
