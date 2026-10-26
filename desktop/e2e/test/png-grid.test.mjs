// The screenshot review's "looks the same" test (lib/png-grid.mjs): a changed clock or another window height keeps the look; a missing, moved or recoloured card does not.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {png} from './png-make.mjs';
import {changedCells, decodePng, lookStrips, sameLook, stripsFromJson, stripsToJson} from '../lib/png-grid.mjs';

// A page like the app's: a card near the top, a clock top right, a bar anchored to the window's bottom.
const W = 480;
const page = ({height = 300, clock = 0, card = true, shift = 0, colour = [40, 60, 200]} = {}) => png(W, height, (x, y) => {
  if (y >= height - 24) return x < 120 ? [20, 20, 20] : [255, 255, 255];   // the bottom bar, its status text on the left
  if (card && x >= 40 + shift && x < 240 + shift && y >= 40 && y < 140) return colour;
  if (x >= 400 + clock && x < 403 + clock && y >= 10 && y < 14) return [0, 0, 0];   // a few pixels of a clock's digit
  return [238, 243, 247];
}, {filterOf: y => y % 3});

test('decodes RGB and RGBA PNGs with every row filter', () => {
  for (const channels of [3, 4]) {
    const image = decodePng(png(5, 4, (x, y) => [x * 50, y * 60, 7, 200], {channels, filterOf: y => y % 3}));
    assert.deepEqual([image.width, image.height, image.channels], [5, 4, channels]);
    assert.deepEqual([...image.pixel(4, 3)], channels === 4 ? [200, 180, 7, 200] : [200, 180, 7]);
  }
});

test('a changed clock or another window height keeps the look; a missing, moved or recoloured card or another width does not', () => {
  const base = lookStrips(page());
  assert.equal(sameLook(base, lookStrips(page({clock: 5}))), true, 'a few pixels of text changed');
  assert.equal(sameLook(base, lookStrips(page({height: 327}))), true, 'the window is 27 px taller: the bottom bar moved, nothing else');
  for (const [why, other] of [['a card gone', page({card: false})], ['a card moved', page({shift: 60})], ['a card recoloured', page({colour: [200, 40, 40]})],
    ['a card gone in a taller window', page({card: false, height: 327})], ['a card gone in a shorter window', page({card: false, height: 280})]]) {
    assert.ok(changedCells(base, lookStrips(other)) > 100, why);
  }
  assert.equal(changedCells(base, lookStrips(png(W + 32, 300, () => [238, 243, 247]))), Infinity, 'another width');
});

test('the strips survive the cache file', () => {
  const strips = lookStrips(page());
  assert.equal(changedCells(strips, stripsFromJson(JSON.parse(JSON.stringify(stripsToJson(strips))))), 0);
  assert.equal(stripsFromJson({cells: 'not deflated'}), null);
});
