// Demo mode has no extension to report Chrome's tabs, so the Applying card waited on "Checking Chrome…" for ever (owner, 24 Oct 2026, the site hero's
// Apply clip). The demo now counts every session with a form state in review.json as open in Chrome (lib/demo.js demoFormsOpen).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {demoFormsOpen, demoPath} from '../lib/demo.js';
import {checkingTabs, chromeSilent} from '../renderer/session-state.js';

const desktop = path.join(import.meta.dirname, '..');

test('the demo reports each form in review.json as open, so its card shows the form, not "Checking Chrome"', () => {
  const states = JSON.parse(fs.readFileSync(demoPath(desktop, 'review.json'), 'utf8'));
  const open = demoFormsOpen(states);
  assert.equal(open.known, true);
  assert.deepEqual(open.ids, states.map(state => String(state.id)));
  assert.ok(open.ids.length >= 1, 'the demo has at least one form open');
  assert.deepEqual(demoFormsOpen(null), {known: true, ids: [], unsure: []}, 'no review.json list: nothing open');
  for (const id of open.ids) {
    const item = {id, kind: 'form', status: 'done'};
    assert.equal(checkingTabs(item, open, 60 * 1000), false, `${id}: not "Checking" after the first look`);
    assert.equal(chromeSilent(item, open, 60 * 1000), false, `${id}: not "Chrome isn't reporting"`);
  }
});

test('demoLinkSilent: the link is up and nothing is reported, so the card turns "Chrome isn\'t reporting" after WAIT_MS', () => {
  const silent = demoFormsOpen([{id: 'f1'}], {demoLinkSilent: true}), item = {id: 'f1', kind: 'form', status: 'done'};
  assert.deepEqual(silent, {known: false, ids: []}, 'no linkOff: the socket is open');
  assert.equal(chromeSilent(item, silent, 70 * 1000), true);
  assert.equal(chromeSilent(item, silent, 10 * 1000), false, 'before the wait it is a neutral first look');
});

test('the formsOpen handler answers from the demo\'s forms in demo mode', () => {
  const source = fs.readFileSync(path.join(desktop, 'lib/apply-handlers.js'), 'utf8');
  assert.match(source, /ipcMain\.handle\('formsOpen', async \(\) => \{\n\s+if \(DEMO\) return demoFormsOpen\(JSON\.parse\(fs\.readFileSync\(demoPath\(here, 'review\.json'\)/);
});
