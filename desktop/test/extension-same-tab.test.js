// One tab per application (extension/same-tab.js): only the posting whose Apply the extension just pressed, still on that page, is closed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FOLD_MS, postingToClose, realOpener} from '../../extension/same-tab.js';

const POSTING = 'https://live.solique.ch/manor/job/details/4080388/';
const pressed = new Map([[7, {at: 1000, url: `${POSTING}#jobpilotto-fill`}]]);

test('a tab the posting opens by script right after Apply was pressed: the posting closes, the new tab is the application', () => {
  assert.equal(postingToClose({id: 9, openerTabId: 7}, pressed, POSTING, 3000), 7);          // Manor: career55.sapsf.eu opened by script
});

test('never closed: a later pop-up, another tab\'s child, a tab the user opened, a posting that already moved on', () => {
  assert.equal(postingToClose({id: 9, openerTabId: 7}, pressed, POSTING, 1000 + FOLD_MS + 1), null);
  assert.equal(postingToClose({id: 9, openerTabId: 8}, pressed, POSTING, 1500), null);
  assert.equal(postingToClose({id: 9}, pressed, POSTING, 1500), null);
  // Apply's link was pointed at this tab, so it went on to the sign-in: it is the application now, whatever tab that page opens.
  assert.equal(postingToClose({id: 9, openerTabId: 7}, pressed, 'https://career55.sapsf.eu/careers?x=1', 1500), null);
});

test('two flows pressing Apply 2 s apart: each new tab closes only its own posting, never the other flow\'s tab', () => {
  const COOP = 'https://career2.successfactors.eu/career?company=coop', MANOR = POSTING;
  const flows = new Map([[11, {at: 0, url: COOP}], [22, {at: 2000, url: MANOR}]]);
  const shows = {11: COOP, 22: MANOR};
  assert.equal(postingToClose({id: 30, openerTabId: 22}, flows, shows[22], 2500), 22);   // Manor's new tab: Manor's posting
  assert.equal(postingToClose({id: 31, openerTabId: 11}, flows, shows[11], 2500), 11);   // Coop's own new tab: Coop's posting
  assert.equal(postingToClose({id: 32, openerTabId: 33}, flows, MANOR, 2500), null);     // a tab neither flow opened
  // Coop's tab moved on to its form: a tab its form opens later never closes it, though Manor pressed Apply 0.5 s ago.
  assert.equal(postingToClose({id: 34, openerTabId: 11}, flows, 'https://career2.successfactors.eu/form', 2500), null);
});

test('the opener is the page that really created the tab, not the tab in front (two applications side by side)', () => {
  const sources = new Map([[30, 11]]);   // the scripted posting (tab 11) opened tab 30 while the other job's tab (12) was in front
  assert.equal(realOpener({id: 30, openerTabId: 12}, sources), 11);
  assert.equal(realOpener({id: 31, openerTabId: 12}, sources), 12);   // no source event: Chrome's opener
  assert.equal(realOpener({id: 32}, sources), null);
  // and the posting that tab 30 folds is tab 11's, when that is the press
  const press = new Map([[11, {at: 1000, url: POSTING}]]);
  assert.equal(postingToClose({id: 30, openerTabId: realOpener({id: 30, openerTabId: 12}, sources)}, press, POSTING, 1000 + FOLD_MS - 1), 11);
});
