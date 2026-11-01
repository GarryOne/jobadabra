// The start-route step (extension/start-route.js): only the manual route is pressed; every route is covered, one look per page, nothing without an AI answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {forgetRouteTries, startRoute} from '../../extension/start-route.js';
import {ROUTES} from '../../desktop/lib/page-kind.js';

const run = async (key, answer) => {
  const pressed = [];
  const out = await startRoute(key, {ask: async () => answer, press: async phrases => { pressed.push(...phrases.map(item => item.phrase)); return {pressed: phrases[0].phrase}; }});
  return {out, pressed};
};

test('every route: only manual is pressed (a new route needs a row)', async () => {
  const button = {manual: 'apply manually', reuse_previous: 'use my last application', third_party_account: 'apply with linkedin'};
  assert.deepEqual([...ROUTES].sort(), Object.keys(button).sort());
  for (const route of ROUTES) {
    const {out, pressed} = await run(`1 ${route}`, {applyRoute: route, applyButton: button[route]});
    assert.equal(pressed.length, route === 'manual' ? 1 : 0, route);
    assert.equal(out.route, route);
  }
});

test('no AI answer or no route: nothing is pressed; one look per tab and page; a reload looks again', async () => {
  assert.deepEqual((await run('2 a', null)).pressed, []);
  assert.deepEqual((await run('2 b', {applyRoute: '', applyButton: 'apply'})).pressed, []);
  assert.deepEqual((await run('2 c', {applyRoute: 'manual', applyButton: ''})).pressed, []);
  assert.equal((await run('3 p', {applyRoute: 'manual', applyButton: 'apply manually'})).pressed.length, 1);
  const again = await run('3 p', {applyRoute: 'manual', applyButton: 'apply manually'});
  assert.deepEqual([again.pressed.length, again.out.skipped], [0, true]);
  forgetRouteTries(3);
  assert.equal((await run('3 p', {applyRoute: 'manual', applyButton: 'apply manually'})).pressed.length, 1);
});
