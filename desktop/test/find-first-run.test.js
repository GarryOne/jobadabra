// The first run (owner, 24 Oct 2026): setup ends on Jobs with a big centered "Find jobs" card and the search starts when the person presses it; in the
// demo the same press plays a scripted search. Guards: no path starts the first search behind the person's back, the card is the shared magic card,
// every start picks the fast first slice by itself, the demo's script walks the real card model, the searching card moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {findCard, stepChips} from '../renderer/find-card-model.js';
import {BLOCKED} from '../lib/demo.js';
import {SCRIPT, play, isSearchRun, isQuietStep, hideJobsUntilSearched, SECONDS_ENV} from '../lib/demo-search.js';
import {searchTrigger} from '../lib/search-steps.js';

const root = path.resolve(import.meta.dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const code = name => read(name).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(line => line.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(path.join(root, dir), {withFileTypes: true})) {
    if (entry.name === 'node_modules' || entry.name === 'demo') continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out); else if (/\.(js|cjs|html)$/.test(entry.name)) out.push(rel);
  }
  return out;
};

test('no code starts a first search on its own: finishSetup only opens Jobs, and firstSearch is gone everywhere', () => {
  const finish = code('renderer/pages/strategy-review.js').split('async function finishSetup')[1].split('\n}\n')[0];
  assert.doesNotMatch(finish, /\bfirstSearch\b|startSearch|refresh\(/, 'setup ends on the Find jobs card, nobody presses for the person');
  const hits = [...walk('renderer'), ...walk('lib'), 'preload.cjs', 'main.js'].filter(file => /\bfirstSearch\b/.test(code(file)));
  assert.deepEqual(hits, [], 'one search start (refresh); the first run picks its slice by itself');
});

test('every search start on a Mac that never searched is the first run (fast slice); later ones are not', () => {
  assert.equal(searchTrigger({}), 'first');
  assert.equal(searchTrigger({lastSearchAt: ''}), 'first');
  assert.equal(searchTrigger({lastSearchAt: '2026-10-16T10:00:00Z'}), 'you');
  assert.match(code('lib/jobs-handlers.js'), /searchTrigger\(storage\.settings\(\)\)/, 'the Find jobs handler uses it (header button, card and ⌘K all come through it)');
});

test('the empty card is the shared magic card with one big "Find jobs" button that starts the search', () => {
  const draw = code('renderer/pages/jobs-find.js');
  assert.match(draw, /'card find-card is-empty magic'|find-card is-empty magic/, 'the shared .magic card');
  assert.match(draw, /\bwire\(card\)/, 'its wand glow is wired');
  assert.match(draw, /'Find jobs'/, 'title and button say Find jobs');
  assert.doesNotMatch(draw, /Find my first jobs|Find your first jobs/, 'the old wording is gone');
  assert.match(read('renderer/magic.css'), /\.magic-go::after/, 'the whole card is the button');
});

test('the first-run screen is the empty card on every path: no search ever and no jobs', () => {
  assert.equal(findCard({lastSearchAt: '', listed: 0}).state, 'empty');
  assert.equal(findCard({running: null, lastSearchAt: '', listed: 0}).state, 'empty');
  assert.notEqual(findCard({lastSearchAt: '', listed: 5}).state, 'empty', 'a list that already has jobs is not a first run');
});

test('the searching card moves: spinner, a bar that is always there, a pulsing step, rows that rise, all still with reduced motion', () => {
  const draw = code('renderer/pages/jobs-find.js'), css = read('renderer/find-card.css');
  assert.match(draw, /spinner/, 'a spinner beside the title');
  assert.match(draw, /find-progress/, 'the bar');
  for (const piece of ['find-sheen', 'find-ping', 'find-rise']) assert.match(css, new RegExp(`@keyframes ${piece}`), `${piece} animation is defined for the card`);
  const reduced = css.split('@media (prefers-reduced-motion: reduce)')[1] || '';
  for (const piece of ['.find-card']) assert.ok(reduced.includes(piece), 'the card\'s motion stops with reduced motion');
  assert.match(read('renderer/index.html'), /href="find-card\.css"/, 'the sheet is linked');
});

test('the bar shows before any employer count exists (indeterminate), then the real count', async () => {
  const fs2 = await import('node:fs');
  const {readProgressModel} = await import('../renderer/find-card-model.js');
  assert.deepEqual(readProgressModel(null), {kind: 'indeterminate'});
  assert.deepEqual(readProgressModel({done: 50, total: 200}), {kind: 'count', done: 50, total: 200, percent: 25});
  assert.ok(fs2);
});

test('demo: the press plays a scripted search that the real card model reads, from first jobs to the end', async () => {
  assert.ok(!BLOCKED.includes('refresh') && !BLOCKED.includes('firstSearch'), 'the demo may start a search; its engine step is the script');
  assert.ok(isSearchRun(['src', 'daily', '--mode', 'run']) && !isSearchRun(['src', 'mail']));
  assert.ok(isQuietStep(['src', 'discover', '--pages', '5']) && isQuietStep(['src', 'scout']) && !isQuietStep(['src', 'daily']));
  const total = SCRIPT.reduce((sum, [wait]) => sum + wait, 0);
  assert.ok(total >= 18000 && total <= 32000, `about 25 s on screen (${total} ms)`);
  const lines = [], waits = [];
  const result = await play(line => lines.push(line), {sleep: async ms => { waits.push(ms); }});
  assert.equal(result.code, 0);
  assert.equal(waits.length, SCRIPT.length);
  const seen = new Set(), counts = [];
  for (let i = 1; i <= lines.length; i++) {
    const card = findCard({running: {kind: 'search', log: lines.slice(0, i)}});
    assert.equal(card.state, 'searching');
    stepChips(lines.slice(0, i)).forEach(chip => chip.state === 'active' && seen.add(chip.label));
    counts.push(card.matches);
  }
  assert.deepEqual([...seen].slice(0, 2), ['First jobs', 'All employers'], 'the chips walk the first-run steps');
  assert.ok(seen.has('Job boards'));
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b), 'numbers only go up');
  assert.ok(counts.at(-1) >= 20, 'ends with a real-looking count');
  assert.ok(lines.every(line => !/demo|fictional|example/i.test(line)), 'the lines read like a real search');
});

