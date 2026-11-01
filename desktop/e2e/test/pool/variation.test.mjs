import assert from 'node:assert/strict';
import {test} from 'node:test';
import {WINDOW_SIZES, createVariation} from '../../lib/variation.mjs';

const LIST = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

test('no seed (or 0) is the fixed path: nothing moves, the default window', () => {
  for (const env of [{}, {E2E_SEED: ''}, {E2E_SEED: '0'}, {E2E_SEED: 'junk'}]) {
    const v = createVariation(env);
    assert.equal(v.fixed, true);
    assert.deepEqual(v.shuffle(LIST), LIST);
    assert.deepEqual(v.pick(WINDOW_SIZES), [1280, 820]);
  }
});

test('the same seed replays the same path; another seed walks another', () => {
  const a = createVariation({E2E_SEED: '12345'}), b = createVariation({E2E_SEED: '12345'}), c = createVariation({E2E_SEED: '99'});
  assert.deepEqual(a.shuffle(LIST), b.shuffle(LIST));
  assert.deepEqual(a.pick(WINDOW_SIZES), b.pick(WINDOW_SIZES));
  assert.notDeepEqual(a.shuffle(LIST), c.shuffle(LIST));
  assert.equal(a.fixed, false);
});

test('a shuffle keeps every item exactly once and never edits its input', () => {
  const v = createVariation({E2E_SEED: '7'}), input = [...LIST];
  const out = v.shuffle(input);
  assert.deepEqual(input, LIST);
  assert.deepEqual([...out].sort(), LIST);
});

test('over many seeds the page order and the window size really vary', () => {
  const orders = new Set(), sizes = new Set();
  for (let seed = 1; seed <= 40; seed++) { const v = createVariation({E2E_SEED: String(seed)}); orders.add(v.shuffle(LIST).join('')); sizes.add(v.pick(WINDOW_SIZES).join('x')); }
  assert.ok(orders.size > 30, `${orders.size} different orders in 40 seeds`);
  assert.equal(sizes.size, WINDOW_SIZES.length);
});

test('a seeded run lives in a seeded time zone and language; the fixed path stays in Zurich', async () => {
  const {placeOf, ZONES, LOCALES} = await import('../../lib/variation.mjs');
  assert.equal(placeOf({E2E_SEED: '0'}), null);
  const a = placeOf({E2E_SEED: '42'}), b = placeOf({E2E_SEED: '42'});
  assert.deepEqual(a, b, 'the same seed, the same place: replayable');
  assert.ok(ZONES.includes(a.zone) && LOCALES.includes(a.locale));
  const places = new Set(Array.from({length: 40}, (_, i) => JSON.stringify(placeOf({E2E_SEED: String(i + 1)}))));
  assert.ok(places.size > 10, 'seeds spread over many places');
});

test('the smallest window of the sweep is the app\'s own minimum, so a control cut off at the shortest allowed height is seen (#118)', async () => {
  const {mainSource} = await import('../../../test/main-source.js');   // main.js and the files split out of it (the window: lib/main-window.js since 8 Oct 2026)
  const main = mainSource();
  // The width is a constant since 886c923 (minWidth: Math.min(MIN_WIDTH, …)): read the constant, and fail plainly if neither shape is there.
  const minWidth = (/MIN_WIDTH = (\d+)/.exec(main) || /minWidth: (\d+)/.exec(main))?.[1], minHeight = /minHeight: (\d+)/.exec(main)?.[1];
  assert.ok(minWidth && minHeight, 'the window\'s minimum size is no longer readable from lib/main-window.js: update this test');
  assert.deepEqual(WINDOW_SIZES[0], [Number(minWidth), Number(minHeight)]);
  assert.ok(WINDOW_SIZES.every(([width, height]) => width >= Number(minWidth) && height >= Number(minHeight)), 'no size is below what the window allows');
});
