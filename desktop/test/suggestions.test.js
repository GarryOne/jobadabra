// Focus → Suggestions, the Jobs bar and Strategy's Tune row (renderer/suggestions.js, pages/focus-suggestions.js; spec
// docs/superpowers/specs/2026-10-28-insights-with-actions-design.md, PR 1a): every engine producer shows on Focus, in its home and, when it is
// about the search or applying, on Jobs; every button the engine writes has its handler; Up next keeps only what can't wait; Tune and Analyze
// left the Actions page and stay in ⌘K.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {DOES, LOOK, countWords, entryParts, focusRows, homeEntries, jobsBarWords, jobsEntries, movedItems, upNext} from '../renderer/suggestions.js';

const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
const engine = read('../../src/suggestions.py'), searchRows = read('../../src/suggestions_search.py');
const tuple = name => [...engine.match(new RegExp(`^${name} = \\(([^)]*)\\)`, 'm'))[1].matchAll(/'(\w+)'/g)].map(match => match[1]);
const SEARCH_ROWS = ['places', 'ideas', 'coverage', 'filters', 'visits'];   // src/suggestions_search.py KINDS: Strategy's rows, PR 1b
const PRODUCERS = tuple('PRODUCERS'), HOMES = {insight: 'focus', rejection: 'jobs', week: 'focus', analyze: 'focus', tune: 'strategy',
  ...Object.fromEntries(SEARCH_ROWS.map(kind => [kind, 'strategy']))};
const TOPICS = {insight: 'profile', rejection: 'applying', week: 'search', analyze: 'search', tune: 'search', ...Object.fromEntries(SEARCH_ROWS.map(kind => [kind, 'search']))};
const entry = kind => ({kind, home: HOMES[kind], topic: TOPICS[kind], title: `${kind} title`, source: 'From', detail: 'What it says', evidence: ['seen'],
  actions: [{label: 'Go', do: DOES[0]}], key: `${kind}:k`, answers: ['Not now', 'Not true']});

test('every engine producer is drawn: on Focus, in its home, and on Jobs when it is about the search or applying', () => {
  assert.deepEqual(PRODUCERS.slice().sort(), Object.keys(HOMES).sort(), 'a new producer in src/suggestions.py is listed here');
  const pool = PRODUCERS.map(entry);
  assert.deepEqual(focusRows(pool, []).map(row => row.entry.kind), PRODUCERS);
  for (const kind of PRODUCERS) {
    const [one] = pool.filter(item => item.kind === kind);
    assert.ok(LOOK[kind], `${kind} has its icon, colour and badge`);
    assert.deepEqual(homeEntries(pool, one.home).filter(item => item.kind === kind), [one], kind);
    assert.equal(jobsEntries(pool).includes(one), ['search', 'applying'].includes(one.topic), kind);
  }
  assert.ok(read('../renderer/pages/strategy-suggestions.js').includes("homeSuggestions('strategy')"), "Strategy draws its home's entries");
});

test('every button the engine writes has its handler in one press', () => {
  const written = new Set([...(engine + searchRows).matchAll(/'do': '(\w+)'/g)].map(match => match[1]).concat(tuple('DOORS')));
  assert.deepEqual([...written].sort(), DOES.slice().sort(), 'renderer/suggestions.js DOES lists what the engine writes');
  const page = read('../renderer/pages/focus-suggestions.js');
  const run = page.slice(page.indexOf('export const RUN = {'), page.indexOf('\n};', page.indexOf('export const RUN = {')));
  for (const name of DOES) assert.match(run, new RegExp(`\\n  ${name}: `), `${name} has a handler`);
});

