// The one question at each dead end, in shadow (extension/ladder/fallback.js; spec 2026-10-12-one-next-move.md phase 2 box 4): asked once per page after today's report, the move
// run through the live press path's floors without pressing, logged with the door's id and fixed values only; nothing acts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {askAtDeadEnd, floorWord, forgetFallback, useFallback} from '../../extension/ladder/fallback.js';

const logged = [], asks = [], floors = [];
let answer = null, pressable = true, tabs = {};
useFallback({log: (area, what, data) => logged.push({what, data}), ask: async (tab, opts) => { asks.push({tab: tab.id, ...opts}); return answer; },
  floor: async (tabId, named) => { floors.push(named); return pressable ? {press: true, why: null} : {press: false, why: {found: 1, visible: 1, enabled: 1, submits: 1, pickable: false}}; },
  tab: async tabId => tabs[tabId] || null});
const said = (verb, extra = {}) => ({role: 'posting', signal: 'confident', confidence: 0.9, usd: 0.0004, applyButton: verb === 'press' ? 'Apply now' : '',
  digestSaid: {outcome: 'form', verb, numbers: [3], pressKind: verb === 'press' ? 'apply' : '', dropped: ''}, ...extra});

test('asked once per page, in shadow; a press goes through the live floors without pressing; the move is logged with the door\'s id and fixed values only', async () => {
  tabs = {1: {id: 1, url: 'https://jobs.example/1#top'}};
  answer = said('press');
  const fields = await askAtDeadEnd({door: 7, tabId: 1, page: 'https://jobs.example/1', why: 'no-form', rung: 2});
  assert.deepEqual(asks, [{tab: 1, digest: true, shadow: true}, {tab: 1, digest: true, shadow: true}], 'a sure press past the floors is asked twice (ladder/next-move.js)');
  assert.deepEqual(floors, ['Apply now', 'Apply now']);
  assert.deepEqual(fields, {shadow: true, door: 7, why: 'no-form', signal: 'confident', outcome: 'form', verb: 'press', number: 3, pressKind: 'apply', confidence: 0.9, usd: 0.0008, floor: 'ok',
    agree: true, wouldAct: true, actWhy: 'agreed'});
  assert.deepEqual(logged.at(-1), {what: 'dead end fallback (shadow)', data: fields});
  assert.equal(await askAtDeadEnd({door: 8, tabId: 1, page: 'https://jobs.example/1#again', why: 'no-form'}), null, 'one question per page and tab');
  assert.equal(asks.length, 2);
});

test('two asks that name different controls never act; the second ask is spent only on a sure press past the floors', async () => {
  forgetFallback(1);
  const before = asks.length;
  let n = 0;
  useFallback({ask: async (tab, opts) => { asks.push({tab: tab.id, ...opts}); n++; return said('press', {digestSaid: {outcome: 'form', verb: 'press', numbers: [n], pressKind: 'apply', dropped: ''}}); }});
  const fields = await askAtDeadEnd({door: 15, tabId: 1, page: 'https://jobs.example/1', why: 'no-form'});
  assert.deepEqual([fields.number, fields.agree, fields.wouldAct, fields.actWhy, asks.length - before], [1, false, false, 'disagree', 2]);
  useFallback({ask: async (tab, opts) => { asks.push({tab: tab.id, ...opts}); return answer; }});
});

test('a move the floors refuse is logged as refused with one fixed word, never as a move; a control not judged an Apply is refused before the finder', async () => {
  forgetFallback(1);
  pressable = false;
  assert.equal((await askAtDeadEnd({door: 9, tabId: 1, page: 'https://jobs.example/1', why: 'account'})).floorWhy, 'submits');
  forgetFallback(1);
  answer = said('press', {applyButton: ''});
  assert.deepEqual((({floor, floorWhy}) => ({floor, floorWhy}))(await askAtDeadEnd({door: 10, tabId: 1, page: 'https://jobs.example/1', why: 'account'})), {floor: 'refused', floorWhy: 'not_apply'});
  forgetFallback(1);
  answer = said('tell_person');
  const told = await askAtDeadEnd({door: 11, tabId: 1, page: 'https://jobs.example/1', why: 'other'});
  assert.deepEqual([told.floor, told.wouldAct, told.actWhy, 'agree' in told], ['none', false, 'person', false], 'nothing to press: one ask, the person is told');
  assert.deepEqual([floorWord(null), floorWord({found: 0}), floorWord({found: 1, visible: 0}), floorWord({found: 1, visible: 1, enabled: 0}), floorWord({found: 1, visible: 1, enabled: 1, submits: 0})],
    ['absent', 'absent', 'hidden', 'disabled', 'refused']);
  pressable = true;
});

