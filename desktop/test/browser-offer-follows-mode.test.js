// B follow-up 2 (28 Oct 2026): the Applying page offered Jobadabra's browser download only if Background automation was already saved at start-up, so choosing it
// in Settings later showed nothing until a restart. One rule (needsBrowser) now serves the start-up and every Settings save.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {MODES, needsBrowser} from '../renderer/apply-settings-model.js';
import {browserView} from '../renderer/pages/browser-progress.js';

test('the saved mode decides whether the browser is offered', () => {
  assert.equal(needsBrowser({apply: {mode: 'fill', chosenAt: '2026-10-28T10:00:00.000Z'}}), true);
  assert.equal(needsBrowser({apply: {mode: 'check'}}), false);
  assert.equal(needsBrowser({}), false, 'nothing saved is Standard automation');
  assert.equal(needsBrowser(undefined), false);
});

// #2485: Full automation runs in the same hidden browser, but its save read as "no browser needed", so the download offer stayed hidden and every start failed with BACKGROUND_BROWSER_MISSING.
test('every mode that runs in the hidden browser offers its download, Full automation included', () => {
  const hidden = MODES.filter(mode => mode.runner === 'background').map(mode => mode.id);
  assert.deepEqual(hidden, ['fill', 'auto']);
  for (const id of hidden) assert.equal(needsBrowser({apply: {mode: id, chosenAt: '2026-11-01T10:00:00.000Z', autoConfirmedAt: '2026-11-01T10:00:00.000Z'}}), true, id);
  for (const mode of MODES.filter(item => item.runner !== 'background')) assert.equal(needsBrowser({apply: {mode: mode.id}}), false, mode.id);
});

test('a change from Standard to Background automation turns the offer on at once, and back off', () => {
  const before = browserView({step: 'none'}, {offer: needsBrowser({apply: {mode: 'check'}})});
  const after = browserView({step: 'none'}, {offer: needsBrowser({apply: {mode: 'fill'}})});
  assert.deepEqual(before, {hidden: true});
  assert.match(after.title, /needs Jobadabra's browser/);
  assert.equal(after.action, 'Download');
  assert.deepEqual(browserView({step: 'ready'}, {offer: true}), {hidden: true}, 'an installed browser is never offered');
});

test('Settings saves and the start-up use that one rule', () => {
  const read = file => fs.readFileSync(new URL(`../renderer/pages/${file}`, import.meta.url), 'utf8');
  assert.match(read('apply-settings.js'), /if \(saved\) offerBrowser\(\$\('ss-browser'\), needsBrowser\(saved\)\);/);
  assert.match(read('session-log.js'), /offerBrowser\(\$\('ss-browser'\), needsBrowser\(/);
});
