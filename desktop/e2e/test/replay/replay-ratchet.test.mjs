// The replay ratchet (owner, 15 Oct 2026): a pinned row must stay same as live; every way a replay stops being same (ask changed, other asks, out of date, worse, not replayed) is red
// on a pinned row, unless an accept NAMES it. Guards lib/replay-ratchet.mjs and the pins path of replay-gate.mjs. Pure: no browser.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FLAKY_AT, judge, summary} from '../../replay-gate.mjs';
import {lowered, newlyFaithful, pin, pinned} from '../../lib/replay-ratchet.mjs';

const form = (filled, left) => ({reached: 'form', filled, left});
const rec = (name, {hit = 4, asks = 4, extra = 0, firstMiss = null, deferred = null, outcome = form(8, 4)} = {}) => ({name, outcome, firstMiss, deferred, live: {asks}, network: {hit, extra, notRecorded: 0}});
// every way a pinned row can stop being same as live
const BROKEN = {
  'ask changed': rec('p', {hit: 3, extra: 1, firstMiss: {differs: ['user:left_unfilled (lines 2 of 3)']}}),
  'other asks': rec('p', {hit: 3, extra: 1}),
  'out of date': rec('p', {hit: 3, extra: 1, firstMiss: {differs: ['system:0']}}),
  'outcome fell': rec('p', {hit: 3, extra: 1, outcome: form(6, 6)}),
};

test('a pinned row same as live is "same"; every way it stops being same is red', () => {
  assert.equal(judge([rec('p')], {}, [], {}, ['p']).rows.p.verdict, 'same');
  for (const [kind, record] of Object.entries(BROKEN)) {
    const result = judge([record], {}, [], {}, ['p']);
    assert.equal(result.rows.p.verdict, 'worse', kind);
    assert.equal(result.red, true, kind);
    assert.match(result.rows.p.why, /^pinned same as live, now /, kind);
  }
});

test('a pinned row the run did not replay is red; a deferred row is not held', () => {
  const missing = judge([rec('q')], {}, [], {}, ['p', 'q']);
  assert.equal(missing.rows.p.verdict, 'worse');
  assert.match(missing.rows.p.why, /did not replay it/);
  assert.equal(missing.red, true);
  assert.equal(judge([rec('p', {hit: 3, extra: 1, deferred: 'owner'})], {}, [], {}, ['p']).red, false);
});