test('Up next keeps what cannot wait; a moved item keeps its row in Suggestions; one with no place is shown nowhere', () => {
  const items = [{kind: 'reply', place: 'up_next'}, {kind: 'happened', place: 'suggestions'}, {kind: 'waiting', place: null}, {kind: 'offer'}];
  assert.deepEqual(upNext(items).map(item => item.kind), ['reply', 'offer'], 'a saved Focus from before places keeps its items in Up next');
  assert.deepEqual(movedItems(items).map(item => item.kind), ['happened']);
  assert.deepEqual(focusRows([entry('week')], items).map(row => (row.entry || row.item).kind), ['week', 'happened'], 'the engine entries lead');
});

test('the words: "3 of 5" and Show all, the Jobs bar folded and open, a row\'s parts', () => {
  assert.equal(countWords(3, 5), '3 of 5');
  assert.equal(countWords(2, 2), '2');
  assert.deepEqual(jobsBarWords(1, false), {title: '1 suggestion for your search', detail: 'Show'});
  assert.deepEqual(jobsBarWords(3, true), {title: 'Suggestions for your search', detail: ''});
  const parts = entryParts({...entry('tune'), evidence: ['a', 'b']});
  assert.deepEqual([parts.icon, parts.badge, parts.meta, parts.evidence], ['sliders', 'Tune', ['From', 'What it says'], 'a\nb']);
  assert.deepEqual(entryParts({...entry('week'), source: 'Your week'}).meta, ['What it says'], 'the badge already says where it comes from');
});

test('the demo Focus draws every place: Up next, Suggestions with engine entries, and nothing for a waiting item', () => {
  const demo = JSON.parse(read('../demo/focus.json'));
  assert.equal(demo.insight, undefined, 'the Insight card is gone: today\'s insight is a Suggestions entry');
  assert.ok(demo.suggestions.length >= 3 && demo.suggestions.every(one => one.actions.length && DOES.includes(one.actions[0].do)));
  assert.ok(upNext(demo.items).length && movedItems(demo.items).length);
  assert.ok(demo.items.some(item => item.kind === 'waiting' && item.place === null));
});

test('Analyze my job search keeps Run again in Recent activity without its Actions card', () => {
  const basics = read('../renderer/pages/activity-basics.js');
  assert.match(basics, /const CARDLESS = new Set\(\['weekly'\]\);/);
  assert.match(basics, /if \(command && CARDLESS\.has\(command\)\) return \{click: \(\) => runCommand\(command\)\};/);
});

test('Tune and Analyze left the Actions page and stay in ⌘K; Focus has Suggestions, not the Insight card', () => {
  const html = read('../renderer/index.html'), nav = read('../renderer/pages/nav.js');
  assert.doesNotMatch(html, /id="tune-open"|data-command="weekly"|id="focus-insight-card"/);
  assert.match(html, /id="focus-suggestions"[\s\S]{0,200}Suggestions<\/h2>/);
  assert.match(html, /<details class="card jobs-fold" id="jobs-suggestions" hidden>/);
  assert.match(nav, /add\('Strategy', 'Tune my strategy', [^\n]*\(\) => openTune\(\)\);/);
  assert.match(nav, /add\('Reports', 'Analyze my job search', [^\n]*\(\) => runCommand\('weekly'\)\);/);
});

test('a Not true on role ideas reaches the engine, which Focus reads (#2350, Gitar: kept in one window, Focus offered them again)', async () => {
  const sent = [];
  globalThis.window = {pilot: {roleIdeasAside: async words => { sent.push(words); return {ok: true}; }}};
  const {setAside} = await import('../renderer/ideas-aside.js');
  setAside(['caissier']);
  assert.deepEqual(sent, [['caissier']]);
  assert.match(read('../preload.cjs'), /roleIdeasAside: call\('roleIdeasAside'\)/);
  assert.match(read('../lib/search-tuning-handlers.js'), /handle\('roleIdeasAside'[\s\S]*?'src\.desktop', 'role-ideas-aside'/);
  assert.match(read('../../src/desktop.py'), /args\.command == 'role-ideas-aside':\s*\n\s*from \.ai import role_ideas\s*\n\s*role_ideas\.put_aside\(/);
  delete globalThis.window;
});
