// The extension's missing-letter setup link and delivery-failure action keep their existing destinations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('scenario: the cover-letter notice opens Profile for setup and leaves a rejected letter for manual recovery', () => {
  const panel = read('../../extension/panel-markup.js');
  const extensionReview = read('../../extension/review.js');
  const messages = read('../../extension/messages-panel.js');
  const handlers = read('../lib/ext-server-handlers.js');
  assert.match(panel, /class="letter-setup verify letter-notice"/);
  assert.match(extensionReview, /letterState === 'missing' \? 'Create in Profile → Cover letter'/);
  assert.match(extensionReview, /letterState === 'draft' \? 'Review in Profile → Cover letter'/);
  assert.match(extensionReview, /letterRejected \? flash\(letterRejected\.el\) : ask\(event\.currentTarget, 'Opening…', \{type: 'panelOpenApp', session: 'setup:cover-letter'\}/);
  assert.match(extensionReview, /Open its field, paste or attach it manually, then check again/);
  assert.match(messages, /message\?\.type === 'panelOpenApp'[\s\S]*?\/extension\/open/);
  assert.match(handlers, /if \(id === 'setup:cover-letter'\) toWindow\('openTarget', \{card: 'letter'\}\)/);
});
