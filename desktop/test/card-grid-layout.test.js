/* global document, getComputedStyle */
// Every card grid on every page, measured in the demo app (owner, 25 Oct 2026: "2 columns with very different heights, let's better have 1 column, and
// full rows cards"; "same height for all the columns, if we have multiple columns per row"): a grid is one column, or its cards in a row are one height.
// Cards that grow with the user's data (Advanced search settings, Locations, Job preferences, the Profile's background) must be one column.
// Renders the demo app (electron); skipped on CI and without electron, like test/report-grid-layout.test.js. The shared grid: components.css .card-grid.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const SKIP = {skip: process.env.CI || !existsSync(`${desktop}node_modules/.bin/electron`)};
const GRIDS = '.card-grid, .task-pair, .ui-choices.is-pair, .exp-profile';
const probe = grids => [...document.querySelectorAll(grids)].filter(grid => grid.getBoundingClientRect().width > 0).map(grid => {
  const cards = [...grid.children].filter(card => card.getBoundingClientRect().height > 0).map(card => {
    const box = card.getBoundingClientRect();
    return {top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height)};
  });
  return {name: grid.id || grid.className, width: Math.round(grid.clientWidth - parseFloat(getComputedStyle(grid).paddingLeft) - parseFloat(getComputedStyle(grid).paddingRight)), columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, cards};
});
const measure = (page, js = '') => {
  const run = spawnSync('node', ['scripts/shot.mjs', page, '--no-picture', '--js', js, '--eval', `JSON.stringify((${probe})('${GRIDS}'))`], {cwd: desktop, encoding: 'utf8', timeout: 90000});
  return JSON.parse(JSON.parse(run.stdout.trim().split('\n').pop()));
};
const ADVANCED = "document.getElementById('strategy-advanced').open = true";
const PAGES = [['strategy', ADVANCED], ['settings', ''], ['actions', ''], ['profile', '']];

for (const [page, js] of PAGES) {
  test(`${page}: every card grid is one column, or its cards in a row are one height`, SKIP, () => {
    for (const grid of measure(page, js)) {
      if (grid.columns === 1) continue;
      for (const [top, row] of Map.groupBy(grid.cards, card => card.top)) {
        const heights = row.map(card => card.height);
        assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, `${page} ${grid.name} row at ${top}: ${heights.join(', ')}px: one height`);
        assert.ok(row.length > 1 || row[0].width >= grid.width - 1, `${page} ${grid.name} row at ${top} leaves half the row empty`);
      }
    }
  });
}

test('strategy: Advanced search settings is one column of full-width cards', SKIP, () => {
  const grid = measure('strategy', ADVANCED).find(one => one.name.includes('strategy-targets'));
  assert.ok(grid && grid.cards.length >= 3, 'the three advanced cards are drawn');
  assert.equal(new Set(grid.cards.map(card => card.top)).size, grid.cards.length, 'one card per row');
  assert.equal(new Set(grid.cards.map(card => card.width)).size, 1, 'every card is as wide as the grid lets it be');
});
