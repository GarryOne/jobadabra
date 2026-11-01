// A changed line that draws a page runs the suite that reads that page (lib/page-reach.mjs + stepsCovering `reads`); #2694 (31 Oct 2026) added a Focus row and ran no `focus` step.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {SETUP} from '../lib/coverage.mjs';
import {stepsCovering} from '../lib/coverage-pick.mjs';
import {suitesUsing} from '../lib/import-graph.mjs';
import {elementIds, suitesReading} from '../lib/page-reach.mjs';

const e2e = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), repo = path.resolve(e2e, '../..');
const lines = (...ranges) => ({loaded: true, lines: ranges});
const sources = {};
for (const dir of ['suites', 'lib']) for (const name of fs.readdirSync(path.join(e2e, dir))) if (name.endsWith('.mjs')) sources[`${dir}/${name}`] = fs.readFileSync(path.join(e2e, dir, name), 'utf8');
const users = suitesUsing(e2e);
const text = file => fs.readFileSync(path.join(repo, file), 'utf8');
const read = files => suitesReading(Object.fromEntries(files.map(file => [file, text(file)])), sources, users);
const FOCUS_ROWS = 'desktop/renderer/pages/focus-suggestions.js';

test('elementIds: the ids a file draws into or a suite looks at, not colours or comments', () => {
  const draws = `// $('in-a-comment')\n$('focus-list').hidden = true; document.getElementById("a-b"); page.locator('#x1 .row'); const c = '#ececec'; /* #gone */ el.innerHTML = '<p id="inner">'`;
  assert.deepEqual([...elementIds(draws)].sort(), ['a-b', 'focus-list', 'inner', 'x1']);
  assert.deepEqual([...elementIds('')], []);
});

test('suitesReading: a suite whose source (or an import of it) quotes an element the file draws reads it; the app chrome every suite quotes names no one', () => {
  const src = {'suites/focus.mjs': "import './lib/rows.mjs'; page.locator('#focus-list')", 'lib/rows.mjs': "page.locator('#focus-extra')", 'suites/calendar.mjs': "page.locator('#focus-extra')",
    ...Object.fromEntries(['a', 'b', 'c', 'd'].map(name => [`suites/${name}.mjs`, "page.locator('#app-nav')"]))};
  const use = {'suites/focus.mjs': ['focus'], 'lib/rows.mjs': ['focus', 'calendar'], 'suites/calendar.mjs': ['calendar'], ...Object.fromEntries(['a', 'b', 'c', 'd'].map(name => [`suites/${name}.mjs`, [name]]))};
  const files = {'p/focus.js': "$('focus-list'); $('focus-extra'); $('app-nav')", 'p/nav.js': "$('app-nav')", 'p/model.js': 'export const x = 1;'};
  assert.deepEqual(suitesReading(files, src, use), {'p/focus.js': ['calendar', 'focus']});
  const wide = {'p/all.css': "#one, #two, #three, #four"}, each = Object.fromEntries(['one', 'two', 'three', 'four'].map(id => [`suites/${id}.mjs`, `page.locator('#${id}')`]));
  assert.deepEqual(suitesReading(wide, each, Object.fromEntries(Object.keys(each).map(file => [file, [path.basename(file, '.mjs')]]))), {}, 'a stylesheet or shell that more suites read than MAX_USERS is chrome: no reader');
});

test('#2694: the real Focus rows file is read by the focus suites, and a line 23 suites ran picks their steps, not the settings smoke alone', () => {
  const readers = read([FOCUS_ROWS])[FOCUS_ROWS];
  // Why (R2, 1 Nov 2026): the Focus e2e suites moved to integration; the suites that still read the Focus rows file are the ones that draw it from a real store (storemove, notion-real).
  for (const suite of ['storemove']) assert.ok(readers?.includes(suite), `${suite} reads ${FOCUS_ROWS}`);
  const ran = {[FOCUS_ROWS]: lines([100, 200])};
  const entry = {sha: 'S', files: ran, steps: {'Focus finishes loading': ran, [SETUP]: ran}};
  const map = {suites: Object.fromEntries(['activity', 'apply', 'calendar', 'jobs', 'settings', 'wander', ...readers].map(name => [name, entry]))};
  const picked = stepsCovering(map, {S: {[FOCUS_ROWS]: [[156, 156]]}}, {reads: read([FOCUS_ROWS])});
  assert.deepEqual(Object.keys(picked).sort(), [...readers].sort());
  assert.deepEqual(picked.storemove.steps, ['Focus finishes loading']);
});

// #2118 (app-notify.js:61) and #2119 (server.js:51) ran all 20 suites whole on 26 Oct 2026: the main process draws no element, so it has no reader and the shared rule still holds.
test('the real launch and server code has no reader: a line most suites ran is still one suite\'s (#2118, #2119)', () => {
  const files = ['desktop/lib/app-notify.js', 'desktop/lib/server.js'];
  assert.deepEqual(read(files), {});
  const crowd = ['activity', 'apply', 'jobs', 'wander', 'focus', 'calendar', 'settings'];
  for (const file of files) {
    const ran = {[file]: lines([1, 200])};
    const entry = {sha: 'S', files: ran, steps: {'a step': ran, [SETUP]: ran}};
    const map = {suites: Object.fromEntries(crowd.map(name => [name, entry]))};
    assert.deepEqual(Object.keys(stepsCovering(map, {S: {[file]: [[51, 51]]}}, {reads: read(files)})), ['settings'], file);
  }
});

// The class: every app file that names an element some suite quotes (a page, its style, its shell). A line in it that many suites ran still picks the suites that read it.
test('every app file with a reader picks that reader for a line many suites ran', () => {
  const walk = dir => fs.readdirSync(path.join(repo, dir), {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? (['assets', 'node_modules'].includes(entry.name) ? [] : walk(`${dir}/${entry.name}`)) : [`${dir}/${entry.name}`]));
  const files = [...walk('desktop/renderer'), ...walk('desktop/lib')].filter(file => /\.(js|css|html)$/.test(file));
  const reads = read(files), named = Object.entries(reads);
  assert.ok(named.length > 20, `${named.length} app files have a reader`);
  for (const [file, readers] of named) {
    const ran = {[file]: lines([1, 500])};
    const entry = {sha: 'S', files: ran, steps: {'a step': ran, [SETUP]: ran}};
    const crowd = ['activity', 'apply', 'calendar', 'jobs', 'settings', 'wander', 'strategy'];
    const map = {suites: Object.fromEntries([...new Set([...crowd, ...readers])].map(name => [name, entry]))};
    const picked = Object.keys(stepsCovering(map, {S: {[file]: [[7, 7]]}}, {reads})).sort();
    assert.deepEqual(picked, [...readers].sort(), `${file}: its readers run, nobody else does`);
  }
});
