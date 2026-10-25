/* global document */
// The one card grid (components.css .card-grid, renderer/card-grid.js pairRows; owner, 25 Oct 2026: "The others, which have fixed height, and not too much
// content, they can 2 columns per row"; "it's very important to not have weird empty spaces. But rather have same height for all the columns"): small cards
// pair up, an unpaired one takes its row, a wide one (.is-wide) breaks the pairs. Every page's card grid uses this one mechanism. Measured: test/report-grid-layout.test.js.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {pairRows} from '../renderer/card-grid.js';

install();
const grid = shape => {
  const box = document.createElement('div');
  box.append(...[...shape].map(kind => { const card = document.createElement('section'); if (kind === 'W') card.classList.add('is-wide'); return card; }));
  return box;
};
const read = box => box.children.map(card => (card.classList.contains('is-unpaired') ? 'u' : card.classList.contains('is-wide') ? 'W' : 's')).join('');

test('small cards pair up; the one left without a partner takes its row; wide cards break the pairs wherever they sit', () => {
  for (const [shape, want] of [['ssss', 'ssss'], ['sss', 'ssu'], ['sssW', 'ssuW'], ['ssWsss', 'ssWssu'], ['sWs', 'uWu'], ['W', 'W'], ['', '']]) {
    assert.equal(read(pairRows(grid(shape))), want, shape);
  }
});

test('drawn again, it starts over: a card it widened before pairs again when a partner arrives; a hidden card does not count', () => {
  const box = pairRows(grid('sss'));
  box.append(document.createElement('section'));
  assert.equal(read(pairRows(box)), 'ssss');
  const hidden = grid('sss');
  hidden.children[2].hidden = true;
  assert.equal(read(pairRows(hidden)), 'sss', 'two shown cards pair; the hidden one is left alone');
});

test('the grid: two per row of one height, content at the top, wide cards on their own row, one column when narrow; the Searches report uses it', () => {
  const css = readFileSync(new URL('../renderer/components.css', import.meta.url), 'utf8');
  assert.match(css, /\.card-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: var\(--sp-4\); align-items: stretch; \}/);
  assert.match(css, /\.card-grid > \* \{ min-width: 0; align-content: start; \}/);
  assert.match(css, /\.card-grid > \.is-wide \{ grid-column: 1 \/ -1; \}/);
  const page = readFileSync(new URL('../renderer/pages/reports-searches.js', import.meta.url), 'utf8');
  assert.match(page, /el\('div', 'card-grid rs-grid'\)[\s\S]*?pairRows\(grid\);/);
});
