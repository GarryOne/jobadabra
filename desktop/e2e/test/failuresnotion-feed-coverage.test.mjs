// Enumerate failuresnotion's feed asks offline so a refusal cannot hide another question form.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {loadTable, questionOf} from '../lib/ai-answers.mjs';
import {canonical, hash} from '../lib/ai-answers-engine-items.mjs';
import {ZURICH} from '../lib/feeds.mjs';
import {fragmentNames} from '../../renderer/fragment-words.js';
import {withDerived} from '../../lib/target-roles.js';

const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const source = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
const captured = read('../fixtures/golden/failuresnotion-asks.json');
const previous = ['failuresnotion-missing-keys.json', 'failuresnotion-run2-keys.json']
  .flatMap(file => read(`../fixtures/golden/${file}`));
const activity = source('../suites/activityfailures.mjs');
const helpers = source('../lib/activity-steps.mjs');
const draft = read('../../demo/draft.json').draft;
const feed = file => read(`../fixtures/feeds/${file}`);
const tuple = ({title, company, location}) => ({company: company.trim(), location: location.trim(), title: title.trim()});

// Execute only the feed builder and literal fault data, with an in-memory writer and no app imports.
const faultList = activity.match(/const NOTION_FAULTS = (\[[\s\S]*?\n    \]);/);
const setFeedBody = helpers.match(/export function setFeed\([\s\S]*?\n}/);
assert.ok(faultList && setFeedBody, 'Notion fault/feed definitions must remain enumerable');
const faults = runInNewContext(faultList[1]);
const writes = new Map();
const setFeed = runInNewContext(`const feedIds = new WeakMap(); (${setFeedBody[0].replace('export ', '')})`, {
  fs: {writeFileSync: (file, text) => writes.set(file, JSON.parse(text))}, path: {join: (...parts) => parts.join('/')},
});
const calls = activity.slice(activity.indexOf("if (parts.includes('notion'))"), activity.indexOf("if (parts.includes('channels'))"))
  .match(/setFeed\(ctx, [^;]+/g);
assert.ok(calls?.length, 'the Notion branch must declare its feed calls');
const company = feed('sources.json')[0].company;
const generated = [];
for (const call of calls) for (const fault of call.includes('fault.mode') ? faults : [null]) {
  runInNewContext(call, {ctx: {feeds: 'memory'}, fault, setFeed});
  generated.push(...writes.get('memory/acme.json').jobs.map(job => ({title: job.title, company, location: job.location.name})));
}
const routes = feed('routes.json');
const scout = feed('scout_seeds.json').tier1_known.flatMap(site => {
  const file = routes[`/boards/${site.slug}/jobs`];
  assert.ok(file, `missing scout fixture: ${site.slug}`);
  return feed(file).jobs.map(job => ({title: job.title, company: site.name, location: job.location.name}));
});
const postings = [...new Map([...generated, ...scout, ...captured.feedPostings].map(post => [canonical(tuple(post)), tuple(post)])).values()];
const enrichmentPostings = postings.flatMap(post => (ZURICH.includes(post.location) ? ZURICH : [post.location])
  .map(location => ({...post, location})));
const locations = [...new Set([...postings.map(post => post.location), ...ZURICH].map(text => text.trim().toLowerCase()))];
const historicalPlaces = read('../fixtures/golden/activityfailures-feed-asks.json').place.context;
const words = values => [...new Set((values || []).flatMap(fragmentNames))];
const searchPlaces = {
  best_places: words(draft.search.locations.top_tier), anywhere_in: words(draft.search.locations.country_wide),
  cities_abroad: words(draft.search.locations.abroad), remote_jobs: (draft.search.remote_jobs || []).includes('no') ? 'no' : 'yes',
  remote_limited_to_regions_they_cannot_work_from: words(draft.search.remote_excluded_regions),
  work_rights: (draft.preferences.work_rights || []).map(String).slice(0, 10),
};
const contexts = new Set([historicalPlaces, searchPlaces].map(places => hash(places).slice(0, 12)));
for (const {family, key} of previous) if (family === 'app.place') contexts.add(key.split('/')[1].slice('places-'.length));
// Unknown extraction fields trigger a real narrow retry before the independent role question.
const retryDefinition = source('../../../src/ai/enrich.py').match(/ASK_AGAIN = ([\s\S]+?)\nAGAIN =/);
assert.ok(retryDefinition, 'the extraction retry fields must remain enumerable');
const retryFields = [...retryDefinition[1].matchAll(/'([^']+)': lambda/g)].map(match => match[1]);
assert.ok(retryFields.length, 'extraction declares retry predicates');
const search = withDerived(draft.search);
const titleContext = hash({search: {role_words: search.role_keywords, words_ruled_out: search.title_exclude_keywords}, pass: 'sort'}).slice(0, 12);

// The narrow retry's row key for a full answer that left some fields unknown; null when nothing needs a retry.
function retryKeyOf(post, full) {
  if (!full) return null;
  const empty = retryFields.filter(field => Array.isArray(full[field]) ? !full[field].length : full[field]?.value === 'unknown');
  return empty.length ? `default/app.enrich/${hash(post)}/retry-${empty.sort().join(',')}` : null;
}

test('every feed posting, enrichment form, title, location/context and captured refusal is stored', t => {
  const table = loadTable(), missing = new Set();
  const requireRow = (family, key, text) => {
    const row = (family === 'app.score' ? table.answers : table.items)?.[family]?.[key];
    if (!row || text !== undefined && row.text !== text) missing.add(`${family}: ${key}`);
  };
  assert.deepEqual(postings.map(post => canonical(post)).sort(), captured.feedPostings.map(post => canonical(tuple(post))).sort(),
    'refresh failuresnotion feedPostings when a suite/scout fixture changes');
  for (const post of postings) {
    requireRow('app.score', `feed/${hash(post)}`);
    const title = post.title.toLowerCase();
    requireRow('app.title', `default/app.title/${titleContext}/${hash(title)}`, title);
  }
  for (const post of enrichmentPostings) for (const form of ['full', 'role']) {
    requireRow('app.enrich', `default/app.enrich/${hash(post)}/${form}`, `${post.title}\n${post.company}\n${post.location}`);
  }
  for (const location of locations) for (const context of contexts) requireRow('app.place', `default/places-${context}/${hash(location)}`, location);
  for (const post of enrichmentPostings) {
    const key = retryKeyOf(post, table.items['app.enrich'][`default/app.enrich/${hash(post)}/full`]?.answer);
    if (key) requireRow('app.enrich', key, `${post.title}\n${post.company}\n${post.location}`);
  }
  // Run-1/run-2 fixtures cover fn-b's seven distinct items; the feed products above also cover all nine fn-c items.
  for (const {family, key} of previous) requireRow(family, key);
  const decideAsks = read('../fixtures/golden/activityfailures-decide.json').requests.map(request => ({action: 'decide', request}));
  for (const ask of [...captured.asks, ...decideAsks]) {
    const question = questionOf({body: ask.request, headers: {'x-jp-action': ask.action}}, {E2E_AI_ANSWERS: 'backbone'}, table);
    assert.ok(!question.unkeyable, question.unkeyable);
    if (question.operation === 'app.kind') assert.ok(table.kinds[question.id]);
    else if (question.items) for (const item of question.items) requireRow(question.operation, item.key, item.text);
    else requireRow(question.operation, question.id);
  }
  t.diagnostic(`${postings.length} score postings; ${enrichmentPostings.length} posting/location tuples × full/role; ${locations.length} location strings × ${contexts.size} search contexts`);
  assert.deepEqual([...missing].sort(), [], `Missing stored answers:\n${[...missing].sort().join('\n')}`);
});
