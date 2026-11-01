// The two path guards of the pool (lib/record-sites-paths.mjs): a plain-node row that reaches less than its last result is re-run on Electron and is a regression only
// when Electron shows it too; a paired sample each pass, least recently paired first, with the report's first line saying whether the paths agree.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {guardLiveVisit} from '../../lib/site-ledger.mjs';
import {SITE_REFUSED, compare} from '../../lib/record-sites.mjs';
import {agree, electronLegRefused, visitsLeft, lastPaired, lessThanLast, pairResult, pairedLine, pairedSample, pairedSize, pathDifferenceLine, secondVisitsAllowed, settleRefusal, visitPlan} from '../../lib/record-sites-paths.mjs';

const E2E = path.resolve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..');
const URL = 'https://jobs.example.org/1';

// The class: every kind of regression compare() counts triggers the re-run, and nothing else does.
const KINDS = [
  {name: 'reached an earlier step', before: {url: URL, reached: 'form', filled: 5}, now: {url: URL, reached: 'posting', filled: null}},
  {name: 'filled fewer on the same posting', before: {url: URL, reached: 'form', filled: 5}, now: {url: URL, reached: 'form', filled: 3}},
];
test('every regression compare() counts makes the row "less than its last", and an equal or better row does not', () => {
  for (const kind of KINDS) {
    assert.equal(compare({s: kind.before}, {s: kind.now}).length, 1, `${kind.name}: compare counts it`);
    assert.ok(lessThanLast(kind.before, kind.now), `${kind.name}: no re-run`);
  }
  assert.equal(lessThanLast({url: URL, reached: 'form', filled: 5}, {url: URL, reached: 'form', filled: 5}), '');
  assert.equal(lessThanLast({url: URL, reached: 'form', filled: 5}, {url: URL, reached: 'ready', filled: 6}), '');
  assert.equal(lessThanLast(null, {url: URL, reached: 'posting'}), '', 'no last result: nothing to fall below');
});

test('a fall on plain node that Electron does not show is a path difference, not a regression; one Electron shows too stands', () => {
  const previous = {url: URL, reached: 'form', filled: 5}, node = {url: URL, reached: 'posting', filled: null};
  const differs = pairResult(node, {url: URL, reached: 'form', filled: 5}, {day: '2026-10-11', previous});
  assert.match(differs.pathDifference, /plain node posting, Electron form 5 filled \(reached posting, last time form\)/);
  assert.equal(differs.paired.agree, false);
  const both = pairResult(node, {url: URL, reached: 'posting', filled: null}, {day: '2026-10-11', previous});
  assert.equal(both.pathDifference, undefined, 'Electron shows it too: the regression stands');
  assert.match(pathDifferenceLine({Teamtailor: {...node, ...differs}}), /^PATH DIFFERENCE .*Teamtailor: plain node posting/);
  assert.equal(pathDifferenceLine({Teamtailor: {...node, ...both}}), '');
});

test('the paths agree within one field on the same step', () => {
  assert.equal(agree({reached: 'form', filled: 5}, {reached: 'form', filled: 6}), true);
  assert.equal(agree({reached: 'form', filled: 5}, {reached: 'form', filled: 7}), false);
  assert.equal(agree({reached: 'form', filled: 5}, {reached: 'posting', filled: 5}), false);
  assert.equal(agree({reached: 'form'}, null), false);
});

test('the paired sample takes the never paired first, then the oldest pairing, in the pool\'s order on a tie', () => {
  const chosen = ['A', 'B', 'C', 'D'].map(shape => ({shape}));
  const paired = lastPaired([{results: {A: {paired: {day: '2026-10-10'}}, B: {paired: {day: '2026-10-09'}}}}, {results: {A: {paired: {day: '2026-10-11'}}}}]);
  assert.deepEqual(paired, {A: '2026-10-11', B: '2026-10-09'});
  assert.deepEqual(pairedSample(chosen, paired, 2), ['C', 'D']);
  assert.deepEqual(pairedSample(chosen, paired, 3), ['C', 'D', 'B']);
  assert.deepEqual(pairedSample(chosen, {}, 0), []);
});

test('the report\'s first line says the sample agrees, or names the rows that differ', () => {
  const ok = {A: {reached: 'form', filled: 6, paired: {electron: {reached: 'form', filled: 5}, agree: true}}};
  assert.equal(pairedLine(ok), 'paired sample: 1 rows, all within +-1');
  const off = {...ok, B: {reached: 'posting', filled: null, paired: {electron: {reached: 'form', filled: 4}, agree: false}}};
  assert.equal(pairedLine(off), 'paired sample: 2 rows; DIFFER: B (plain node posting, Electron form 4 filled)');
  assert.equal(pairedLine({}), 'paired sample: none this pass');
});

