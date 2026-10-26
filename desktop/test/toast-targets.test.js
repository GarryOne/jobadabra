// Every pop-up and notification says where a click on it leads (owner, 27 Oct 2026: "on clicking on any notification, it should forward/redirect us
// and highlight a specific section/screen/card"): a target (renderer/targets.js), or NO_PLACE.<reason> when there is none. A new toast without one fails here.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean, NO_PLACE, plan} from '../renderer/targets.js';
import {missing, sites, topLevel} from './toast-scan.js';

test('the scanner finds the toast calls (a positive control: the count only grows by new toasts)', () => {
  const all = sites();
  assert.ok(all.length >= 130, `found only ${all.length} toast calls: the scanner broke`);
  assert.ok(all.some(site => site.where.startsWith('renderer/pages/jobs-render.js')));
  assert.ok(all.some(site => site.where.startsWith('lib/kit-handlers.js')));
});

test('every toast and notification names where a click leads, or NO_PLACE with its reason', () => {
  const bad = sites().map(site => ({...site, why: missing(site.args)})).filter(site => site.why);
  assert.deepEqual(bad.map(site => `${site.where}: ${site.why}`), [], 'give each a target ({view, section, job, session, run, card}) or NO_PLACE.<reason>');
});

test('the checker tells a target from none', () => {
  assert.equal(missing("'Saved', 'It is saved.'"), 'no target and no NO_PLACE reason');
  assert.equal(missing("'Saved', 'It is saved.', {view: 'jobs', job: code}"), null);
  assert.equal(missing("'Log copied', 'On the clipboard.', NO_PLACE.done"), null);
  assert.match(missing("'x', 'y', NO_PLACE.nowhere"), /not one of/);
  assert.equal(missing("{title: 'Moved', body: `${a, b}`, target: {view: 'jobs'}}"), null);
  assert.equal(missing("{title: 'Moved', body: 'x', action}"), 'no target and no NO_PLACE reason');
  assert.equal(missing('body'), null);
  assert.deepEqual(topLevel("'a, b', `c ${d, e}`, {f: 1, g: 2}"), ["'a, b'", '`c ${d, e}`', '{f: 1, g: 2}']);
});

test('a card target opens that card, and a NO_PLACE reason opens nothing', () => {
  assert.deepEqual(clean({card: 'license'}), {card: 'license'});
  assert.deepEqual(plan({card: 'license'}), ['card:license']);
  assert.equal(clean({card: 'x"><img'}), null);
  for (const reason of Object.values(NO_PLACE)) assert.equal(clean(reason), null);
});
