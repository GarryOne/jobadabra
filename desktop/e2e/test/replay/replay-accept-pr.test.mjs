// An intended replay drop accepted on the PR itself (owner, 14 Oct 2026): the gate's field-by-field evidence, the PR's own label + comments read as accepts, and what each combination turns the gate into. Pure: gh is a fake.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fieldDiff} from '../../lib/replay-field-diff.mjs';
import {entriesOf, readPrAccepts} from '../../replay-accepts.mjs';
import {judge, summary} from '../../replay-gate.mjs';

const f = (label, outcome) => ({label, outcome});
const outcome = (filled, left, fields) => ({reached: 'form', filled, left, fields});
const before = outcome(10, 5, [f('First name', 'filled'), f('CV', 'filled'), f('CV ', 'filled'), f('Dropbox', 'left')]);
const baseline = {rows: {a: {same: true, streak: 2, outcome: before}, b: {same: true, streak: 2, outcome: before}}};
const rec = (name, now) => ({name, outcome: now, live: {asks: 4}, network: {hit: 4, extra: 0, notRecorded: 0}});
const worseA = outcome(9, 4, [f('First name', 'filled'), f('CV', 'filled')]);
const pr = (labels, comments) => ({number: 755, labels: labels.map(name => ({name})), comments: comments.map(([body, authorAssociation = 'OWNER', url = 'https://x/c1']) => ({body, authorAssociation, url}))});
const gate = (records, accepting) => judge(records, baseline, [], {entries: entriesOf([accepting])});

test('the diff lists only the fields whose outcome changed, by label; no list on either side gives none', () => {
  assert.deepEqual(fieldDiff(before, worseA), [{label: 'Dropbox', before: 'left', now: 'absent'}]);
  assert.equal(fieldDiff({reached: 'form'}, worseA), null);
  assert.deepEqual(fieldDiff(before, before), []);
});

test('a worse row shows its diff and a copy-ready accept line with its numbers; never a value', () => {
  const text = summary(gate([rec('a', worseA), rec('b', before)], pr([], [])));
  assert.match(text, /### What changed in the 1 worse row/);
  assert.match(text, /\| Dropbox \| left \| absent \|/);
  assert.match(text, /Replay-accept: a — <why this drop is intended> \(form 10\/5 → form 9\/4\)/);
});

test('worse + no accept is red; + an accept naming it is green; naming another row stays red; a second worse row not named stays red', () => {
  const rows = [rec('a', worseA), rec('b', before)];
  assert.equal(gate(rows, pr(['replay-accepted'], [])).red, true, 'the label alone has no reason');
  assert.equal(gate(rows, pr([], [['Replay-accept: a — on purpose']])).red, true, 'a comment without the label');
  const ok = gate(rows, pr(['replay-accepted'], [['Replay-accept: a — a CV was counted twice']]));
  assert.deepEqual([ok.red, ok.accepted, ok.rows.a.verdict], [false, 1, 'accepted']);
  assert.match(ok.rows.a.why, /PR #755 \(https:\/\/x\/c1\): a CV was counted twice/, 'the summary says which comment accepted it');
  assert.equal(gate(rows, pr(['replay-accepted'], [['Replay-accept: b — nope']])).red, true);
  const both = [rec('a', worseA), rec('b', outcome(9, 4, []))];
  const one = gate(both, pr(['replay-accepted'], [['Replay-accept: a — yes']]));
  assert.deepEqual([one.red, one.rows.a.verdict, one.rows.b.verdict], [true, 'accepted', 'worse']);
  assert.equal(gate(both, pr(['replay-accepted'], [['Replay-accept: all moved on purpose']])).red, false, 'a bare line accepts every worse row');
});

test('an untrusted commenter is ignored', () => {
  assert.equal(gate([rec('a', worseA)], pr(['replay-accepted'], [['Replay-accept: a — hi', 'NONE']])).red, true);
});

test('the PR reader asks gh for this PR only and survives a failing gh', () => {
  const calls = [], fetcher = args => { calls.push(args.join(' ')); return JSON.stringify(pr(['replay-accepted'], [['Replay-accept: a — ok']])); };
  assert.deepEqual(readPrAccepts(755, {env: {GITHUB_REPOSITORY: 'o/r'}, fetcher}).entries, [{pr: 755, text: 'a — ok', url: 'https://x/c1'}]);
  assert.match(calls[0], /^pr view 755 -R o\/r --json number,labels,comments$/);
  assert.deepEqual(readPrAccepts(755, {env: {GITHUB_REPOSITORY: 'o/r'}, fetcher: () => { throw new Error('boom'); }}).entries, []);
  assert.deepEqual(readPrAccepts('', {env: {}, fetcher}).entries, []);
});
