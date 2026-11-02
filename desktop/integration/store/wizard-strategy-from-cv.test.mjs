// Layer 3 (Node + the app's own strategy builder over a temp folder, no window, no browser, no real AI): the setup wizard's "the strategy is built from the CV and shows roles to search for"
// (journey J1, Tier 1). Why (2 Nov 2026, owner: "I think we agreed to move the variable things outside of e2e"): that e2e step waited on an AI answer the stand-in could only match by the
// request's full text, and beta 16 hung 30 s on one miss. Here the AI is a fake client that answers whatever it is asked, so no key can miss: the test proves what the app does with the CV
// and the draft it gets back. How good a real draft is stays in the nightly measurement.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {loadAppModule} from '../../e2e/lib/app-module.mjs';

const plainCrypto = {encrypt: value => value, decrypt: value => value};
const CV = fs.readFileSync(new URL('../../e2e/fixtures/cv.pdf', import.meta.url));
const FICTIONAL_DRAFT = JSON.parse(fs.readFileSync(new URL('../../demo/draft.json', import.meta.url), 'utf8')).draft;
let folder, storage, strategy, createStorage;

// A client that answers any ask with this text, and keeps what it was asked.
const fakeClient = (text, asked = []) => ({asked, messages: {create: async request => {
  asked.push(request);
  return {stop_reason: 'end_turn', content: [{type: 'text', text}], usage: {input_tokens: 1000, output_tokens: 500}};
}}});

before(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-wizard-strategy-'));
  ({createStorage} = await loadAppModule('storage.js'));
  storage = createStorage(folder, plainCrypto);
  storage.saveSettings({store: 'sqlite', telemetry: false, setupDone: false});
  fs.writeFileSync(storage.path('cv.pdf'), CV);
  strategy = await loadAppModule('strategy.js');
});
after(() => fs.rmSync(folder, {recursive: true, force: true}));

test('the CV goes to the AI as a PDF document with the draft schema, and the roles of the draft come back', async () => {
  const client = fakeClient(JSON.stringify(FICTIONAL_DRAFT));
  const draft = await strategy.draft(storage, {}, 'test-key', client);
  assert.equal(client.asked.length, 1, 'one ask when nothing is missing');
  const [document] = client.asked[0].messages[0].content;
  assert.equal(document.type, 'document');
  assert.equal(document.source.data, CV.toString('base64'), 'the CV file the person chose is what is sent');
  assert.deepEqual(client.asked[0].output_config.format.schema, strategy.DRAFT_SCHEMA);
  assert.ok(draft.search.target_roles?.length, 'the draft names roles to search for (Main goals on the Strategy page)');
  assert.equal(typeof draft.profile_markdown, 'string');
});

test('a draft with a part missing is asked again once and refused when still missing', async () => {
  const empty = {...FICTIONAL_DRAFT, search: {...FICTIONAL_DRAFT.search, target_roles: []}};
  const client = fakeClient(JSON.stringify(empty));
  await assert.rejects(() => strategy.draft(storage, {}, 'test-key', client), /came back without/);
  assert.equal(client.asked.length, 2, 'asked again once, naming the missing part');
});
