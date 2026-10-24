// The five loop-quality numbers: real counts, and null with a reason when there is no data (never a made-up value).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {escapeRate, guardRate, loopQuality} from '../lib/loop-quality.mjs';

const row = (caught, at = '2026-10-09') => ({properties: {'Caught by e2e': {select: {name: caught}}, 'Found on': {date: {start: at}}}});
const now = Date.parse('2026-10-11T00:00:00Z');

test('escape rate: missed of judged, late counted apart, n/a and old rows left out', () => {
  const result = escapeRate([row('Yes'), row('Yes'), row('Late (only after users or manual)'), row('No - gap'), row('n/a'), row('No - gap', '2026-07-01')], {now});
  assert.deepEqual(result, {rate: 25, missed: 1, late: 1, caught: 2, judged: 4});
});

test('every number says why when there is no data, and counts when there is', () => {
  const empty = loopQuality({});
  for (const key of ['escape', 'mutation', 'verdicts']) assert.equal(empty[key].rate, null, key);
  assert.match(empty.escape.note, /Bug Tracker/);
  const at = '2026-10-10T10:00:00Z';
  const issue = (labels, extra = {}) => ({state: 'OPEN', createdAt: at, body: '🟠 **MEDIUM** · test-failure · x', labels: labels.map(name => ({name})), comments: [], ...extra});
  const fixed = issue([], {state: 'CLOSED', stateReason: 'COMPLETED', comments: [{body: 'Fixed by https://github.com/o/r/pull/1'}]});
  const audit = {body: '- [x] 👍 right <!-- audit:i1:right -->\n- [ ] 👎 wrong <!-- audit:i1:wrong -->\n- [ ] 👍 right <!-- audit:i2:right -->\n- [x] 👎 wrong <!-- audit:i2:wrong -->'};
  const full = loopQuality({issues: [issue(['flaky']), issue([]), issue(['regression']), fixed, fixed], audits: [audit], mutation: {score: 80, killed: 4, survived: 1, unknown: 0, at},
    tracker: [row('Yes'), row('No - gap')]});
  assert.equal(full.flake.rate, 20);
  assert.equal(full.regression.rate, 50);
  assert.equal(full.verdicts.rate, 50);
  assert.equal(full.mutation.rate, 80);
  assert.equal(full.escape.rate, 50);
});

test('guard rate: a missed bug is closed only when a guard is built, not when there is only an idea', () => {
  const missed = (caught, idea, at = '2026-10-09') => ({properties: {...row(caught, at).properties, 'e2e test idea': {rich_text: [{plain_text: idea}]}}});
  const rows = [missed('No - gap', 'Built: matching matrix case'), missed('Late (only after users or manual)', 'Added: uicheck chat-text check'), missed('No - gap', 'A fixture page must yield both jobs'),
    missed('No - gap', 'a contract test (exists)'), missed('Yes', 'Built: not a miss'), missed('No - gap', 'Built: too old', '2026-07-01')];
  assert.deepEqual(guardRate(rows, {now}), {rate: 75, missed: 4, guarded: 3, ideaOnly: 1});
  assert.deepEqual(guardRate([], {now}), {rate: null, missed: 0, guarded: 0, ideaOnly: 0});
  assert.match(loopQuality({tracker: rows}).guard.note, /^3 of 4 missed bugs have a guard built; 1 still only an idea$/);
  assert.equal(loopQuality({tracker: null, trackerWhy: 'not connected'}).guard.rate, null);
});

test('a mutation run that measured nothing says so, instead of "no run yet" (18 Oct 2026: 12 of 12 unknown)', () => {
  const note = loopQuality({mutation: {score: null, killed: 0, survived: 0, unknown: 12, at: '2026-10-18T06:19:20Z', rows: [{why: 'the activity suite is not green without the mutant (none)'}]}}).mutation.note;
  assert.match(note, /last run 2026-10-18: 12 of 12 planted code bugs unknown, so nothing was measured/);
  assert.match(loopQuality({}).mutation.note, /no mutation run yet/);
});
