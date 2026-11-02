// The offline replay's gate (replay-gate.mjs): only rows 100% same as live in the baseline count; a counted row is worse only when its outcome falls, a fix that
// changes the asks or goes further passes as "different", and a fall the retry does not repeat is noise. Pure: no browser.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {STREAK, askChanged, fell, judge, outdated, refillLine, summary} from '../../replay-gate.mjs';

const form = (filled, left) => ({reached: 'form', filled, left});
const rec = (name, outcome, {hit = 4, asks = 4, extra = 0} = {}) => ({name, outcome, live: {asks}, network: {hit, extra, notRecorded: 0}});
const baseline = {rows: {a: {same: true, streak: 2, outcome: form(8, 4)}, b: {same: true, streak: 2, outcome: form(8, 4)}, c: {same: false, streak: 0, outcome: form(8, 4)}, d: {same: true, streak: 3, outcome: form(8, 4)}}};

test('an outcome falls on an earlier step, fewer filled or more left; a missing number never counts', () => {
  assert.equal(fell(form(8, 4), {reached: 'account', filled: null, left: null}), 'reached account, baseline form');
  assert.equal(fell(form(8, 4), form(7, 4)), 'filled 7, baseline 8');
  assert.equal(fell(form(8, 4), form(8, 5)), 'left 5, baseline 4');
  assert.equal(fell(form(8, 4), form(9, 3)), '');
  assert.equal(fell(form(null, null), form(2, 9)), '');
});

test('only counted rows can be worse; a fix that goes further or only changes the asks passes as different', () => {
  const result = judge([rec('a', form(8, 4)), rec('b', form(6, 6)), rec('c', form(1, 11)), rec('d', form(10, 2), {hit: 2, extra: 1}), rec('new', form(1, 1))], baseline);
  assert.equal(result.rows.a.verdict, 'same');
  assert.equal(result.rows.b.verdict, 'worse');
  assert.equal(result.rows.c.verdict, 'not counted', 'a row not 100% same as live in the baseline never turns the gate red');
  assert.equal(result.rows.d.verdict, 'different');
  assert.match(result.rows.d.why, /further than the baseline: re-record to confirm/);
  assert.equal(result.rows.new.verdict, 'not counted');
  assert.deepEqual([result.counted, result.worse, result.red], [3, 1, true]);
  assert.match(summary(result), /3 of 5 rows counted · 1 worse/);
  const table = summary(result).split('\n').filter(line => /^\| \d+ \|/.test(line));
  assert.equal(table.length, 5, 'every row has a line, the same ones too (owner: one table instead of a job per row)');
  assert.match(table[0], /^\| 1 \| b \| 4\/4 \| form 6\/6 \| – \| ❌ worse \| filled 6, baseline 8 \|$/, 'the worst first, with its asks and outcome');
  assert.match(table.at(-1), /✅ same/);
  assert.match(summary(judge([{...rec('e', form(3, 1), {hit: 3, asks: 4, extra: 1}), liveOutcome: form(4, 0)}])), /\| e \| 3\/4 \+1 \| form 3\/1 \| form 4\/0 \|/);
});

test('a fall the retry does not repeat is noise; a repeated fall stays worse; no baseline is green', () => {
  assert.equal(judge([rec('b', form(6, 6))], baseline, [rec('b', form(8, 4))]).rows.b.verdict, 'noise');
  assert.equal(judge([rec('b', form(6, 6))], baseline, [rec('b', form(6, 6))]).rows.b.verdict, 'worse');
  const first = judge([rec('a', form(8, 4))], {});
  assert.deepEqual([first.counted, first.red], [0, false]);
});

