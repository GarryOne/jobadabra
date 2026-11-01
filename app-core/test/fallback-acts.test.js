// The CI pool acting at a dead end (extension/ladder/fallback.js; spec 2026-10-12-one-next-move.md box 8): under the harness's test switch only, a move the one rule lets act (next-move.js mayAct: sure, past the
// floors, two asks naming the same control) is pressed through the live press path, its effect is checked right after (effectOf: an apply press must show a form, or a new page with fields), and the line says
// what happened with the door's id and fixed values only. Never repeated, never for users (no switch: shadow only).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {askAtDeadEnd, forgetFallback, useFallback} from '../../extension/ladder/fallback.js';

const logged = [], acts = [];
let switchOn = true, observed = {form: true};
const move = (n = 3) => ({role: 'posting', signal: 'confident', confidence: 0.9, usd: 0.0004, applyButton: 'Apply now', digestSaid: {outcome: 'form', verb: 'press', numbers: [n], pressKind: 'apply', dropped: ''}});
useFallback({log: (area, what, data) => logged.push({what, data}), ask: async () => move(), floor: async () => ({press: true, why: null}), tab: async id => ({id, url: 'https://jobs.example/1'}),
  acts: async () => switchOn, act: async (tab, said) => { acts.push({tab: tab.id, named: said.named}); return observed; }});
const stop = (door, why = 'no-form') => askAtDeadEnd({door, tabId: 1, page: 'https://jobs.example/1', why});

test('off (no test switch): shadow only, nothing is pressed', async () => {
  switchOn = false; forgetFallback(1);
  const fields = await stop(1);
  assert.equal(fields.wouldAct, true);
  assert.deepEqual(acts, []);
  assert.equal(logged.some(item => item.what === 'dead end fallback (acted)'), false);
});

test('on: an agreed, sure press past the floors acts once; its effect is checked and logged with the door\'s id and no page text', async () => {
  switchOn = true; forgetFallback(1); acts.length = 0; logged.length = 0;
  const fields = await stop(2);
  assert.deepEqual(acts, [{tab: 1, named: 'Apply now'}]);
  const line = logged.find(item => item.what === 'dead end fallback (acted)');
  assert.deepEqual(Object.keys(line.data).sort(), ['door', 'effect', 'ms', 'number', 'pressKind', 'shadow', 'why'].sort());
  assert.deepEqual([line.data.door, line.data.effect, line.data.number, line.data.pressKind, line.data.shadow], [2, 'worked', 3, 'apply', false]);
  assert.equal(fields.acted, 'worked');
  assert.equal(JSON.stringify(logged).includes('Apply now'), false, 'the control\'s own words never reach the log');
});

test('an effect that does not show is failed, and never repeated on the page', async () => {
  observed = {}; forgetFallback(1); acts.length = 0; logged.length = 0;
  assert.equal((await stop(3)).acted, 'failed');
  assert.equal(await stop(4), null, 'one question per page and tab: no second press');
  assert.equal(acts.length, 1);
  observed = {form: true};
});

test('a move that may not act (unsure, floor refused, one control named twice differently) never presses', async () => {
  switchOn = true; acts.length = 0;
  for (const said of [{...move(), confidence: 0.5}, {...move(), digestSaid: {outcome: 'form', verb: 'tell_person', numbers: [], pressKind: '', dropped: ''}}]) {
    forgetFallback(1);
    useFallback({ask: async () => said});
    await stop(5);
  }
  useFallback({ask: async () => move(), floor: async () => ({press: false, why: {found: 1, visible: 1, enabled: 1, submits: 1}})});
  forgetFallback(1); await stop(6);
  assert.deepEqual(acts, []);
  useFallback({floor: async () => ({press: true, why: null})});
});

test('wired: the test switch is the harness\'s ladderAct, the press is the live Apply press (the floors), and the pool summary counts the result', () => {
  const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
  assert.match(flow, /acts: async \(\) => \(await settings\(\)\.catch\(\(\) => null\)\)\?\.ladderAct === true/);
  assert.match(flow, /act: actOnMove/);
  assert.match(flow, /const actOnMove = async \(tab, move\) => \{[\s\S]*?pressApply\(tab\.id, \[\{key: 'apply_button', phrase: move\.named\}\]/);
});
