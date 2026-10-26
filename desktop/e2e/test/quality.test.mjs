// The quality suite's checks, each shown to FAIL on a deliberately wrong input and to pass on a right one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {blockLine} from '../lib/notion.mjs';
import {HARD_JUMP, allowedMisses, judgeVerdict, stabilityVerdict, checkFacts, dirtyRows, dirtyText, fingerprints, leaks, matchRows, missingColumns, mayBeEmptyFor, normalizeUrl, rankingViolations, unstable} from '../lib/quality.mjs';

const truth = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/truth.json', import.meta.url), 'utf8'));
const sre = truth.find(item => item.id === 3001);
const goodRow = {id: 'r1', props: {Job: sre.title, Score: 90, Tier: 'A', Company: 'E2E Quality Labs', Location: 'Zurich, Switzerland', Reason: 'Kubernetes and Datadog match', 'Role fit': 90, 'Location fit': 95,
  'Compensation fit': 80, Growth: 70, Risk: 10, Confidence: 'high', 'Job URL': sre.url, Code: 'ab12', Status: 'New', Seniority: 'Senior', 'Work mode': 'Hybrid', Languages: ['English'],
  Technologies: 'Kubernetes; AWS', Salary: 'CHF 185,000 - 205,000 per year', 'Role family': 'sre'}};
const withProps = changes => ({...goodRow, props: {...goodRow.props, ...changes}});

test('the golden truth is complete: every posting has a url, a title, a description; ids are unique; the traps are there', () => {
  const ids = truth.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(truth.length >= 10 && truth.length <= 12);
  for (const item of truth.filter(item => !item.duplicateOf)) { assert.ok(item.url && item.title && item.description && item.location, item.id); assert.ok(['high', 'mid', 'low'].includes(item.fit), item.id); }
  assert.ok(truth.some(item => item.duplicateOf), 'a duplicate');
  assert.ok(truth.some(item => item.seniority === 'Junior'), 'a junior role');
  assert.ok(truth.some(item => item.english === false), 'a role that needs German');
  assert.ok(truth.some(item => item.salary === ''), 'a role without salary');
  assert.ok(truth.some(item => /customer care/i.test(item.title)), 'a misleading title');
});

test('facts: the right row has none wrong; each wrong value is caught', () => {
  assert.ok(checkFacts(sre, goodRow).every(result => result.ok), JSON.stringify(checkFacts(sre, goodRow).filter(r => !r.ok)));
  for (const [change, fact] of [[{Seniority: 'Junior'}, 'seniority'], [{'Work mode': 'Remote'}, 'work mode'], [{Location: 'Berlin'}, 'location'], [{Languages: []}, 'English is enough'],
    [{Languages: ['English', 'German +']}, 'languages that are a plus'], [{Salary: 'CHF 90,000 - 100,000'}, 'salary'], [{Salary: ''}, 'salary'], [{'Role family': 'support_it'}, 'role family']]) {
    const failed = checkFacts(sre, withProps(change)).filter(result => !result.ok).map(result => result.fact);
    assert.deepEqual(failed, [fact], JSON.stringify(change));
  }
});
test('facts: a salary invented where none is stated is caught; a null truth is not checked', () => {
  const none = truth.find(item => item.id === 3002);
  assert.ok(checkFacts(none, withProps({Salary: ''})).find(r => r.fact === 'salary').ok);
  assert.ok(!checkFacts(none, withProps({Salary: 'CHF 150,000'})).find(r => r.fact === 'salary').ok);
  const misleading = truth.find(item => item.id === 3006);
  assert.ok(!checkFacts(misleading, withProps({})).some(r => r.fact === 'seniority'));
});
test('facts: a blocker the posting states must be named in the reason or gaps', () => {
  const german = truth.find(item => item.id === 3005);
  assert.equal(german.mustMention, 'german|deutsch|language');
  const row = {id: 'g', props: {...goodRow.props, Location: german.location, Seniority: 'Senior', 'Work mode': 'Hybrid', Languages: [], Salary: '', 'Role family': 'sre'}};
  const says = (reason, gaps) => checkFacts(german, {...row, props: {...row.props, Reason: reason, Gaps: gaps}}).find(r => r.fact === 'says why (reason or gaps)').ok;
  assert.ok(says('Strong tech match; German C1 required', ''));
  assert.ok(says('Strong tech match', 'Needs fluent German (B1 only)'));
  assert.ok(!says('Strong tech match, Bern hybrid', 'No salary stated'));
  assert.ok(!says('', ''));
});
test('facts: a deliberately corrupted truth fails against the right row', () => {
  assert.ok(checkFacts({...sre, seniority: 'Junior'}, goodRow).some(result => !result.ok));
});

