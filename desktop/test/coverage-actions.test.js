// The buttons after a jobs check with few new jobs (renderer/coverage-actions.js): the coverage cards as one list, least effort first, each doing
// what its Strategy card does (owner, 6 Oct 2026: "buttons after the search is done").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {coverageActions, runAction} from '../renderer/coverage-actions.js';
import {keySources} from '../renderer/key-sources.js';
keySources.offered = true;   // these tests are about the source rows themselves; they are hidden by default (key-sources.js)

const verdict = {at: 'x', narrow: true, share: 0.01, in_places: 6477, matched: 2,
  excluded: [{fragment: 'stage', count: 4}], languages: [{language: 'english', count: 9}],
  suggestions: [{term: 'social media', count: 30}, {term: 'retail', count: 6}],
  places: {title_hits: 5, matched: 2, options: [{place: 'Lausanne', count: 7, fragment: 'lausanne'}]},
  sources: [{id: 'aggregators', name: 'Adzuna and Jooble', effort: 'Two free keys, about 3 minutes', gain: 'g'}]};

test('filters to remove, then role words, then places, then sources to connect', () => {
  assert.deepEqual(coverageActions(verdict).map(action => `${action.kind}:${action.value}`),
    ['exclude:stage', 'language:english', 'role:social media', 'role:retail', 'place:Lausanne', 'source:aggregators']);
  assert.deepEqual(coverageActions(null), []);
});

test('each action calls what its Strategy card calls', async () => {
  const called = [];
  const pilot = {addRoles: async terms => called.push(['addRoles', terms]) && {ok: true}, addPlaces: async names => called.push(['addPlaces', names]) && {ok: true},
    loosenSearch: async asked => called.push(['loosen', asked]) && {ok: true}};
  const openSetting = id => called.push(['openSetting', id]);
  for (const action of coverageActions(verdict)) await runAction(action, {pilot, openSetting});
  assert.deepEqual(called, [['loosen', {excludes: ['stage']}], ['loosen', {languages: ['english']}], ['addRoles', ['social media']], ['addRoles', ['retail']],
    ['addPlaces', ['Lausanne']], ['openSetting', 'aggregators']]);
});