test('an accept covers only the row it names; a bare reason accepts no pinned row', () => {
  const rows = [rec('p', {hit: 3, extra: 1}), rec('r', {hit: 3, extra: 1})];
  const bare = judge(rows, {}, [], {entries: [{pr: 7, text: 'intended'}]}, ['p', 'r']);
  assert.deepEqual([bare.rows.p.verdict, bare.rows.r.verdict, bare.red], ['worse', 'worse', true]);
  const named = judge(rows, {}, [], {entries: [{pr: 7, text: 'p — one slot per upload widget'}]}, ['p', 'r']);
  assert.deepEqual([named.rows.p.verdict, named.rows.r.verdict, named.red], ['accepted', 'worse', true]);
  assert.match(named.rows.p.why, /PR #7: one slot per upload widget/);
});

test('a retry that is same as live makes a pinned row noise, not red', () => {
  const result = judge([rec('p', {hit: 3, extra: 1})], {}, [rec('p')], {}, ['p']);
  assert.equal(result.rows.p.verdict, 'noise');
  assert.equal(result.red, false);
});

test('a row same as live and not pinned is "newly same": reported, never red, and the line says how to pin it', () => {
  const result = judge([rec('p'), rec('n')], {}, [], {}, ['p']);
  assert.equal(result.rows.n.verdict, 'newly same');
  assert.equal(result.red, false);
  assert.match(summary(result), /2 of 2 same as live \(pinned 1\) · 0 worse · 1 newly same: ratchet up/);
  assert.match(result.rows.n.why, /replay-ratchet\.mjs pin/);
});

test('a pinned row not same shows the fidelity number and the named-accept hint', () => {
  const text = summary(judge([rec('p', {hit: 3, extra: 1}), rec('q')], {}, [], {}, ['p', 'q']));
  assert.match(text, /1 of 2 same as live \(pinned 2\) · 1 worse/);
  assert.match(text, /A pinned row needs its own name/);
});

test('pin raises only: same rows are pinned with the commit, a row not same stays as it was, a deferred row is never pinned', () => {
  const first = pin({rows: {a: {same: true}, b: {same: false}, c: {same: true, deferred: 'x'}}}, {rows: {}}, {commit: 'abc1234', at: 'T1'});
  assert.deepEqual(Object.keys(first.rows), ['a']);
  assert.deepEqual(first.rows.a, {mac: null, kind: 'a', runner: true, runnerCommit: 'abc1234', runnerAt: 'T1'});   // kind: a row on no known platform is its own kind
  const second = pin({rows: {a: {same: false}, b: {same: true}}}, first, {commit: 'def5678', at: 'T2'});
  assert.equal(second.rows.a.runner, true, 'a row that is not same this time is never lowered by the tool');
  assert.equal(second.rows.a.runnerCommit, 'abc1234', 'the commit it was first proven on stays');
  assert.deepEqual(pinned(second), ['a', 'b']);
  assert.equal(pin({rows: {a: {same: true}}}, {rows: {}}, {place: 'mac', commit: 'm'}).rows.a.mac, true);
  assert.throws(() => pin({}, {rows: {}}, {place: 'moon'}));
});

test('a pin lowered in a PR stays held by the base copy; newly faithful rows are listed', () => {
  const base = {rows: {a: {runner: true}, b: {runner: true}}}, now = {rows: {a: {runner: true}}};
  assert.deepEqual(lowered(base, now), ['b']);
  assert.deepEqual(newlyFaithful({rows: {a: {same: true}, c: {same: true}, d: {same: false}}}, now), ['c']);
  const result = judge([rec('a'), rec('b', {hit: 3, extra: 1})], {}, [], {}, [...new Set([...pinned(now), ...pinned(base)])]);
  assert.equal(result.rows.b.verdict, 'worse');
});

test('linux is a place: a row pinned on Linux is held like one pinned on the runner; the Mac place is a record, never held', () => {
  const data = pin({rows: {a: {same: true}}}, pin({rows: {b: {same: true}}}, pin({rows: {m: {same: true}}}, {rows: {}}, {place: 'mac', commit: 'm'}), {place: 'linux', commit: 'l'}), {place: 'runner', commit: 'r'});
  assert.deepEqual(pinned(data), ['a', 'b']);
  assert.equal(data.rows.b.linux, true);
  assert.equal(data.rows.m.mac, true);
  assert.equal(judge([rec('b', {hit: 3, extra: 1})], {}, [], {}, pinned(data)).rows.b.verdict, 'worse');
});

test('a PR judges only the rows its pick replayed: an unpicked pinned row is "not replayed on PRs", never worse; the scheduled run still needs every pinned row', () => {
  const pins = ['a', 'b', 'c'], records = [rec('a'), rec('b')];
  const pr = judge(records, {}, [], {}, pins, new Set(['a', 'b']));
  assert.equal(pr.rows.c.verdict, 'not counted');
  assert.match(pr.rows.c.why, /not replayed on PRs/);
  assert.equal(pr.red, false);
  const scheduled = judge(records, {}, [], {}, pins);
  assert.equal(scheduled.rows.c.verdict, 'worse');
  assert.equal(scheduled.red, true);
  assert.equal(judge([rec('a'), rec('b', {hit: 3, extra: 1})], {}, [], {}, pins, new Set(['a', 'b'])).rows.b.verdict, 'worse', 'a picked row that is not same is still red');
  assert.equal(judge(records, {}, [], {}, pins, new Set(['a', 'b', 'c'])).rows.c.verdict, 'worse', 'a picked row that was not replayed is red');
});

test('pin keeps each row\'s kind from the host its form was on; a later pin without the host keeps it', () => {
  const first = pin({rows: {a: {same: true, formHost: 'job-boards.greenhouse.io'}}}, {rows: {}}, {commit: 'c1', at: 'T'});
  assert.equal(first.rows.a.kind, 'Greenhouse');
  assert.equal(pin({rows: {a: {same: true}}}, first, {commit: 'c2', at: 'T2'}).rows.a.kind, 'Greenhouse');
});

const NOW = new Date('2026-10-15T12:00:00Z'), DAY = 864e5;
const broken = rec('p', {hit: 3, extra: 1});

test('a pinned row that passes only on its retry is "noise (passed on retry)", never silent; the dates ride on, and 3 in 7 days flags it', () => {
  const once = judge([broken], {}, [rec('p')], {}, ['p'], null, NOW);
  assert.equal(once.rows.p.verdict, 'noise');
  assert.match(once.rows.p.why, /passed on retry/);
  assert.equal(once.red, false);
  assert.match(summary(once), /🟡 noise \(passed on retry\)/);
  assert.equal(once.flaky, 0);
  // the baseline (the last green run) carries the earlier dates; one older than 7 days is dropped
  const at = days => new Date(NOW - days * DAY).toISOString();
  const twice = judge([broken], {rows: {p: {noiseAt: [at(2), at(9)]}}}, [rec('p')], {}, ['p'], null, NOW);
  assert.equal(twice.rows.p.noiseAt.length, 2, 'the 9-day-old one is pruned, today\'s added');
  assert.equal(twice.flaky, 0);
  const third = judge([broken], {rows: {p: {noiseAt: [at(1), at(3)]}}}, [rec('p')], {}, ['p'], null, NOW);
  assert.equal(third.rows.p.noiseAt.length, FLAKY_AT);
  assert.equal(third.flaky, 1);
  assert.equal(third.red, false, 'flagged for a look, not red');
  assert.match(summary(third), /Flaky: passed only on a retry 3\+ times in 7 days \(1\)/);
  // a same row carries the history without adding to it; a retry that fails too is worse
  assert.equal(judge([rec('p')], {rows: {p: {noiseAt: [at(1)]}}}, [], {}, ['p'], null, NOW).rows.p.noiseAt.length, 1);
  assert.equal(judge([broken], {}, [broken], {}, ['p'], null, NOW).rows.p.verdict, 'worse');
});

test('a deferred row is never pinned, whether the run\'s record says deferred or the gate\'s row says "deferred: ..." in its why', () => {
  const data = pin({rows: {a: {same: true}, b: {same: true, deferred: 'x'}, c: {same: true, why: 'deferred: varies run to run'}, d: {same: true, why: ''}}}, {rows: {}}, {commit: 'c', at: 'T'});
  assert.deepEqual(Object.keys(data.rows).sort(), ['a', 'd']);
});

// Judge outcomes, not wording (owner, 17 Oct 2026; the #1147 shapes): a pinned row whose ask changed is red only when its outcome got worse than live's.
const asked = (live, now, differs = ['user:left_unfilled (lines 2 of 3)'], extra = {}) => ({...rec('p', {hit: 3, extra: 1, firstMiss: {differs}, outcome: now}), liveOutcome: live, ...extra});
test('a pinned row whose ask changed but whose outcome is equal or better is green with a note', () => {
  for (const [kind, live, now] of [['same counts (Recruitee 9/7, Teamtailor 8/5)', form(9, 7), form(9, 7)], ['consent tick: one fewer left', form(9, 7), form(10, 6)]]) {
    const result = judge([asked(live, now)], {}, [], {}, ['p']);
    assert.equal(result.rows.p.verdict, 'same', kind);
    assert.equal(result.rows.p.askNote, 'ask changed: 2 lines', kind);
    assert.equal(result.rows.p.refill, false, `${kind}: nothing to refill`);
    assert.equal(result.red, false, kind);
    assert.match(summary(result, {pr: 1}), /✅ same \(ask changed: 2 lines\)/, kind);
    assert.doesNotMatch(summary(result, {pr: 1}), /replay-refill/, kind);
  }
  assert.equal(judge([asked(form(9, 7), form(9, 7), ['system:0'])], {}, [], {}, ['p']).red, false, 'an instructions-only change too');
});

test('a changed ask is still red when the outcome got worse, the step is earlier, a value is wrong, a site request is missing or there is nothing to compare', () => {
  const red = record => { const result = judge([record], {}, [], {}, ['p']); assert.equal(result.red, true); return result.rows.p; };
  assert.equal(red(asked(form(9, 7), form(8, 8))).refill, true, 'a filled field now left: a refill may fix it');
  red(asked(form(9, 7), {reached: 'account', filled: 9, left: 7}));
  red(asked({reached: 'form', filled: 9, left: 7, wrong: 0}, {reached: 'form', filled: 9, left: 7, wrong: 1}));
  red(asked(form(9, 7), form(9, 7), undefined, {network: {hit: 3, extra: 1, notRecorded: 2}}));
  red({...asked(form(9, 7), form(9, 7)), liveOutcome: null});
  red(asked(form(9, 7), form(9, 7), undefined, {firstMiss: null}));   // other asks without a named part: not an ask change
});