test('an unsure or failed answer is logged with its signal; page words never reach the log', async () => {
  forgetFallback(1);
  answer = {error: 'unsure (0.5)', rung: 3, signal: 'unsure', usd: 0.0003, digestSaid: {outcome: 'Bewerben Sie sich', verb: 'none', numbers: [], pressKind: '', dropped: ''}};
  const fields = await askAtDeadEnd({door: 12, tabId: 1, page: 'https://jobs.example/1', why: 'Send your CV to jane@x.example'});
  assert.deepEqual(fields, {shadow: true, door: 12, why: '', signal: 'unsure', outcome: '', verb: 'none', number: -1, pressKind: '', confidence: -1, usd: 0.0003, floor: 'none', wouldAct: false, actWhy: 'person'});
});

test('not asked where the digest decided the stop (its next rung, the picture, is off), nor when the tab left the stop\'s page', async () => {
  const before = asks.length;
  assert.equal(await askAtDeadEnd({door: 13, tabId: 2, page: 'https://jobs.example/2', why: 'no-form', rung: 3}), null);
  assert.deepEqual(logged.at(-1), {what: 'dead end fallback (shadow): asked already', data: {shadow: true, door: 13, why: 'no-form', climb: 'picture_off'}});
  tabs[3] = {id: 3, url: 'https://jobs.example/3/form'};
  assert.equal(await askAtDeadEnd({door: 14, tabId: 3, page: 'https://jobs.example/3', why: 'account'}), null);
  assert.equal(logged.at(-1).what, 'dead end fallback (shadow): the page moved on');
  assert.equal(asks.length, before, 'no AI call: no spend');
});

test('wired: the door asks after today\'s report with its id and the stop\'s rung; askKind\'s shadow keeps no climb signal; the floors are the live press path\'s own', () => {
  const read = file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8');
  assert.match(read('ladder/dead-end.js'), /const sent = report\([^;]*;\n\s*Promise\.resolve\(sent\)\.catch\(\(\) => \{\}\)\.then\(\(\) => askAtDeadEnd\(\{door, tabId: stop\.tabId, page: stop\.page, why, rung: evidence\?\.rung\}\)\);[^\n]*\n\s*return sent;/);
  const flow = read('fill-flow.js');
  assert.match(flow, /useFallback\(\{ask: askKind, floor: wouldPress, asked: digestAsked, log: decide, acts: [^\n]*act: actOnMove, look: [^\n]*\}\)/);
  const climb = read('ladder/climb.js');
  assert.equal((climb.match(/await askDigest\(tab, ask\)/g) || []).length, 2, 'both climbs record the page they asked the digest on');
  assert.doesNotMatch(climb, /await ask\(tab, \{digest: true\}\)/, 'no climb asks the digest unrecorded');
  assert.match(flow, /if \(shadow\) return answer;[^\n]*\n\s*noteSignal\(tab\.id, answer, sketch\.controls\);/, 'shadow returns before the climb signal');
  const press = read('apply-press.js');
  assert.match(press, /export async function wouldPress\(tabId, named, noEffect = \[\]\) \{\n\s*const candidates = \(await applyCandidates\(tabId, NAMED_BUTTONS\)\)[^\n]*\n\s*return pickNamedButton\(candidates, named\) \? \{press: true, why: null\} : \{press: false, why: whyNotPressed\(candidates, named\)\};/);
  assert.match(press, /pick = target \? pickNamedButton\(candidates, target\)/, 'the live path picks a named control with the same finder');
});

test('a page where a climb already asked the digest gets no second question (no spend), whatever rung the stop names', async () => {
  const before = asks.length;
  tabs[5] = {id: 5, url: 'https://jobs.example/5'};
  useFallback({asked: (tabId, page) => tabId === 5 && page === 'https://jobs.example/5'});
  assert.equal(await askAtDeadEnd({door: 20, tabId: 5, page: 'https://jobs.example/5', why: 'other', rung: 2}), null);
  assert.deepEqual(logged.at(-1), {what: 'dead end fallback (shadow): asked already', data: {shadow: true, door: 20, why: 'other', climb: 'picture_off'}});
  assert.equal(asks.length, before);
  useFallback({asked: () => false});
});
