// The extension's missing-letter setup link and delivery-failure action keep their existing destinations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('the shared cover-letter notice uses compact styles and keeps its existing setup/recovery routes', () => {
  const panel = read('../../extension/panel-markup.js');
  const extensionReview = read('../../extension/review.js');
  const messages = read('../../extension/messages-panel.js');
  const handlers = read('../lib/ext-server-handlers.js');
  assert.match(panel, /class="letter-setup verify letter-notice"/);
  assert.match(panel, /\.letter-notice \{ display: grid; grid-template-columns: 16px minmax\(0, 1fr\)/);
  assert.match(panel, /background: var\(--soft\);/);
  assert.match(panel, /\.letter-action:focus-visible \{ outline: 2px solid var\(--info\)/);
  assert.match(panel, /width: min\(372px, calc\(100vw - 24px\)\)/);
  assert.match(extensionReview, /letterState === 'missing' \? 'Create in Profile → Cover letter'/);
  assert.match(extensionReview, /letterState === 'draft' \? 'Review in Profile → Cover letter'/);
  assert.match(extensionReview, /letterRejected \? flash\(letterRejected\.el\) : ask\(event\.currentTarget, 'Opening…', \{type: 'panelOpenApp', session: 'setup:cover-letter'\}/);
  assert.match(extensionReview, /Open its field, paste or attach it manually, then check again/);
  assert.match(messages, /message\?\.type === 'panelOpenApp'[\s\S]*?\/extension\/open/);
  assert.match(handlers, /if \(id === 'setup:cover-letter'\) toWindow\('openTarget', \{card: 'letter'\}\)/);
});
