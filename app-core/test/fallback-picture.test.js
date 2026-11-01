// After "asked already" the one question climbs to the picture, in CI pool runs only (spec 2026-10-12-one-next-move.md, the owner's order of 14 Oct 2026: the question was asked at only 2 of 20 stops
// because the digest had been asked already and the picture rung that comes next was off). The look is told what was tried in fixed words; its own line carries cost and action (closerLook); this
// file's line carries the door's id and what the look said, never page text. Users keep it off (no test switch: the old "picture_off" line, nothing asked). Guard for fallback.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {askAtDeadEnd, forgetFallback, useFallback} from '../../extension/ladder/fallback.js';

const logged = [], looks = [];
let switchOn = true;
useFallback({log: (area, what, data) => logged.push({what, data}), ask: async () => null, floor: async () => ({press: false, why: null}), asked: () => true, tab: async id => ({id, url: 'https://jobs.example/1'}),
  acts: async () => switchOn, look: async (tab, why) => { looks.push({tab: tab.id, why}); return 'ask_person'; }});
const stop = (door, why = 'no-form') => askAtDeadEnd({door, tabId: 1, page: 'https://jobs.example/1', why});

test('in the CI pool, after "asked already" the question climbs to the picture with the stop\'s reason; the line has the door and the look\'s action only', async () => {
  forgetFallback(1); looks.length = 0; logged.length = 0;
  assert.equal(await stop(7), null);
  assert.deepEqual(looks, [{tab: 1, why: 'no-form'}]);
  const asked = logged.find(item => item.what === 'dead end fallback (shadow): asked already');
  assert.equal(asked.data.climb, 'picture');
  const line = logged.find(item => item.what === 'dead end fallback (picture)');
  assert.deepEqual(Object.keys(line.data).sort(), ['door', 'look', 'ms', 'shadow', 'why']);
  assert.deepEqual([line.data.door, line.data.look, line.data.shadow], [7, 'ask_person', false]);
});

test('for users (no test switch) nothing is looked at: the old shadow line, picture off', async () => {
  switchOn = false; forgetFallback(1); looks.length = 0; logged.length = 0;
  await stop(8);
  assert.deepEqual(looks, []);
  assert.equal(logged.find(item => item.what === 'dead end fallback (shadow): asked already').data.climb, 'picture_off');
  assert.equal(logged.some(item => item.what === 'dead end fallback (picture)'), false);
  switchOn = true;
});

test('one look per page and tab, and none when the tab left the stop\'s page', async () => {
  forgetFallback(1); looks.length = 0;
  await stop(9); assert.equal(await stop(10), null);
  assert.equal(looks.length, 1);
  forgetFallback(1); looks.length = 0; logged.length = 0;
  assert.equal(await askAtDeadEnd({door: 11, tabId: 1, page: 'https://jobs.example/2', why: 'other'}), null);
  assert.deepEqual(looks, [], 'the page moved on');
});

test('wired: the look is the closer look with the picture, as a posting page (its floors never press a sign-in or a submit), told what was tried', () => {
  const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
  assert.match(flow, /look: \(tab, why\) => closerLook\(tab, 0, `dead end \(\$\{why\}\): the digest was asked, no way on found`, \{kind: 'page', picture: true\}\)/);
});
