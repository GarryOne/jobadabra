// Advice shown and taken (7 Oct 2026): every place that recommends a search change records it with fixed names only, never the word itself.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {adviceEvent} from '../renderer/coverage-actions.js';
import {keySources} from '../renderer/key-sources.js';
keySources.offered = true;   // these tests are about the source rows themselves; they are hidden by default (key-sources.js)
import {activitySource} from './activity-source.js';

test('fixed kinds only, shown once per place a session, never the role word or place', () => {
  const sent = [];
  const record = (kind, fields) => sent.push([kind, fields]);
  assert.equal(adviceEvent('shown', 'coverage', 'strategy', {record}), true);
  assert.equal(adviceEvent('shown', 'coverage', 'strategy', {record}), false, 'once a session');
  adviceEvent('taken', 'exclude', 'few-jobs', {record, source: 'photographe'});
  adviceEvent('taken', 'source', 'few-jobs', {record, source: 'brave'});
  adviceEvent('taken', 'mystery', 'few-jobs', {record});
  assert.deepEqual(sent, [['advice', {act: 'shown', advice: 'role', where: 'strategy'}], ['advice', {act: 'taken', advice: 'filter', where: 'few-jobs'}],
    ['advice', {act: 'taken', advice: 'source', where: 'few-jobs', source: 'brave'}]]);
});

