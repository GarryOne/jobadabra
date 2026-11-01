// Layer 3 (Node + the app's own modules over a temp folder, a stand-in for the AI client, no window, no browser): a menu whose choices are not the answer's words (night journey J15, Tier 2 since
// 1 Nov 2026, so no longer an e2e step; Coop, 8 Oct 2026: "+41" asked, country names listed). Moved from the e2e applyflows step 'a menu whose choices are not the answer's words: the choice that means
// the same is picked, then remembered for the next form on the site'. The app's half: the form reports the menu with its choices, the app asks the AI ONCE for the choice that means the same, arms the menu
// with it (lib/menu-rearm.js), remembers it for the site (lib/menu-choices.js) and hands it to the next form there with the details (lib/server-contact.js `me`), so the next form needs no ask.
// The extension's half (the menu reported, the armed choice put in, a remembered choice tried first) is integration/extension/extension-form-shapes.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {loadAppModule} from '../../e2e/lib/app-module.mjs';
import {MENU_AGAIN, MENU_CHOICES, MENU_FIRST} from '../../e2e/lib/forms.mjs';

const plainCrypto = {encrypt: value => value, decrypt: value => value};
let storage, folder, menuRearm, me, pickAsks;

before(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-menu-choice-'));
  const {createStorage} = await loadAppModule('storage.js');
  ({menuRearm} = await loadAppModule('menu-rearm.js'));
  ({me} = await loadAppModule('server-contact.js'));
  storage = createStorage(folder, plainCrypto);
  storage.saveSettings({store: 'sqlite', telemetry: false});
  pickAsks = [];
});
after(() => fs.rmSync(folder, {recursive: true, force: true}));

// The AI client lib/option-pick.js asks: it answers like a model that knows "+41" is Switzerland, and counts each ask.
const client = {messages: {create: async request => {
  pickAsks.push(request);
  return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({choice: 'Suisse'})}]};
}}};
const report = fixture => ({id: 'form-1', tab: 1, url: fixture.url, pending: ['Indicatif de pays'], proposals: [{label: 'Indicatif de pays', value: '+41', key: '', options: MENU_CHOICES}]});

test('the menu\'s choice is picked once, armed, remembered for the site and handed to the next form', async () => {
  const armed = [];
  const listen = menuRearm({storage, client: () => client, queueFill: (id, label, choice) => armed.push([id, label, choice]), later: () => {}});

  listen(report(MENU_FIRST));
  for (let waited = 0; !armed.length && waited < 200; waited += 1) await new Promise(resolve => setImmediate(resolve));   // the pick is a promise: wait for its state, not a time
  assert.deepEqual(armed, [['form-1', 'Indicatif de pays', 'Suisse']], 'the menu was not armed with the choice that means "+41"');
  assert.equal(pickAsks.length, 1, 'the AI was not asked exactly once for "+41"');

  listen(report(MENU_FIRST));   // the same form reports again: once per field, answer and choices
  assert.equal(pickAsks.length, 1, 'the same menu, answer and choices were asked about again');

  const details = await me(storage, MENU_AGAIN.url);
  assert.deepEqual(details.menuChoices.filter(item => item.host === MENU_AGAIN.host).map(item => [item.label, item.value, item.choice]), [['Indicatif de pays', '+41', 'Suisse']],
    'the choice was not remembered for the site, so the next form there would ask again');
});
