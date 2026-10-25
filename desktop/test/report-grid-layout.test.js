/* global document */
// A search's full report (Reports → Searches) measured in the demo app: widgets sharing a row are the same height, none leaves a half row empty, and the
// Technical log is last at full width (owner, 25 Oct 2026: "it's very important to not have weird empty spaces. But rather have same height for all the columns").
// Renders the demo app (electron); skipped on CI and without electron, like test/palette-every-action.test.js. The model's rule: test/searches-view.test.js.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const SKIP = {skip: process.env.CI || !existsSync(`${desktop}node_modules/.bin/electron`)};
const open = "document.querySelector('[data-reports-tab=searches]').click(); await new Promise(r => setTimeout(r, 1200)); document.querySelector('.rs-run').click(); await new Promise(r => setTimeout(r, 1500));";
const probe = () => {
  const grid = document.querySelector('.rs-grid').getBoundingClientRect();
  return {width: Math.round(grid.width), cards: [...document.querySelectorAll('.rs-grid > .rs-card')].map(card => {
    const box = card.getBoundingClientRect();
    return {id: card.dataset.card, top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height)};
  })};
};

test('the report\'s widgets: two per row of one height, no half row empty, the log last and full width', SKIP, () => {
  const run = spawnSync('node', ['scripts/shot.mjs', 'reports', '--no-picture', '--js', open, '--eval', `JSON.stringify((${probe})())`], {cwd: desktop, encoding: 'utf8', timeout: 90000});
  const {width, cards} = JSON.parse(JSON.parse(run.stdout.trim().split('\n').pop()));
  assert.ok(cards.length >= 4, `the report drew ${cards.length} widgets`);
  const rows = Map.groupBy(cards, card => card.top);
  for (const [top, row] of rows) {
    assert.equal(new Set(row.map(card => card.height)).size, 1, `row at ${top}: ${row.map(card => `${card.id} ${card.height}px`).join(', ')}: one height`);
    assert.ok(row.length === 2 || row[0].width >= width - 1, `row at ${top}: ${row.map(card => card.id).join(', ')} leaves half the row empty`);
  }
  assert.equal(cards.at(-1).id, 'log', 'the Technical log is last');
  assert.ok(cards.at(-1).width >= width - 1, 'the Technical log is full width');
});
