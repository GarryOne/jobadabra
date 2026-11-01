// Which navigations of an armed tab keep the fill mark (extension/tab-pages.js navigationKind): the page moving on by itself does, an address handed in from outside does not
// (14 Oct 2026: a GitHub PR page opened in an armed tab carried #jobadabra-fill=<session> and got the panel).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { navigationKind } from '../../extension/tab-pages.js';

const KEPT = {
  'a link clicked on a board to the employer (another host)': { transitionType: 'link', transitionQualifiers: [] },
  'a server redirect': { transitionType: 'link', transitionQualifiers: ['server_redirect'] },
  'a client redirect': { transitionType: 'link', transitionQualifiers: ['client_redirect'] },
  'a form post to the next step': { transitionType: 'form_submit', transitionQualifiers: [] },
  'a reload': { transitionType: 'reload', transitionQualifiers: [] },
};
for (const [name, details] of Object.entries(KEPT)) test(`${name} keeps the mark`, () => assert.equal(navigationKind(details), 'page'));

const LEFT = {
  'an address typed': { transitionType: 'typed', transitionQualifiers: ['from_address_bar'] },
  'a bookmark': { transitionType: 'auto_bookmark', transitionQualifiers: [] },
  'an address handed in from outside (from_api)': { transitionType: 'link', transitionQualifiers: ['from_api'] },
};
for (const [name, details] of Object.entries(LEFT)) test(`${name} lets the tab go`, () => assert.equal(navigationKind(details), 'by-hand'));

test('the extension moving the tab itself (from_api, noted by moveTab) keeps the mark', () => {
  assert.equal(navigationKind({ transitionType: 'link', transitionQualifiers: ['from_api'] }, true), 'page');
});

test('every chrome.tabs.update with a url in the extension goes through moveTab (class: a new one without it would drop the mark)', () => {
  const offenders = [];
  for (const file of fs.readdirSync(new URL('../../extension/', import.meta.url)).filter((name) => name.endsWith('.js') && name !== 'tabs.js')) {
    const lines = fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8').split('\n');
    lines.forEach((line, index) => { if (/chrome\.tabs\.update\([^)]*\{url:/.test(line)) offenders.push(`${file}:${index + 1}`); });
  }
  assert.deepEqual(offenders, []);
});
