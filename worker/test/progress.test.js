// The run's progress in shadow (extension/ladder/progress.js; spec 2026-10-12-one-next-move.md phase 2 box 2): fixed kinds, one log line each with the time since the last,
// a new page only when its key changes, and a page script may send only value_stayed (the fill ladder's attempt log calls it; this file never detects a value).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const listeners = {message: [], removed: []};
globalThis.chrome = {runtime: {onMessage: {addListener: fn => listeners.message.push(fn)}}, tabs: {onRemoved: {addListener: fn => listeners.removed.push(fn)}}};
const {PAGE_KINDS, PROGRESS_KINDS, forgetProgress, lastProgress, notePage, noteProgress, useProgressLog} = await import('../../extension/ladder/progress.js');
const {silenceOf} = await import('../../extension/ladder/silence.js');
delete globalThis.chrome;

test('fixed kinds; each is one "progress: <kind>" line with fixed values and the time since the last; anything else is refused', () => {
  const logged = [];
  useProgressLog((area, what, data) => logged.push({area, what, data}));
  assert.deepEqual(PROGRESS_KINDS, ['navigated', 'new_controls', 'required_down', 'value_stayed']);
  assert.equal(noteProgress(1, 'new_controls', {fields: 4, frames: 0}, 1000), true);
  assert.equal(noteProgress(1, 'required_down', {filled: 2, label: 'Your full name, please'}, 4500), true);
  assert.equal(noteProgress(1, 'clicked', {}, 5000), false);
  assert.equal(noteProgress(null, 'navigated'), false);
  assert.deepEqual(logged.map(line => [line.area, line.what]), [['fill', 'progress: new_controls'], ['fill', 'progress: required_down']]);
  assert.deepEqual(logged[0].data, {tab: 1, fields: 4, frames: 0}, 'the tab the line came from: a replay in several tabs places it by that');
  assert.deepEqual(logged[1].data, {tab: 1, filled: 2, sinceMs: 3500}, 'page words never kept');
  assert.deepEqual(lastProgress(1), {at: 4500, kind: 'required_down'});
  forgetProgress(1);
  assert.equal(lastProgress(1), null);
});

test('a page counts as navigated once per new page key; looking at the same page again is not progress', () => {
  const logged = [];
  useProgressLog((area, what) => logged.push(what));
  assert.equal(notePage(2, '2 jobs.example/a', {job: 'https://jobs.example/a', page: 'https://jobs.example/a'}, 0), true);
  assert.equal(notePage(2, '2 jobs.example/a', {job: 'https://jobs.example/a', page: 'https://jobs.example/a'}, 10), false);
  assert.equal(notePage(2, '2 jobs.example/b', {job: 'https://jobs.example/a', page: 'https://jobs.example/b'}, 20), true);
  assert.deepEqual(logged, ['progress: navigated', 'progress: navigated']);
  listeners.removed.forEach(fn => fn(2));
  assert.equal(notePage(2, '2 jobs.example/b', {}, 30), true, 'a closed tab is forgotten');
  assert.equal(silenceOf(2)?.host, '', 'its application clock too: the page known again starts a clock of its own');
});

test('a page script may send only value_stayed; any other kind, or a message from no tab, is ignored and never answered', () => {
  const logged = [];
  useProgressLog((area, what) => logged.push(what));
  assert.deepEqual(PAGE_KINDS, ['value_stayed']);
  const send = (message, sender) => listeners.message.forEach(fn => assert.equal(fn(message, sender), undefined));
  send({type: 'progress', kind: 'value_stayed'}, {tab: {id: 3}});
  send({type: 'progress', kind: 'navigated'}, {tab: {id: 3}});
  send({type: 'progress', kind: 'value_stayed'}, {});
  send({type: 'panelFill'}, {tab: {id: 3}});
  assert.deepEqual(logged, ['progress: value_stayed']);
});

test('the fill flow notes each kind of its own where it happens (a new page, fields that appeared, a required field filled); value_stayed only from a page script', () => {
  const flow = ['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8')).join('\n');
  assert.match(flow, /useProgressLog\(decide\)/);
  assert.match(flow, /started\.add\(key\);\n\s*notePage\(tab\.id, key, \{job: jobUrl \|\| tab\.url, page: tab\.url\}\)/);
  assert.match(flow, /noteProgress\(tab\.id, 'new_controls'/);
  assert.match(flow, /noteProgress\(tab\.id, 'required_down'/);
  assert.doesNotMatch(flow, /'value_stayed'/);
});
