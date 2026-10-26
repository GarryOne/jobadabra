// Result panels stay basic (owner, 24 Oct 2026): no API-key setup rows, no internal counts (employers checked, ideas left, schedules), no scoring words; details live only in Reports.
// Guards: renderer/pages/activity-*.js (run cards, drawer header, few-jobs boxes), renderer/key-sources.js, src/coverage.py KEY_SOURCES_OFFERED.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {keySources, KEY_SOURCE_IDS, offered, shownLists} from '../renderer/key-sources.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const CARDS = ['activity-render.js', 'activity-run-card.js', 'activity-few-jobs.js', 'activity-basics.js'].map(name => [name, read(`renderer/pages/${name}`)]);
// The words a run card or its header may not draw (comments are skipped below).
const INTERNAL = [/companies checked/, /Started: /, /'This Mac'/, /employer ideas?\b/, /How employer checks are scheduled/, /numberStrip/, /employers? checked/, /Not scored/, /'primary/];   // one filled action per panel: Look further is secondary

const code = text => text.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');

test('no run card or header draws an internal count, a schedule or who started the run', () => {
  for (const [name, text] of CARDS) for (const word of INTERNAL) assert.doesNotMatch(code(text), word, `${name} draws ${word}`);
});

test('no step label a user sees names scoring, and no step line carries its counts', () => {
  const basics = code(read('renderer/pages/activity-basics.js'));
  for (const label of basics.matchAll(/label: '([^']+)'/g)) assert.doesNotMatch(label[1], /scor/i);
  assert.match(basics, /\^Scored[^\n]*return 'Matching jobs to your profile'/);
  assert.match(basics, /\^Enriched[^\n]*return 'Reading new jobs'/);
});

test('the three API-key sources are offered nowhere while the flag is off, and Python agrees', () => {
  assert.equal(keySources.offered, false);
  for (const id of KEY_SOURCE_IDS) assert.equal(offered(id), false);
  assert.match(read('../src/coverage.py'), /^KEY_SOURCES_OFFERED = False$/m);
  assert.match(read('renderer/pages/settings.js'), /ALL_SERVICES\.filter\(service => offered\(service\.id\)\)/);
});

test('Strategy draws no Google Jobs searches or places while Google Jobs is parked, and keeps them once it is back', () => {
  const lists = [['finders', 'Words that find new employers'], ['gqueries', 'Google Jobs searches'], ['gplaces', 'Google Jobs places']];
  assert.deepEqual(shownLists(lists).map(([name]) => name), ['finders']);
  const targets = read('renderer/pages/strategy-targets.js'), skeleton = read('renderer/pages/strategy.js');
  assert.match(targets, /of shownLists\(lists\)/, 'the open editor');
  assert.match(targets, /offered\('serpapi'\) \? \[row\('search', 'Google Jobs searches'/, 'the read view');
  assert.match(skeleton, /of shownLists\(lists\)/, 'the loading skeleton');
  keySources.offered = true;
  try { assert.equal(shownLists(lists).length, 3); } finally { keySources.offered = false; }
});

test('a coverage answer that still carries the key sources draws no row for them', async () => {
  const {fewJobsGroups} = await import('../renderer/coverage-actions.js');
  const {sourcesCard} = await import('../renderer/coverage-card.js');
  const verdict = {sources: KEY_SOURCE_IDS.map(id => ({id, name: id, effort: 'x', gain: 'y'}))};
  assert.deepEqual(fewJobsGroups(verdict).sources, []);
  assert.equal(sourcesCard(verdict), null);
});