test('demo: a fresh demo (no search yet) shows no jobs until its search has run; the default demo is unchanged', () => {
  const data = {jobs: [{url: 'a'}], total: 1, filtered: 1};
  assert.deepEqual(hideJobsUntilSearched(data, {lastSearchAt: ''}).jobs, []);
  assert.deepEqual(hideJobsUntilSearched(data, {}).jobs, []);
  assert.equal(hideJobsUntilSearched(data, {lastSearchAt: '2099-01-01T08:30:00.000Z'}), data);
});

test('the Find jobs card sits where the list appears: after the counters and the list bar, before the list', () => {
  const html = read('renderer/index.html'), at = id => html.indexOf(id);
  assert.ok(at('id="find-card"') > at('class="stat-cards"') && at('id="find-card"') > at('class="list-bar"'), 'below the counters and the list bar');
  assert.ok(at('id="find-card"') < at('id="jobs-head"') && at('id="find-card"') < at('id="jobs-body"'), 'above the list');
  assert.match(read('renderer/find-card.css'), /find-card="empty"\] #jobs-head, body\[data-find-card="empty"\] #jobs-empty \{ display: none/, 'no column titles or "no jobs yet" line beside the empty card');
});

test('demo: JOBADABRA_DEMO_SEARCH_SECONDS sets how long the scripted search lasts (the hero plays a short one)', async () => {
  const total = async env => { const waits = []; await play(() => {}, {sleep: async ms => { waits.push(ms); }, env}); return waits.reduce((sum, ms) => sum + ms, 0); };
  assert.equal(SECONDS_ENV, 'JOBADABRA_DEMO_SEARCH_SECONDS');
  const usual = await total({});
  assert.ok(Math.abs(await total({[SECONDS_ENV]: '5'}) - 5000) <= SCRIPT.length, 'lasts 5 s (rounding only)');
  assert.ok(Math.abs(await total({[SECONDS_ENV]: '60'}) - 60000) <= SCRIPT.length, 'or longer');
  for (const bad of ['', '0', '-3', 'soon']) assert.equal(await total({[SECONDS_ENV]: bad}), usual, `"${bad}" keeps the usual length`);
  assert.equal((await total({[SECONDS_ENV]: '5'})) < usual, true);
});