test('every recommending card records shown and taken (a new card without it fails here)', () => {
  const strategy = readFileSync(new URL('../renderer/pages/strategy-suggestions.js', import.meta.url), 'utf8');
  const activity = activitySource();
  // Every Strategy suggestion is a row drawn by suggestionRow (records shown); each kind records taken (widen or its own call) and dismissed (⋯).
  assert.match(strategy, /function suggestionRow[\s\S]*?adviceEvent\('shown', kind/);
  assert.match(strategy, /const widen = [\s\S]*?adviceEvent\('taken', kind/);
  assert.match(strategy, /const hideItem = [\s\S]*?adviceEvent\('dismissed', kind/);
  const kinds = [...strategy.matchAll(/suggestionRow\(\{kind: '(\w+)'/g)].map(match => match[1]);
  assert.deepEqual([...kinds].sort(), ['coverage', 'employer', 'filters', 'ideas', 'places', 'source', 'visit']);
  for (const kind of kinds) {
    assert.match(strategy, new RegExp(`widen\\('${kind}'|adviceEvent\\('taken', '${kind}'`), `${kind}: no "taken"`);
    assert.match(strategy, new RegExp(`hideItem\\('${kind}'|adviceEvent\\('dismissed', '${kind}'`), `${kind}: no "dismissed"`);
  }
  assert.match(activity, /adviceEvent\('shown', action\.kind[\s\S]*?adviceEvent\('taken', action\.kind/);
});

test('the sources card says what a source gave people like you; the employers card lists where they got interviews', async () => {
  const {employersCard, sourcesCard} = await import('../renderer/coverage-card.js');
  const sources = sourcesCard({at: 'x', sources: [{id: 'aggregators', name: 'Adzuna and Jooble', effort: 'Two free keys', gain: 'all trades', people: 'gave a match to 8 in 10 people like you'}]});
  assert.equal(sources.chips[0].label, '+ Adzuna and Jooble · gave a match to 8 in 10 people like you');
  const card = employersCard({at: 'x', for_you: [{company: 'Studio Geneva', interview: 1, applied: 3, why: 'kind of work'}]});
  assert.equal(card.chips[0].label, 'Studio Geneva · 1 interview');
  assert.equal(employersCard({at: 'x', for_you: []}), null);
});

test('the Few new jobs box: employer numbers with one recommendation, words as rows, sources and sites as rows', async () => {
  const {fewJobsGroups} = await import('../renderer/coverage-actions.js');
  const verdict = {at: 'x', employers: {read: 21, matched: 3, pending: 14}, suggestions: [{term: 'social media', count: 31}], narrow: true,
    sources: [{id: 'aggregators', name: 'Adzuna and Jooble', effort: 'Two free keys, about 3 minutes', gain: 'all trades', people: ''}],
    visits: [{name: 'LinkedIn', url: 'https://www.linkedin.com/jobs/search/?keywords=x', kind: 'portal', why: 'no way in but your own visit', last_read: null}]};
  const groups = fewJobsGroups(verdict);
  assert.equal(groups.employers.dry, true, '3 of 21 with a match: running dry');
  assert.equal(groups.employers.explore, 'Checks up to 40 employer ideas per run · About 3 min');
  assert.deepEqual(groups.words.map(action => [action.row.title, action.row.sub, action.row.button, action.row.review]),
    [['Add "social media" to your role words', '31 postings in your places your role words miss', 'Review role word', 'coverage']]);
  assert.equal(groups.employers.fill, 14);
  assert.deepEqual(groups.sources.map(row => [row.name, row.sub]), [['Adzuna and Jooble', 'Two free keys, about 3 minutes']]);
  assert.deepEqual(groups.visits.map(row => [row.name, row.sub]), [['LinkedIn', 'your search']]);
  assert.ok(groups.words.every(action => !['source', 'visit'].includes(action.kind)), 'sources and sites are rows, not chips');
  assert.equal(fewJobsGroups({at: 'x'}).employers, null, 'no counts yet: no meter');
  assert.match(fewJobsGroups({employers: {read: 10, matched: 6, pending: 0}}).employers.explore, /Every idea tried/);
  // One company on two pages is one site in the count; both pages are read.
  const twice = fewJobsGroups({visits: [{name: 'Tiffany & Co.', url: 'https://www.tiffany.com', kind: 'employer', why: 'x'},
    {name: 'Tiffany & Co.', url: 'https://www.tiffanycareers.com', kind: 'employer', why: 'x'}, {name: 'Rolex', url: 'https://www.rolex.com', kind: 'employer', why: 'x'}]});
  assert.deepEqual([twice.siteNames, twice.visits.length], [['Tiffany & Co.', 'Rolex'], 3]);
});

test('every button Recent activity redraws that waits on something keeps its busy and done state (one mechanism; a new one without it fails here)', () => {
  const activity = activitySource();
  // Buttons made while drawing (a name, not a fixed $('…') element) whose click awaits something.
  const waiting = [...activity.matchAll(/\b(\w+)\.addEventListener\('click', async/g)].map(found => found[1]);
  const kept = new Set([...activity.matchAll(/(?:keepPress|keepButton)\((?:[^,()]|\([^()]*\))+, (\w+)\)/g)].map(found => found[1])
    .concat([...activity.matchAll(/const (\w+) = keepPress\(/g)].map(found => found[1])));
  for (const name of waiting) assert.ok(kept.has(name), `${name}: a redrawn button that waits, without keepPress`);
  assert.ok(waiting.length >= 4, 'Read with Claude, the Find jobs using your browser row links, the few-jobs chips and Set up, Read them in Chrome');
  const start = activity.indexOf('function withFewJobsHelp('), box = activity.slice(start, activity.indexOf('\n}\n', start));
  assert.doesNotMatch(box, /\.disabled = (true|false)/, 'no button in the few-jobs box is disabled by hand');
});

test('Your employers says how many searches are left before they rest, and what Find jobs has untried', async () => {
  const {fewJobsGroups, runwayWords} = await import('../renderer/coverage-actions.js');
  const soon = {resting: 0, until: null, soon: {runs: 2, count: 242}, rest_after: 5, rest_days: 7};
  const groups = fewJobsGroups({employers: {read: 252, matched: 3, pending: 609, batch: 100, runway: soon}});
  assert.equal(groups.employers.runway, 'If the next 2 searches find nothing new for them, 242 of 252 employers rest for 7 days. An employer rests after 5 searches in a row with nothing for you.');
  assert.equal(groups.employers.explore, 'Checks up to 100 employer ideas per run · About 3 min');
  assert.match(runwayWords({resting: 242, until: '2026-10-14T03:00:00+00:00', soon: null, rest_after: 5, rest_days: 7}, 252),
    /^242 of 252 employers resting until 14 Oct: Find jobs again to keep searching$/);
  assert.equal(runwayWords(null, 252), '');
});
