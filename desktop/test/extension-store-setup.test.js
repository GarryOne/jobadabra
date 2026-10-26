// Every screen that installs the extension leads with the Chrome Web Store ("Add to Chrome"); Load unpacked stays only in the developer part.
// Owner, 26 Oct 2026: "we're going to change this section in the settings, but also in the wizard". Store ID: chromewebstore.google.com/detail/jobadabra/nmbnjhmpofifgcdalfefddbiihccogoi.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import * as ext from '../lib/extension-install.js';
import * as env from '../lib/server-env.js';
import * as server from '../lib/server.js';

const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
// One install surface's markup: from its opening tag to the next card on the same level.
const card = id => {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start > 0, `${id} is in index.html`);
  const next = html.slice(start + 10).search(/\n\s*<div (class="[^"]*(service-card|setting conn-panel)[^"]*"[^>]*id=|id="[^"]+" class="[^"]*(service-card|setting conn-panel))/);
  return html.slice(start, next < 0 ? undefined : start + 10 + next);
};
const SURFACES = ['extras-extension', 'setting-extension'];   // the setup wizard's extras step, Settings → Connections → Chrome extension

test('the store page the app opens is the item whose ID the app trusts', () => {
  assert.equal(env.STORE_EXTENSION_ID, 'nmbnjhmpofifgcdalfefddbiihccogoi');
  assert.ok(server.EXTENSION_IDS.includes(env.STORE_EXTENSION_ID));
  assert.equal(ext.STORE_URL, `https://chromewebstore.google.com/detail/jobadabra/${env.STORE_EXTENSION_ID}`);
});

test('every install surface offers Add to Chrome, and Load unpacked only under For developers', () => {
  for (const id of SURFACES) {
    const markup = card(id);
    assert.match(markup, /<button[^>]*data-add-extension[^>]*>[^<]*Add to Chrome/, `${id} has the Add to Chrome button`);
    const outsideDev = markup.replace(/<details[^>]*id="ext-dev"[\s\S]*?<\/details>/, '');
    assert.doesNotMatch(outsideDev, /Load unpacked|Developer mode|data-show-extension-folder/, `${id} explains the folder install only in the developer part`);
  }
});

test('a store copy is never told to reload itself', () => {
  const note = env.staleExtension('0.9.620', '0.9.625', env.STORE_EXTENSION_ID);
  assert.match(note, /Chrome Web Store/);
  assert.doesNotMatch(note, /reload|↻/i);
  assert.match(env.staleExtension('0.9.620', '0.9.625', server.EXTENSION_ID), /reload it once/, 'a folder copy still is');
  assert.equal(env.staleExtension('0.9.625', '0.9.625', env.STORE_EXTENSION_ID), '');
});
