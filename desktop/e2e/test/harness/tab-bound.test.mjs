// Plays the app log of stable canary 41312012476 (1 Nov 2026): a form tab the app opened and nothing heard from the extension for 259 s, so lostTabNote names it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {fillNote} from '../../lib/extension.mjs';
import {lostTabIn, lostTabNote} from '../../lib/tab-bound.mjs';

// The log's lines as recorded (no paths, no tokens); the fill steps failed at 13:42:34 to 13:42:37, before the extension's late report at 13:42:46.
const LOG = fs.readFileSync(new URL('../fixtures/canary-41312012476-app-log.txt', import.meta.url), 'utf8').split('\n').filter(Boolean);
const upTo = stamp => LOG.filter(line => line.slice(0, 24) < stamp).join('\n');

test('the canary at its failure: the second form tab was opened and the app heard nothing from the extension about it', () => {
  const note = lostTabNote(upTo('2026-11-01T13:42:35'));
  assert.match(note, /^the app heard nothing from the extension about the tab it opened \(session efa5be5b, jobs\.lever\.co, opened at 13:38:16Z/);
  assert.equal(fillNote(null, 257.365, {lost: note}), `${note}; the fill did not finish within 257.365 s (last seen: null)`);
});

test('positive control: the first form tab of the same log was heard, and the note is empty', () => {
  assert.equal(lostTabNote(upTo('2026-11-01T13:38:00')), '');
  assert.equal(fillNote(null, 90, {lost: ''}), 'the fill did not finish within 90 s (last seen: null)', 'no cause = the old note, byte for byte');
});

test('the late report of the same tab (it arrives 269 s after) clears the note', () => {
  const late = LOG.filter(line => line.slice(0, 24) < '2026-11-01T13:42:47').filter(line => !line.includes('3053bc08')).join('\n');
  assert.equal(lostTabNote(late), '');
});

test('no form tab opened, nothing to name; a report for another host does not count', () => {
  assert.equal(lostTabNote(''), '');
  assert.equal(lostTabNote('2026-11-01T13:37:00.000Z [app] start 0.8.60'), '');
  const other = ['2026-11-01T13:38:16.929Z [apply] opened the form tab {"session":"efa5be5b","host":"jobs.lever.co","mark":true}',
    '2026-11-01T13:38:17.000Z [extension] tab: tab with the fill mark seen {"host":"other.example","session":true,"tab":1}'].join('\n');
  assert.match(lostTabNote(other), /efa5be5b/);
});

test('a finished fill state is never given a cause', () => {
  const state = {state: 'done'};
  assert.equal(fillNote(state, 90, {lost: 'a cause'}), `state: ${JSON.stringify(state)}`);
});

test('an unreadable profile gives no cause and no throw', () => {
  assert.equal(lostTabIn(undefined), '');
  assert.equal(lostTabIn('/nonexistent-profile-for-this-test'), '');
});