test('a deferred row never counts; a row counts only after 2 runs in a row 100% same as live (14 Oct 2026: Databricks 8/8 then 1/8 turned the gate red)', () => {
  const deferred = judge([{...rec('a', {reached: 'posting', filled: null, left: null}), deferred: 'cookie banner'}], baseline);
  assert.deepEqual([deferred.rows.a.counted, deferred.rows.a.verdict, deferred.red], [false, 'not counted', false]);
  assert.match(deferred.rows.a.why, /^deferred: cookie banner/);
  const once = judge([rec('x', {reached: 'posting', filled: null, left: null})], {rows: {x: {same: true, streak: 1, outcome: form(8, 4)}}});
  assert.deepEqual([once.rows.x.counted, once.red], [false, false], 'one same run is not enough');
  const old = judge([rec('x', form(8, 4))], {rows: {x: {same: true, outcome: form(8, 4)}}});
  assert.deepEqual([old.rows.x.counted, old.rows.x.streak], [false, 2], 'a baseline kept before the streak counts as 1; this run makes 2');
  assert.equal(judge([rec('x', form(8, 4))], {rows: {x: {same: true, streak: STREAK, outcome: form(8, 4)}}}).rows.x.counted, true);
  assert.equal(judge([rec('x', form(8, 4), {hit: 1, extra: 1})], {rows: {x: {same: true, streak: 5}}}).rows.x.streak, 0, 'a run not same resets it');
});

