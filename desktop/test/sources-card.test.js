// "More places to find jobs" (renderer/coverage-card.js sourcesCard): the unused job sources the engine lists (src/coverage.py unused_sources), in its
// order (least effort first), each a chip to its Settings panel; nothing when all are in use or after "Not now" for this crawl.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sourcesCard} from '../renderer/coverage-card.js';
import {keySources} from '../renderer/key-sources.js';
keySources.offered = true;   // these tests are about the source rows themselves; they are hidden by default (key-sources.js)

const verdict = {at: '2026-10-06T19:51', sources: [
  {id: 'aggregators', name: 'Adzuna and Jooble', effort: 'Two free keys, about 3 minutes', gain: 'job search engines across all trades and countries'},
  {id: 'serpapi', name: 'Google Jobs (SerpApi)', effort: 'A free key (250 searches a month); paid plans beyond', gain: 'jobs Google has collected'}]};

test('the unused sources, in the engine\'s order, each a chip to its panel', () => {
  const card = sourcesCard(verdict);
  assert.equal(card.title, 'More places to find jobs');
  assert.deepEqual(card.chips.map(chip => chip.id), ['aggregators', 'serpapi']);
  assert.match(card.chips[0].label, /Adzuna and Jooble · Two free keys/);
  assert.match(card.chips[1].title, /paid plans beyond/);
});

test('nothing when every source is in use, or after Not now for this crawl', () => {
  assert.equal(sourcesCard({...verdict, sources: []}), null);
  assert.equal(sourcesCard(verdict, verdict.at), null);
  assert.equal(sourcesCard(null), null);
});
