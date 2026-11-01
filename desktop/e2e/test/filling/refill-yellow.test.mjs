// The refill's yellow state: refusals that only mean "record it again" are listed and never red; safety refusals stay red; one alert per changed set. Guards lib/record-guard.mjs (classify), lib/refill-yellow.mjs, refill-yellow.mjs.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {NEEDS_RERECORD, classify} from '../../lib/record-guard.mjs';
import {line, merge, message, sameSet} from '../../lib/refill-yellow.mjs';

// the refusal lines of run 39029506420
const pinned = row => ({row, check: 'pinned', why: 'a pinned row must replay same as live before it replaces its record (asks answered 0/8, 7 extra)'});
const step = row => ({row, check: 'step', why: 'its replay reaches posting, live reached form'});

test('pinned and step refusals need a re-record; every other refusal and a scrub leak stays a failure', () => {
  assert.deepEqual(NEEDS_RERECORD, ['pinned', 'step']);
  const soft = classify({refusals: [pinned('Workday A'), step('Lever B')], notes: []});
  assert.deepEqual(soft.rerecord.map(one => one.row), ['Workday A', 'Lever B']);
  assert.deepEqual(soft.hard, []);
  for (const check of ['text', 'answers', 'replay', 'worse']) assert.deepEqual(classify({refusals: [{row: 'R', check, why: 'x'}], notes: []}), {rerecord: [], hard: ['R']}, `${check} is red`);
  assert.deepEqual(classify({refusals: [], notes: []}, ['Leaky']), {rerecord: [], hard: ['Leaky']}, 'a value left after the scrub is red');
  const both = classify({refusals: [pinned('R'), {row: 'R', check: 'text', why: 'x'}], notes: []});
  assert.deepEqual(both, {rerecord: [], hard: ['R']}, 'a row with a safety refusal is red even when it also needs a re-record');
});

test('records-publish ends red only for hard refusals and writes the list for the workflow', () => {
  const code = fs.readFileSync(new URL('../../records-publish.mjs', import.meta.url), 'utf8');
  assert.match(code, /refusedExit = hard\.length \? 1 : 0/);
  assert.match(code, /--report/);
});

test('the workflow keeps the red path for a failed job and sends the yellow list only when the set changed', () => {
  const wf = fs.readFileSync(new URL('../../../../.github/workflows/replay-refill.yml', import.meta.url), 'utf8');
  assert.match(wf, /--report "\$RUNNER_TEMP\/yellow-g/);
  assert.match(wf, /did not finish/, 'a failed job still alerts red');
  assert.match(wf, /refill-yellow\.mjs .*--previous .*--alert/);
});

test('merge, line and message name the rows; the same set is not told twice', () => {
  const merged = merge([{published: ['a', 'b'], rerecord: [pinned('Zed'), step('Alpha')].map(({row, why}) => ({row, why})), hard: []}, null, {published: ['c'], rerecord: [], hard: []}]);
  assert.equal(merged.published, 3);
  assert.deepEqual(merged.rerecord.map(one => one.row), ['Alpha', 'Zed']);
  assert.match(line(merged), /^🟡 Refill: 3 published, 2 need a re-record: Alpha \(its replay reaches posting, live reached form\); Zed/);
  assert.doesNotMatch(line(merged), /asks answered/, 'counts are cut from the reason');
  const text = message(merged, 'https://github.com/o/r/actions/runs/1').text;
  assert.match(text, /🟡 <b>Replay refill<\/b> 3 published, 2 need a re-record/);
  assert.match(text, /• Alpha: /);
  assert.equal(sameSet(merged, merge([{published: [], rerecord: [step('Zed'), step('Alpha')]}])), true, 'same rows (other reasons, other counts) = no new alert');
  assert.equal(sameSet(merged, merge([{published: [], rerecord: [step('Zed')]}])), false, 'a changed set alerts again');
  assert.equal(sameSet(merged, null), false, 'no earlier run: alert');
});
