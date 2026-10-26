// Every pop-up and notification says where a click on it leads (owner, 27 Oct 2026: "on clicking on any notification, it should forward/redirect us
// and highlight a specific section/screen/card"): a target (renderer/targets.js), or NO_PLACE.<reason> when there is none. A new toast without one fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {clean, NO_PLACE, plan} from '../renderer/targets.js';
import {DESKTOP, jsFiles, missing, sites, topLevel} from './toast-scan.js';

test('the scanner finds the toast calls (a positive control: the count only grows by new toasts)', () => {
  const all = sites();
  assert.ok(all.length >= 130, `found only ${all.length} toast calls: the scanner broke`);
  assert.ok(all.some(site => site.where.startsWith('renderer/pages/jobs-render.js')));
  assert.ok(all.some(site => site.where.startsWith('lib/kit-handlers.js')));
});

test('every toast and notification names where a click leads, or NO_PLACE with its reason', () => {
  // sayRefused(title, result, {place}): its options object names the place (or NO_PLACE.<reason> as place).
  const why = site => site.place ? (/\bplace\s*:/.test(topLevel(site.args)[2] || '') ? null : 'sayRefused needs {place: …} as its 3rd argument') : missing(site.args);
  const bad = sites().map(site => ({...site, why: why(site)})).filter(site => site.why);
  assert.deepEqual(bad.map(site => `${site.where}: ${site.why}`), [], 'give each a target ({view, section, job, session, run, card}) or NO_PLACE.<reason>, and a tone (bad | warn | good | info)');
});

test('the checker tells a target from none', () => {
  assert.equal(missing("'Saved', 'It is saved.'"), 'no target and no NO_PLACE reason');
  assert.equal(missing("'Saved', 'It is saved.', {view: 'jobs', job: code}"), 'no tone (bad | warn | good | info)');
  assert.equal(missing("'Saved', 'It is saved.', {view: 'jobs', job: code}, 'good'"), null);
  assert.match(missing("'Saved', 'x', {view: 'jobs'}, 'green'"), /not one of/);
  assert.equal(missing("'Saved', 'x', {view: 'jobs'}, result.ok ? 'good' : 'bad'"), null);
  assert.equal(missing("'Log copied', 'On the clipboard.', NO_PLACE.done, 'good'"), null);
  assert.match(missing("'x', 'y', NO_PLACE.nowhere"), /not one of/);
  assert.equal(missing("{title: 'Moved', body: `${a, b}`, target: {view: 'jobs'}, tone: 'good'}"), null);
  assert.equal(missing("{title: 'Moved', body: 'x', target: {view: 'jobs'}}"), 'no tone (bad | warn | good | info)');
  assert.equal(missing("{title: 'Moved', body: 'x', hint}"), 'no target and no NO_PLACE reason');
  assert.equal(missing("{title: 'Saved', body: 'x', action: refreshAction, tone: 'good'}"), null);   // the click runs it
  assert.equal(missing('body'), null);
  assert.deepEqual(topLevel("'a, b', `c ${d, e}`, {f: 1, g: 2}"), ["'a, b'", '`c ${d, e}`', '{f: 1, g: 2}']);
});

test('a card target opens that card, and a NO_PLACE reason opens nothing', () => {
  assert.deepEqual(clean({card: 'license'}), {card: 'license'});
  assert.deepEqual(plan({card: 'license'}), ['card:license']);
  assert.equal(clean({card: 'x"><img'}), null);
  for (const reason of Object.values(NO_PLACE)) assert.equal(clean(reason), null);
});

// Owner, 27 Oct 2026: "The toast notifications shouldn't really have a button, but just clicking them, should produce an action, or higlight a
// section or direct to a a screen/tab". The one exception: the "Why dismiss?" pop-up (dismiss-reason.js), whose chips are the answers it asks for.
test('a pop-up has no button: its click runs its action or opens its place', () => {
  const read = file => fs.readFileSync(path.join(DESKTOP, file), 'utf8');
  const maker = read('renderer/pages/startup.js').split('export function toastMessage')[1].split('\nexport ')[0];
  assert.doesNotMatch(maker, /createElement\('button'\)|<button/, 'toastMessage draws no button');
  assert.match(maker, /addEventListener\('click', \(\) => \{ toast\.remove\(\); if \(action\) action\.run\(\); else if \(place\) openTarget\(place\); \}\)/);
  const css = read('renderer/style.css');
  assert.doesNotMatch(css, /\.toast \.toast-action|\.toast button/, 'no button style inside a pop-up');
  const withButtons = jsFiles('renderer').filter(file => /className: 'toast[ '`]/.test(read(file)) && /createElement\('button'\)|el\('button'/.test(read(file)));
  assert.deepEqual(withButtons.map(file => file.replaceAll('\\', '/')).filter(file => file !== 'renderer/pages/startup.js'), ['renderer/pages/dismiss-reason.js']);
});