test('rows are matched to postings by URL, tracking parameters ignored; strays are reported', () => {
  const copy = {id: 'r2', props: {...goodRow.props, 'Job URL': `${sre.url}?utm_source=linkedin`}};
  const stray = {id: 'r3', props: {'Job URL': 'https://elsewhere.test/1'}};
  const {byId, strays} = matchRows(truth, [goodRow, copy, stray]);
  assert.equal(byId[3001].length, 2);
  assert.deepEqual(strays.map(row => row.id), ['r3']);
  assert.equal(normalizeUrl(`${sre.url}/?utm_medium=x&ref=y`), sre.url);
});

test('columns: a filled row is complete; each empty required column is named', () => {
  assert.deepEqual(missingColumns(goodRow), []);
  assert.deepEqual(missingColumns(withProps({Reason: '', Score: null, Seniority: null})).sort(), ['Reason', 'Score', 'Seniority']);
  // A column the truth says the posting does not state may be empty; any other empty column is still named.
  assert.deepEqual(missingColumns(withProps({Seniority: null, Reason: ''}), ['Seniority']), ['Reason']);
  const misleading = truth.find(item => item.id === 3006);
  assert.deepEqual(misleading.mayBeEmpty, ['Seniority', 'Technologies']);
});

test('ranking: right order passes; a low job above a high job is a violation; unscored jobs are skipped', () => {
  const high = truth.filter(item => item.fit === 'high'), low = truth.filter(item => item.fit === 'low' && !item.filterMayDrop);
  const scores = Object.fromEntries([...high.map(item => [item.id, 85]), ...low.map(item => [item.id, 30])]);
  assert.deepEqual(rankingViolations(truth, scores), []);
  assert.equal(rankingViolations(truth, {...scores, [low[0].id]: 85}).length, high.length);   // a tie is a violation too
  assert.deepEqual(rankingViolations(truth, {[high[0].id]: 85}), []);
});

test('stability: within 8 passes, 9 does not, a job scored once is ignored', () => {
  assert.deepEqual(unstable({a: 80, b: 50}, {a: 88, b: 41}), [{id: 'b', first: 50, second: 41}]);
  assert.deepEqual(unstable({a: 80}, {a: 88}), []);
  assert.deepEqual(unstable({a: 80}, {}), []);
});

test('programming accidents in text are caught, ordinary text is not', () => {
  for (const bad of ['Score: undefined', 'owner null', '[object Object]', 'NaN points', '{"score": 5}', '${title} fits']) assert.ok(dirtyText(bad).length, bad);
  for (const fine of ['Kubernetes and Datadog match', 'Salary not stated', 'Nullable types are a plus?'.replace('Nullable', 'Strong'), 'On-call one week in six']) assert.deepEqual(dirtyText(fine), [], fine);
  assert.equal(dirtyRows([goodRow]).length, 0);
  assert.deepEqual(dirtyRows([withProps({Reason: 'fits undefined'})]).map(item => item.where), [`${sre.title} / Reason`]);
});