test('record-sites.mjs wires both guards: the Electron re-run on a fall, the paired sample, and both lines first in the summary', () => {
  const source = fs.readFileSync(path.join(E2E, 'record-sites.mjs'), 'utf8');
  assert.match(source, /lessThanLast\(/, 'a fall on plain node is checked');
  assert.match(source, /liveRun\(posting, seconds, electronCapture, 'electron'\)/, 'the re-run is on Electron, the same posting');
  assert.match(source, /saveElectronLeg\(/, 'and what Electron saw is kept with the row\'s evidence');
  assert.match(source, /pairedSample\(/, 'a paired sample is chosen each pass');
  assert.match(source, /the run did not finish: \$\{lastError\(again\.output\)\}/, 'an Electron leg that did not finish says why');
  const first = source.indexOf('console.log(`record-sites: ${pairedLine(results)}`)'), regressionsLine = source.indexOf("REGRESSIONS:");
  assert.ok(first > 0 && first < regressionsLine, 'the paired line comes before the regressions');
});

test('a row with a path difference is no regression anywhere the pool counts one (compare: the day\'s summary and each site\'s record)', () => {
  const before = {url: URL, reached: 'form', filled: 5}, now = {url: URL, reached: 'posting', filled: null};
  assert.equal(compare({s: before}, {s: now}).length, 1);
  assert.deepEqual(compare({s: before}, {s: {...now, pathDifference: 'plain node posting, Electron form 5 filled'}}), []);
});

// A site that refuses the plain path (CDNs) is no hold when Electron, the path real users take, gets through (cc, 11 Oct 2026: Louis Vuitton, plain node refused, Electron form with 6 filled).
const REFUSED = {url: URL, reached: 'posting', filled: null, left: null, note: SITE_REFUSED, kinds: ['other', 'posting'], fieldList: []};
test('plain refused, Electron through: the row takes the Electron run\'s result and is judged as usual; the hold is gone', () => {
  const electron = {url: URL, reached: 'form', filled: 6, left: 4, rung: 2, signal: null, fieldList: [{outcome: 'filled'}], marks: null, kinds: ['form'], path: [], errors: []};
  const settled = settleRefusal(REFUSED, electron);
  assert.deepEqual([settled.reached, settled.filled, settled.left, settled.note], ['form', 6, 4, undefined]);
  assert.match(settled.pathDifference, /plain node posting.*Electron form 6 filled/);
});

test('plain refused, Electron refused too the hold stands; Electron no further without a refusal, or not finished: no hold is claimed', () => {
  assert.equal(settleRefusal(REFUSED, {...REFUSED}), null, 'both refused: nothing changes, the hold stands');
  assert.deepEqual(settleRefusal(REFUSED, {...REFUSED, note: undefined}), {note: undefined}, 'Electron stopped at the posting too but saw no refusal: a real stop, no hold');
  assert.deepEqual(settleRefusal(REFUSED, null), {note: undefined}, 'no Electron verdict: the row is not called refused');
  assert.equal(settleRefusal({...REFUSED, note: undefined}, {reached: 'form'}), null, 'a row that was not refused is never touched');
});

test('record-sites.mjs re-runs a refused row on Electron and applies the settled result', () => {
  const source = fs.readFileSync(path.join(E2E, 'record-sites.mjs'), 'utf8');
  assert.match(source, /SITE_REFUSED/, 'a refused plain run is re-run on Electron');
  assert.match(source, /settleRefusal\(/, 'and its result is settled by the Electron run');
});

// jobs.ch, 12 Oct 2026: the plain leg took the site's last visit of the day; the Electron leg then ran ~190 s of app start, was refused inside the suite,
// and the pass read "Electron reached nothing" as a path difference. Every Electron leg (fell, refused, paired) asks the ledger first and is skipped, not paired.
test('an Electron leg is asked of the site ledger first: refused when the plain leg took the last visit, never a pair', () => {
  const env = {JOB_PILOTTO_SITE_LEDGER_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ledger-')), JOB_PILOTTO_SITE_LIMIT: '2'};
  const real = process.pid;
  const visitAs = pid => { Object.defineProperty(process, 'pid', {value: pid, configurable: true}); try { guardLiveVisit(URL, {env, log: () => {}}); } finally { Object.defineProperty(process, 'pid', {value: real, configurable: true}); } };
  const guard = (url, options) => guardLiveVisit(url, {...options, env, log: () => {}});
  visitAs(91001);
  assert.equal(electronLegRefused(URL, guard), '', 'one visit left: the Electron leg goes');
  visitAs(91002);   // the plain leg took the last one
  assert.match(electronLegRefused(URL, guard), /2 live visits today \(limit 2\)/);
  assert.equal(electronLegRefused('http://127.0.0.1:5000/form', guard), '', 'a local page is no site');
  assert.throws(() => electronLegRefused(URL, () => { throw new Error('ledger unreadable'); }), /ledger unreadable/, 'only the limit skips; any other error stands');
});
test('record-sites.mjs asks the ledger before every Electron leg it starts', () => {
  const source = fs.readFileSync(path.join(E2E, 'record-sites.mjs'), 'utf8');
  const legs = [...source.matchAll(/liveRun\([^)]*'electron'\)/g)];
  assert.ok(legs.length >= 1, 'record-sites.mjs starts an Electron leg');
  for (const leg of legs) assert.match(source.slice(Math.max(0, leg.index - 1500), leg.index), /electronLegRefused\(/, 'the ledger is asked within the branch that starts the leg');
});

// The paired sample needs two visits of a site (plain node, then Electron): a row with one left would only be skipped at its Electron leg, so it is not picked.
test('the paired sample picks only rows whose site has two visits left today; a row with no known address is picked as before', () => {
  const env = {JOB_PILOTTO_SITE_LEDGER_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ledger-')), JOB_PILOTTO_SITE_LIMIT: '3'};
  const real = process.pid;
  const visitAs = (url, pid) => { Object.defineProperty(process, 'pid', {value: pid, configurable: true}); try { guardLiveVisit(url, {env, log: () => {}}); } finally { Object.defineProperty(process, 'pid', {value: real, configurable: true}); } };
  const guard = (url, options) => guardLiveVisit(url, {...options, env, log: () => {}});
  const full = 'https://full.example.org/1', tight = 'https://tight.example.org/1', open = 'https://open.example.org/1';
  for (const pid of [92001, 92002, 92003]) visitAs(full, pid);
  for (const pid of [92004, 92005]) visitAs(tight, pid);
  assert.deepEqual([full, tight, open].map(url => visitsLeft(url, guard)), [0, 1, 3]);
  assert.equal(visitsLeft('', guard), Infinity, 'no address yet (a row found by its look-alikes): not refused here');
  const chosen = [{shape: 'full', urls: [full]}, {shape: 'tight', urls: [tight]}, {shape: 'like', like: ['x']}, {shape: 'open', urls: [open]}];
  assert.deepEqual(pairedSample(chosen, {}, 2, item => visitsLeft(item.urls?.[0] || '', guard) >= 2), ['like', 'open']);
});
test('record-sites.mjs picks its paired sample by the visits left', () => {
  assert.match(fs.readFileSync(path.join(E2E, 'record-sites.mjs'), 'utf8'), /pairedSample\([^\n]*visitsLeft\(/);
});

// 15 Oct 2026: the owner approved ONE Aldi visit; the smoke added its paired Electron sample and made two. A by-hand single row visits once and says so before it starts.
test('a single-row run (--only) pairs nothing and allows no second visit unless asked; a pass over many rows keeps its paired sample', () => {
  assert.equal(pairedSize({}, 'Aldi Suisse jobs'), 0);
  assert.equal(secondVisitsAllowed({}, 'Aldi Suisse jobs'), false);
  assert.equal(pairedSize({RECORD_PAIRED: '1'}, 'Aldi Suisse jobs'), 1, 'asked for explicitly');
  assert.equal(secondVisitsAllowed({RECORD_ELECTRON_LEG: '1'}, 'x'), true);
  assert.equal(pairedSize({}, ''), 2);
  assert.equal(secondVisitsAllowed({}, ''), true);
  assert.equal(pairedSize({RECORD_PAIRED: '0'}, ''), 0);
});
test('the plan line names hosts and visits before anything starts', () => {
  const rows = [{shape: 'A', urls: ['https://jobs.one.example/a']}, {shape: 'B', urls: ['https://jobs.one.example/b']}, {shape: 'C', urls: ['https://two.example/c']}];
  assert.equal(visitPlan(rows.slice(0, 1), new Set(), false).line, 'record-sites: this run will visit 1 host(s) 1 time(s) (no second visit: a single-row run)');
  const plan = visitPlan(rows, new Set(['C']), true);
  assert.deepEqual([plan.hosts, plan.visits], [2, 4]);
  assert.match(plan.line, /^record-sites: this run will visit 2 host\(s\) 4 time\(s\)/);
});
