// Blocks shown late above content already drawn (renderer/late-blocks.js; owner, 26 Oct 2026: the Find jobs card came 2-3 s late and pushed the
// job list down): each one is in the page's first paint, as last drawn or as a skeleton, and the real data replaces it in place.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {LATE_BLOCKS, keepBlock, keptBlock} from '../renderer/late-blocks.js';
import {findCard, keptFindCard, waitsForList} from '../renderer/find-card-model.js';

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const html = read('index.html');
const memory = () => { const map = new Map(); return {writes: 0, getItem: key => map.get(key) ?? null, setItem(key, value) { this.writes += 1; map.set(key, String(value)); }}; };

test('a block keeps what it drew, writes only on a change, and survives a missing or broken store', () => {
  const storage = memory();
  assert.equal(keptBlock('find-card', storage), undefined, 'nothing kept on a first start');
  keepBlock('find-card', {state: 'none'}, storage);
  keepBlock('find-card', {state: 'none'}, storage);
  assert.deepEqual(keptBlock('find-card', storage), {state: 'none'});
  assert.equal(storage.writes, 1, 'the same paint is not written again (the list redraws on each key typed)');
  keepBlock('jobs-talking', {shown: false}, storage);
  assert.deepEqual(keptBlock('find-card', storage), {state: 'none'}, 'one block never wipes another');
  assert.throws(() => keepBlock('not-a-block', {}, storage), /not in LATE_BLOCKS/);
  assert.equal(keptBlock('find-card', {getItem: () => '{broken'}), undefined);
  assert.doesNotThrow(() => keepBlock('find-card', {state: 'none'}, {getItem: () => null, setItem() { throw new Error('full'); }}));
});

test('every late block is registered, recalled at first paint and kept on each real draw (the class)', () => {
  for (const [id, where] of Object.entries(LATE_BLOCKS)) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} is in index.html`);
    const file = /\((pages\/[\w-]+\.js)\)/.exec(where)?.[1];
    assert.ok(file, `${id}: the registry names its file`);
    const code = read(file);
    assert.match(code, new RegExp(`keptBlock\\('${id}'\\)`), `${file} paints ${id} from what it kept`);
    assert.match(code, new RegExp(`keepBlock\\('${id}'`), `${file} keeps ${id} when it draws`);
    const paint = /export function (paint\w+First)\(/.exec(code)?.[1];
    assert.ok(paint, `${file} has a first-paint function`);
    const callers = ['pages/jobs.js', 'pages/focus.js'].filter(page => new RegExp(`\\b${paint}\\(\\)`).test(read(page)));
    assert.equal(callers.length, 1, `${paint} is called from its page's init`);
  }
  // No block keeps itself outside the registry (keepBlock also throws at run time).
  const pages = fs.readdirSync(new URL('../renderer/pages/', import.meta.url)).map(name => read(`pages/${name}`)).join('\n');
  for (const [, id] of pages.matchAll(/keepBlock\('([\w-]+)'/g)) assert.ok(id in LATE_BLOCKS, `${id} is registered`);
});

test('the Find jobs card is in the first paint: a skeleton of the compact card in its place, not a hidden slot', () => {
  const tag = /<section [^>]*id="find-card"[^>]*>([\s\S]*?)<\/section>/.exec(html);
  assert.ok(tag, 'the card is in index.html');
  assert.doesNotMatch(tag[0].split('>')[0], /\shidden\b/, 'not hidden until the first 2 s tick');
  assert.match(tag[0], /class="card find-card is-none is-loading"/, 'drawn as the compact card while loading');
  assert.match(tag[1], /class="skeleton[^"]*"/, 'with the shared skeleton bars');
  assert.match(tag[1], /class="find-title"[\s\S]*class="muted find-lead"/, 'inside the card\'s own title and lead lines, so it has the card\'s height');
});

test('the window draws the Find jobs card with its first runs answer, not on the first 2 s tick', () => {
  const start = read('pages/activity.js').split('\n').find(line => /window\.pilot\.runs\(\)\.then/.test(line) && /at once/.test(line));
  assert.ok(start, 'activity.js asks for the runs at once');
  assert.match(start, /renderFindCard\(runsNow\)/, 'and that first answer draws the card');
  assert.match(read('pages/jobs.js'), /jobsState\.lastJobsData = data;\n\s+renderFindCard\(\);/, 'the list\'s count redraws it when the list is read');
});

test('what the next start paints first, and what waits for the list', () => {
  assert.deepEqual(keptFindCard({state: 'done', added: 4, runId: 'x'}), {state: 'none'}, 'a done search is "Find more jobs" in the next window');
  const searching = keptFindCard({state: 'searching', lines: ['a', 'b', 'c', 'd', 'e'], chips: []});
  assert.deepEqual(searching.lines, ['c', 'd', 'e'], 'a running search keeps its shape, few lines');
  assert.deepEqual(keptFindCard({state: 'none'}), {state: 'none'});
  const empty = findCard({lastSearchAt: '', listed: 0}), failed = findCard({last: {ok: false, problem: 'x'}, lastSearchAt: '2026-10-26T08:00:00Z', listed: 0});
  assert.equal(waitsForList(empty, false), true, 'never the big empty card before the list is read');
  assert.equal(waitsForList(failed, false), true);
  assert.equal(waitsForList(empty, true), false);
  assert.equal(waitsForList(findCard({lastSearchAt: '2026-10-26T08:00:00Z', listed: 0}), false), false, '"Find more jobs" needs no count');
});
