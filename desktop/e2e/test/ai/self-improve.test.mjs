// The loop teaches itself (5 Oct 2026): a detector that was wrong in four of its last ten outcomes is held to a judgement before it files; a test mistake that closed three times as a
// harness mistake is learned and dropped; a signature that a real fix contradicts is unlearned.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {breakerState, trippedSources} from '../../lib/breaker.mjs';
import {judgeable, pendingOf, signatureVerdict} from '../../lib/prejudge.mjs';
import {learnSignatures, matchLearned, normalizeDetail, patternOf, signaturesBody, signaturesFromBody} from '../../lib/signatures.mjs';

const issue = (number, source, resolution, createdAt = '2026-10-10T10:00:00Z', extra = {}) => ({number, state: 'CLOSED', stateReason: 'COMPLETED', createdAt, title: `[auto-ui] x: t${number}`,
  labels: [{name: 'auto-ui'}, {name: `source:${source}`}, ...(resolution ? [{name: `resolution:${resolution}`}] : [])], comments: [], body: '', ...extra});

test('a detector is under watch when it was wrong in 4 of its last 10 judged outcomes; fewer than 6 judged says nothing; other outcomes do not count', () => {
  const wrong = (n, at) => issue(n, 'layout-check', 'fp:detector', at), right = (n, at) => issue(n, 'layout-check', 'fixed', at);
  const list = [right(1, '2026-10-10T01:00:00Z'), right(2, '2026-10-10T02:00:00Z'), wrong(3, '2026-10-10T03:00:00Z'), right(4, '2026-10-10T04:00:00Z'), wrong(5, '2026-10-10T05:00:00Z'), wrong(6, '2026-10-10T06:00:00Z'), wrong(7, '2026-10-10T07:00:00Z'),
    issue(8, 'layout-check', 'stale-sighting', '2026-10-10T08:00:00Z'), issue(9, 'layout-check', 'duplicate', '2026-10-10T09:00:00Z')];
  const state = breakerState(list);
  assert.deepEqual(state['layout-check'], {judged: 7, wrong: 4, rate: 57, tripped: true});
  assert.ok(trippedSources(state).has('layout-check'));
  assert.equal(breakerState(list.slice(0, 4))['layout-check'].tripped, false, 'under 6 judged: too few');
  assert.equal(breakerState([...list, ...[10, 11, 12, 13, 14, 15, 16].map(n => right(n, `2026-10-11T0${n - 9}:00:00Z`))])['layout-check'].tripped, false, 'a recovered record: the old mistakes slide out of the window of ten');
  assert.deepEqual(breakerState([issue(1, 'ai-review', 'fp:detector', '2026-09-30T10:00:00Z')]), {}, 'before the cutoff: not counted');
});

test('a plain failed step is judged before filing; a learned mistake needs no judgement at all', () => {
  const step = detail => ({id: 'a', view: 'calendar', source: 'suite-failure', kind: 'test-failure', severity: 'medium', title: 'step failed', detail});
  assert.equal(judgeable(step('expected 3, saw 2')), true, 'judged first, the suite trusted or not (6 Oct 2026)');
  const learned = [{id: 'x1', re: patternOf('expected # saw #'), flags: 'i', why: 'learned: 3 issues'}];
  assert.match(signatureVerdict(step('expected 3, saw 2'), learned), /^harness\nWhy: learned: 3 issues/);
  assert.equal(judgeable(step('expected 3, saw 2'), {learned}), false);
  assert.deepEqual(pendingOf([step('expected 3, saw 2')]).map(item => item.id), ['a']);
});

const harnessIssue = (number, detail, resolution = 'fp:harness') => issue(number, 'suite-failure', resolution, '2026-10-10T10:00:00Z', {body: `**MEDIUM** · test-failure\n\n### What was found\n${detail}\n\n### Evidence\nx\n<!-- fingerprint: x -->`});