test('a merged PR labeled replay-accepted with a reason makes a worse row accepted; no reason stays red; named rows only', () => {
  const worse = [rec('a', form(7, 5)), rec('b', form(6, 6)), rec('d', form(8, 4))];
  const red = judge(worse, baseline);
  assert.deepEqual([red.worse, red.red], [2, true]);
  const all = judge(worse, baseline, [], {entries: [{pr: 7, text: 'the form dropped a box on purpose'}]});
  assert.deepEqual([all.rows.a.verdict, all.rows.b.verdict, all.worse, all.accepted, all.red], ['accepted', 'accepted', 0, 2, false]);
  assert.match(all.rows.a.why, /PR #7: the form dropped a box on purpose/);
  assert.match(summary(all), /2 accepted/);
  const named = judge(worse, baseline, [], {entries: [{pr: 8, text: 'b — new required field'}]});
  assert.deepEqual([named.rows.a.verdict, named.rows.b.verdict, named.red], ['worse', 'accepted', true]);
  const silent = judge(worse, baseline, [], {entries: [{pr: 9, text: ''}]});
  assert.equal(silent.red, true);
  assert.match(silent.rows.a.why, /add the reason: comment "Replay-accept: <reason>" on PR #9/);
  assert.match(summary(red), /label the PR `replay-accepted`/, 'a red summary says how to accept');
});

test('a recording made before a prompt change is "out of date": never red, listed to re-record; a run that diverged stays worse', () => {
  // 14 Oct 2026: 997af1f changed the digest's answer format; Swatch's first miss differed only in "output" and the row fell 9/9 -> 1/9.
  assert.equal(outdated({differs: ['output']}), true);
  assert.equal(outdated({differs: ['system', 'system:1#2', 'output']}), true);
  assert.equal(outdated({differs: ['system', 'user:line', 'output']}), false, 'a page-side part too: the run diverged (Greenhouse), not a prompt change');
  assert.equal(outdated({differs: ['model']}), false, 'another model is another question');
  assert.equal(outdated({differs: []}), false);
  assert.equal(outdated(null), false);
  const fallen = {...rec('a', form(1, 11)), firstMiss: {differs: ['output']}};
  const result = judge([fallen, {...rec('b', form(6, 6)), firstMiss: {differs: ['system', 'user:line']}}], baseline);
  assert.equal(result.rows.a.verdict, 'out of date');
  assert.match(result.rows.a.why, /re-record: the prompt changed/);
  assert.equal(result.rows.b.verdict, 'worse');
  assert.deepEqual([result.worse, result.red], [1, true], 'only b turns the gate red');
  assert.equal(judge([fallen], baseline).red, false);
  assert.match(summary(result), /🔁 out of date/);
  assert.match(fs.readFileSync(new URL('../../replay-net.mjs', import.meta.url), 'utf8'), /JOBADABRA_MODEL_MEMO_MISSLOG = path\.join\(out, 'misslog\.jsonl'\)/, 'replay-net keeps the whole list of differing parts');
});

test('a row whose only misses are asks the memo lacks is "ask changed", never worse or red (the gate waits for a local replay)', () => {
  const missing = (name, differs, extra = 2, notRecorded = 0) => ({...rec(name, form(6, 6), {hit: 2, extra}), network: {hit: 2, extra, notRecorded}, firstMiss: {differs}});
  const result = judge([missing('b', ['user:form_fields']), missing('a', ['user:rest', 'output']), missing('d', ['user:job'], 2, 3), missing('c', ['system:1'])], baseline);
  assert.equal(result.rows.b.verdict, 'ask changed', 'a counted row that fell because its ask has no kept answer');
  assert.match(result.rows.b.why, /needs a local replay.*user:form_fields/);
  assert.equal(result.rows.a.verdict, 'ask changed');
  assert.equal(result.rows.d.verdict, 'worse', 'site requests missing too: not only an ask change');
  assert.equal(result.rows.c.verdict, 'out of date', 'a prompt-only change stays out of date');
  assert.deepEqual([result.worse, result.red], [1, true], 'only d turns it red');
  assert.equal(judge([missing('b', ['user:form_fields'])], baseline).red, false);
  assert.match(summary(judge([missing('b', ['user:form_fields'])], baseline)), /🖥 ask changed/);
  assert.equal(askChanged({network: {extra: 1, notRecorded: 0}, firstMiss: {differs: ['user:form_fields#2']}}), true, 'a repeated part name');
  assert.equal(askChanged({network: {extra: 0, notRecorded: 0}, firstMiss: {differs: ['user:form_fields']}}), false, 'no extra ask: nothing to fill');
  assert.equal(askChanged({network: {extra: 1, notRecorded: 0}, firstMiss: null}), false, 'no named part: not known');
});

test('a row answered from kept answers although the system prompt changed says so in the summary (loose hits), and still counts', () => {
  const loose = (name, n, parts) => ({...rec(name, form(8, 4)), network: {hit: 4, extra: 0, notRecorded: 0, loose: n, looseParts: parts}});
  const result = judge([loose('a', 3, ['system:0', 'model']), rec('b', form(8, 4))], baseline);
  assert.equal(result.rows.a.verdict, 'same', 'a system-only change is not a miss, so the row stays on its recording');
  assert.equal(result.rows.a.loose, 3);
  const text = summary(result);
  assert.match(text, /Answered although the system side changed: 1 row/);
  assert.match(text, /\| a \| 3 \| system:0, model \|/);
  assert.doesNotMatch(summary(judge([rec('b', form(8, 4))], baseline)), /Answered although/, 'no loose hit, no line');
});

test('a pinned row whose ask changed or prompt changed prints the refill next step, red or not; a row that is fine does not', () => {
  const missing = (name, differs) => ({name, outcome: form(8, 4), live: {asks: 4}, network: {hit: 2, extra: 2, notRecorded: 0}, firstMiss: {differs}});
  const pinnedRows = judge([missing('a', ['user:form_fields']), missing('b', ['system:0']), rec('c', form(8, 4))], {}, [], {}, ['a', 'b', 'c']);
  assert.equal(pinnedRows.rows.a.verdict, 'worse', 'a pinned row that is not same as live is red');
  assert.deepEqual([pinnedRows.rows.a.refill, pinnedRows.rows.b.refill, pinnedRows.rows.c.refill], [true, true, false]);
  const text = summary(pinnedRows, {pr: 824});
  assert.ok(text.includes('gh workflow run replay-refill.yml -f pr=824  (the PR gate starts it by itself'), 'the next step line');
  assert.match(text, /2 rows need their answers refilled \(a, b\)/);
  assert.match(refillLine(), /^gh workflow run replay-refill\.yml -f pr=<n>  \(the PR gate starts it by itself, at most \$0\.50 a run and \$5 a month/);
  assert.doesNotMatch(summary(judge([rec('c', form(8, 4))], {}, [], {}, ['c']), {pr: 824}), /replay-refill/, 'no line when nothing is stale');
});
