// "Your search changed" shows after a Strategy save and until a refresh has finished (owner, 7 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {mainSource} from './main-source.js';

test('shown after a save, gone once a refresh finished after it', async () => {
  const source = fs.readFileSync(new URL('../renderer/search-changed.js', import.meta.url), 'utf8');
  const fn = source.match(/export const searchChanged = (settings => [\s\S]+?);\n/)[1];
  const searchChanged = eval(fn);
  assert.equal(searchChanged({}), false, 'never edited');
  assert.equal(searchChanged({searchChangedAt: '2026-10-07T12:30:00Z', lastSearchAt: '2026-10-07T12:01:00Z'}), true);
  assert.equal(searchChanged({searchChangedAt: '2026-10-07T12:30:00Z'}), true, 'no refresh yet at all');
  assert.equal(searchChanged({searchChangedAt: '2026-10-07T12:30:00Z', lastSearchAt: '2026-10-07T12:40:00Z'}), false);
  assert.equal(searchChanged({searchChangedAt: '2026-10-07T12:18:24.126Z', lastSearchStartedAt: '2026-10-07T12:15:00Z',
    lastSearchAt: '2026-10-07T12:18:24.672Z'}), true, 'saved during a refresh that began before it: not applied yet');
  const main = mainSource();
  assert.match(main, /const markSearchChanged = result => \{\s*if \(\[result\?\.added, result\?\.removed, result\?\.changed\]\.some\(list => list\?\.length\)\) storage\.saveSettings\(\{searchChangedAt:/,
    'a change that added, removed or changed something sets it');
});

test('the banner goes while a refresh runs or waits, through the same signal as the Refresh buttons', () => {
  const runs = fs.readFileSync(new URL('../renderer/pages/runs-page.js', import.meta.url), 'utf8');
  assert.match(runs, /export function syncRunButtons\(busy, runningKind = null\) \{\n  refreshBusy\(busy\.includes\('search'\)\);/);
  const jobs = fs.readFileSync(new URL('../renderer/pages/jobs.js', import.meta.url), 'utf8');
  assert.match(jobs, /export async function startSearch\(why = undefined\) \{\n  refreshBusy\(true\);/, 'a click hides it at once');
  const banner = fs.readFileSync(new URL('../renderer/search-changed.js', import.meta.url), 'utf8');
  assert.match(banner, /box\.hidden = refreshing \|\| !searchChanged\(settings\)/);
});

test('every handler that writes the search marks it changed, so Strategy and Jobs say "Refresh jobs" (a new one without it fails here)', async () => {
  const main = mainSource();
  const writes = [...main.matchAll(/await strategy\.(addRoles|addPlaces|loosen|editLists|retune)\(/g)];
  assert.ok(writes.length >= 5, `the search writers: ${writes.map(found => found[1]).join(', ')}`);
  for (const found of writes) {
    const before = main.slice(Math.max(0, found.index - 40), found.index);
    assert.match(before, /markSearchChanged\($/, `strategy.${found[1]}: its result does not go through markSearchChanged`);
  }
});