test('a test mistake that closed as a harness mistake three times becomes a signature; two do not; a real fix with the same text blocks it', () => {
  const text = n => `page.click: Timeout 30000ms exceeded. waiting for locator('#cal-today-${n}') element is not enabled`;
  const three = [1, 2, 3].map(n => harnessIssue(n, text(n)));
  const learnt = learnSignatures(three, [], {now: '2026-10-10'});
  assert.equal(learnt.added.length, 1);
  assert.match(learnt.added[0].why, /^learned: 3 issues closed as a test mistake \(#1, #2, #3\)/);
  assert.equal(learnSignatures(three.slice(0, 2)).added.length, 0, 'two closures are not enough');
  assert.equal(learnSignatures([...three, harnessIssue(9, text(9), 'fixed')]).added.length, 0, 'a real fix with the same text: not learned');
  const sameKey = normalizeDetail(text(1));
  assert.equal(sameKey, normalizeDetail(text(7)), 'the changing parts (a selector, a number) do not make a new key');
  // the learned signature drops the next one, and only that kind of text
  assert.ok(matchLearned({detail: text(42)}, learnt.all));
  assert.equal(matchLearned({detail: 'expected 3, saw 2'}, learnt.all), null);
  // and a real fix that later closes with the same text unlearns it
  const again = learnSignatures([...three, harnessIssue(20, text(20), 'fixed')], learnt.all);
  assert.deepEqual([again.revoked, again.all.length], [[learnt.added[0].id], 0]);
});

test('the pinned list round-trips through its issue body and ignores a broken entry', () => {
  const list = [{id: 'a1', re: 'timeout\\s+#', flags: 'i', why: 'learned: 3 issues', issues: [1, 2, 3], learned: '2026-10-10'}];
  assert.deepEqual(signaturesFromBody(signaturesBody(list)), list);
  assert.deepEqual(signaturesFromBody('nothing here'), []);
  assert.deepEqual(signaturesFromBody('```json\n[{"id":"x","re":"' + 'a'.repeat(300) + '"},{"id":"y","re":"ok"}]\n```').map(item => item.id), ['y'], 'an over-long pattern is refused');
});

test('the producer holds an unjudged finding of a detector under watch, and drops a learned mistake; it stores what it learned', async () => {
  const {triage} = await import('../../triage.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
  fs.writeFileSync(path.join(dir, 'ui-findings.json'), JSON.stringify([{view: 'jobs', severity: 'severe', kind: 'tall-row', detail: 'a row is 700px tall'}]));
  const history = [...[1, 2, 3, 4, 5, 6].map(n => issue(100 + n, 'layout-check', n < 3 ? 'fixed' : 'fp:detector', `2026-10-10T0${n}:00:00Z`)), ...[1, 2, 3].map(n => harnessIssue(200 + n, `page.click: Timeout 30000ms exceeded. element is not enabled #cal-${n}`))];
  const run = {list: history, signatures: null};
  const calls = [];
  const gh = args => {
    calls.push(args.join(' '));
    if (args[0] === 'issue' && args[1] === 'list') { const label = args[args.indexOf('--label') + 1]; return JSON.stringify(label === 'harness-signatures' ? (run.signatures ? [run.signatures] : []) : run.list); }
    return args[0] === 'pr' ? '[]' : '';
  };
  const result = triage({artifacts: dir, runUrl: 'https://x/runs/9', gh, build: ''});
  assert.equal(result.filed.length, 0, 'layout-check: 4 of 6 wrong, so nothing unjudged is filed');
  assert.deepEqual(result.watched.length, 1);
  assert.ok(result.dropped.some(item => /^held, detector under watch: 4 of its last 6/.test(item.why)));
  assert.ok(result.breaker['layout-check'].tripped);
  assert.deepEqual(result.learned.added.length, 1, 'three harness closures with one text: learned');
  assert.ok(calls.some(call => /^issue create --title 🧠 Test mistakes the Finder learned/.test(call)), 'stored in the pinned issue');
});

// ---------- CI writes Bug Tracker rows (lib/tracker-write.mjs) ----------
import {notionProperties, trackerRow, writeTrackerRow} from '../../lib/tracker-write.mjs';
import {buildReplay} from '../../lib/replay.mjs';
import {replayComment} from '../../lib/replay.mjs';

const gh = (number, title, labels, extra = {}) => ({number, url: `https://github.com/o/r/issues/${number}`, title, labels: labels.map(name => ({name})), body: '', createdAt: '2026-10-10T09:00:00Z', ...extra});

test('a planted bug no detector caught, and a bug a person reported, are bugs the loop missed; the Finder\'s own findings and the ledgers are not', () => {
  const miss = trackerRow(gh(301, '[auto-ui] recall: the detectors did not catch the planted "tiny-text"', ['auto-ui', 'kind:detector-miss', 'severity:medium']));
  assert.deepEqual([miss.foundBy, miss.caught, miss.area, miss.severity], ['e2e run', 'No - gap', 'e2e harness', 'Medium']);
  const replay = buildReplay({suite: 'interactions', env: {}, vary: {seed: 55, fixed: false}});
  const reported = trackerRow(gh(302, 'The Activity page shows the wrong time', ['bug', 'severity:high'], {body: `text\n${replayComment(replay)}`}));
  assert.deepEqual([reported.foundBy, reported.area, reported.severity], ['User report', 'Activity/Runs', 'High']);
  assert.match(reported.happened, /Replay: cd desktop\/e2e && E2E_SEED=55 node suite.mjs interactions/);
  assert.equal(trackerRow(gh(303, '[auto-ui] focus: x', ['auto-ui', 'source:ai-review'])), null, 'the Finder found it itself');
  for (const ledger of ['noise-register', 'top-issues', 'ai-budget', 'verdict-audit', 'harness-signatures']) assert.equal(trackerRow(gh(304, 'ledger', [ledger])), null, ledger);
  const props = notionProperties(miss);
  assert.deepEqual([props.Bug.title[0].text.content.slice(0, 12), props['Caught by e2e'].select.name, props.Status.select.name, props['GitHub issue'].url, props['Found on'].date.start], ['the detector', 'No - gap', 'Open', 'https://github.com/o/r/issues/301', '2026-10-10']);
});

test('a row is written once per GitHub issue; without a write token, a refusal or a network error nothing is lost but the row', async () => {
  const row = trackerRow(gh(305, 'The calendar shows the wrong day', ['bug']));
  const calls = [];
  const fetchWith = (existing, ok = true) => async (url, init) => { calls.push(url.replace('https://api.notion.com/v1/', '')); const query = /query$/.test(url); return {ok, status: ok ? 200 : 403, json: async () => (query ? {results: existing ? [{id: 'p1'}] : []} : {id: 'new-page'})}; };
  assert.deepEqual(await writeTrackerRow({token: 't', db: 'db', row, fetchImpl: fetchWith(false)}), {status: 'created', id: 'new-page'});
  assert.deepEqual(calls, ['databases/db/query', 'pages']);
  calls.length = 0;
  assert.deepEqual(await writeTrackerRow({token: 't', db: 'db', row, fetchImpl: fetchWith(true)}), {status: 'exists'});
  assert.deepEqual(calls, ['databases/db/query'], 'looked up by its GitHub URL, never created twice');
  assert.equal((await writeTrackerRow({token: '', db: 'db', row, fetchImpl: fetchWith(false)})).status, 'skipped');
  assert.equal((await writeTrackerRow({token: 't', db: 'db', row: null})).status, 'skipped');
  assert.equal((await writeTrackerRow({token: 't', db: 'db', row, fetchImpl: fetchWith(false, false)})).status, 'error');
  assert.equal((await writeTrackerRow({token: 't', db: 'db', row, fetchImpl: async () => { throw new Error('offline'); }})).status, 'error');
});

test('the producer hands a filed detector-miss to the tracker; an ordinary finding is not', async () => {
  const {triage} = await import('../../triage.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miss-'));
  fs.writeFileSync(path.join(dir, 'ui-findings.json'), JSON.stringify([{view: 'recall', severity: 'severe', kind: 'detector-miss', detail: 'the planted "tiny-text" was not caught'}, {view: 'jobs', severity: 'severe', kind: 'tall-row', detail: 'a row is 700px tall'}]));
  const made = [];
  const fakeGh = args => {
    if (args[0] === 'issue' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'create') { made.push(args[3]); return `https://github.com/o/r/issues/${400 + made.length}\n`; }
    return args[0] === 'pr' ? '[]' : '';
  };
  const result = triage({artifacts: dir, runUrl: 'https://x/runs/5', gh: fakeGh, repo: 'o/r'});
  assert.deepEqual((result.trackerRows || []).map(item => item.labels.includes('kind:detector-miss')), [true]);
  assert.equal(trackerRow(result.trackerRows[0]).foundBy, 'e2e run');
});
