// Layer 3 (Node + the app's own modules over a temp folder on this Mac's store, no window, no browser, no AI): Profile → Experience (journey J14, Tier 1). The e2e step in the settings suite plays it
// in the window ("an edited summary is saved with the Profile's one Save, and is still there after a restart"); this file proves the same rule below the browser, on every PR: the Experience
// card's changes (renderer/experience-profile-model.js changesFor, what the editor hands the save bar) go through the app's own textEdit handler (lib/text-outline-handlers.js) into profile.md;
// a second storage over the same folder (the app started again) reads the new summary back; the apply side reads the same text (store page('profile').text(), what the scorer, tailoring and answers
// are given); a stale edit is refused as "changed meanwhile" and overwrites nothing. Fake applicant data, a temp folder, no Keychain, Notion, AI or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {loadAppModule} from '../../e2e/lib/app-module.mjs';
import {changesFor, profileParts} from '../../renderer/experience-profile-model.js';

const plainCrypto = {encrypt: value => value, decrypt: value => value};
const OLD = 'Platform engineer with 8 years on AWS.';
const NEW = 'Site reliability engineer who has run on-call for 40 services.';
const PROFILE = ['## Summary (from CV)', `- ${OLD}`, '## Strengths', '- Kubernetes at scale', '- On-call leadership', '## Education', '- BSc Computer Science · Example University · 2012'].join('\n') + '\n';
let folder, createStorage, registerTextOutlineHandlers, openStore;

// The app started on this folder: its storage and its IPC handlers (what the window's textOutline/textEdit calls reach).
function start() {
  const storage = createStorage(folder, plainCrypto), handlers = new Map();
  registerTextOutlineHandlers({ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, storage, DEMO: false, log: () => {}});
  return {storage, call: (name, ...args) => handlers.get(name)({}, ...args)};
}
const summaryOf = outline => profileParts(outline.items).summary.lines.map(line => line.text);

before(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-profile-experience-'));
  ({createStorage} = await loadAppModule('storage.js'));
  ({registerTextOutlineHandlers} = await loadAppModule('text-outline-handlers.js'));
  ({openStore} = await loadAppModule('store/index.js'));
  const seed = createStorage(folder, plainCrypto);
  seed.saveSettings({store: 'sqlite', telemetry: false});
  await openStore(seed).page('profile').write(PROFILE);
});
after(() => fs.rmSync(folder, {recursive: true, force: true}));

test('an edited summary is saved through textEdit, survives the app starting again, is what the apply side reads, and a stale edit overwrites nothing', async () => {
  const app = start();
  const before = await app.call('textOutline', 'profile');
  assert.deepEqual(summaryOf(before), [OLD], 'the seeded summary was not read from the Profile');
  const staleChanges = changesFor('summary', profileParts(before.items).summary, [NEW]);
  assert.equal(staleChanges.length, 1, `the Experience editor should hand one change for one edited line, got ${JSON.stringify(staleChanges)}`);

  const saved = await app.call('textEdit', 'profile', staleChanges);
  assert.equal(saved.ok, true, `the summary was not saved: ${saved.error}`);
  assert.deepEqual(summaryOf(saved), [NEW], 'the save did not answer with the page as it is now');

  // The app starts again on the same folder: a new storage and new handlers, nothing carried over in memory.
  const again = start();
  const after = await again.call('textOutline', 'profile');
  assert.deepEqual(summaryOf(after), [NEW], 'the new summary was not there after the app started again');
  const parts = profileParts(after.items);
  assert.deepEqual(parts.strengths.lines.map(line => line.text), ['Kubernetes at scale', 'On-call leadership'], 'saving the summary touched the Strengths');
  assert.deepEqual(parts.education.lines.map(line => line.text), ['BSc Computer Science · Example University · 2012'], 'saving the summary touched the Education');

  // The apply side: the Profile's text as the store hands it to whatever answers or scores for the person.
  const readable = await openStore(again.storage).page('profile').text();
  assert.ok(readable.includes(NEW), 'the apply side does not see the new summary');
  assert.ok(!readable.includes(OLD), 'the apply side still sees the old summary');

  // A second window still holding the old draft (it read OLD) saves: refused, told "changed meanwhile", the page is kept as it is.
  const stale = await again.call('textEdit', 'profile', staleChanges);
  assert.equal(stale.ok, false, 'a stale edit was accepted over a newer summary');
  assert.match(stale.error, /changed meanwhile/, 'a stale edit was refused without saying why');
  assert.deepEqual(summaryOf(await again.call('textOutline', 'profile')), [NEW], 'a stale edit overwrote the summary');
});