test('leaks: a posting sentence, an email or a token in a log is found; clean logs are not; short needles are refused', () => {
  const needle = fingerprints(sre.description)[1];
  assert.equal(needle.length, 40);
  assert.deepEqual(leaks('[run] scored 12 jobs\n[sources] e2e-quality: 12 jobs', [needle, 'alex.example@example.test']), []);
  assert.deepEqual(leaks(`[enrich] text: ${needle}`, [needle, 'alex.example@example.test']), [needle]);
  assert.deepEqual(leaks('mail alex.example@example.test sent', ['alex.example@example.test']), ['alex.example@example.test']);
  assert.throws(() => leaks('anything', ['abc']), /at least 12/);
  assert.deepEqual(fingerprints('short'), []);
});

test('noise allowance: two jobs in nine may move and one text in six may slip, more is not, and a big jump never is', () => {
  assert.deepEqual([9, 8, 17, 0].map(allowedMisses), [2, 1, 3, 0]);   // owner, 26 Oct 2026: "2 of 9"
  const moved = (id, first, second) => ({id, first, second});
  assert.ok(stabilityVerdict([], 9).ok);
  assert.ok(stabilityVerdict([moved('a', 50, 60)], 9).ok);                                          // one of nine, 10 points
  assert.ok(stabilityVerdict([moved('a', 50, 60), moved('b', 40, 50)], 9).ok);                        // two of nine
  assert.ok(!stabilityVerdict([moved('a', 50, 60), moved('b', 40, 50), moved('c', 30, 40)], 9).ok);   // three of nine
  assert.ok(!stabilityVerdict([moved('a', 50, 60), moved('b', 40, 50)], 8).ok);                       // eight jobs: one allowed
  const jump = stabilityVerdict([moved('a', 50, 50 + HARD_JUMP + 1)], 9);                              // one job, but 21 points
  assert.ok(!jump.ok && /moved 21 points/.test(jump.problems[0]));
  assert.ok(judgeVerdict(['x'], 9).ok);
  assert.ok(!judgeVerdict(['x', 'y'], 9).ok);
  assert.ok(!judgeVerdict(['x'], 5).ok);                                                              // five texts: no allowance
  assert.deepEqual(judgeVerdict(['x'], 9).tolerated, ['x']);
  assert.deepEqual(judgeVerdict(['x', 'y'], 9).tolerated, []);
  // Both scorings judged: 18 texts, at most 3 invented (owner, 26 Oct 2026: "Fresh daily + rate gate"; measured: 11% of Free AI texts at temperature 0 passes 87%, 26% passes 27%)
  assert.equal(judgeVerdict([], 18).allowed, 3);
  assert.ok(judgeVerdict(['a', 'b', 'c'], 18).ok);
  assert.ok(!judgeVerdict(['a', 'b', 'c', 'd'], 18).ok);
});

test('a Notion block becomes a line: text, and table rows as their cells (the Profile is mostly tables)', () => {
  const text = value => [{plain_text: value}];
  assert.equal(blockLine({type: 'paragraph', paragraph: {rich_text: text('Target: CHF 170,000')}}), 'Target: CHF 170,000');
  assert.equal(blockLine({type: 'table_row', table_row: {cells: [text('Seniority'), text('Senior or Staff')]}}), 'Seniority | Senior or Staff');
  assert.equal(blockLine({type: 'divider', divider: {}}), '');
  assert.equal(blockLine({type: 'child_page', child_page: {title: 'Answers'}}), 'Answers');
});

test('Compensation fit may be empty only for a posting that states no salary; Growth never', () => {
  assert.deepEqual(mayBeEmptyFor({salary: []}), ['Compensation fit']);
  assert.deepEqual(mayBeEmptyFor({mayBeEmpty: ['Technologies']}), ['Technologies', 'Compensation fit']);
  assert.deepEqual(mayBeEmptyFor({salary: ['95000', '120000']}), []);
  assert.deepEqual(missingColumns(withProps({'Compensation fit': null, Growth: null}), mayBeEmptyFor({salary: []})), ['Growth']);
});
