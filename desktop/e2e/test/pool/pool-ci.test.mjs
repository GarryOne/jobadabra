// The pool on a CI runner (.github/workflows/record-sites.yml, lib/pool-ci.mjs): hard caps on rows and AI dollars, no Electron leg (never a second visit after a
// block page), a bot wall on the runner's data-center IP shown as "blocked (CI IP)" and never a failure, and a red job only for a harness error or the tripwire.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SITE_REFUSED} from '../../lib/record-sites.mjs';
import {capRows, ciLimits, electronLegs, overBudget, stopReason, summary} from '../../lib/pool-ci.mjs';

test('the row cap runs the first rows and names the rest; no cap (a Mac run) leaves the list as it is', () => {
  const rows = ['a', 'b', 'c', 'd'].map(shape => ({shape}));
  assert.deepEqual(capRows(rows, 3), {run: rows.slice(0, 3), cut: rows.slice(3)});
  assert.deepEqual(capRows(rows, 0), {run: rows, cut: []});
});

test('the dollar cap stops the run between rows once the spend reaches it; no cap never stops it', () => {
  assert.equal(overBudget(0.49, 0.5), false);
  assert.equal(overBudget(0.5, 0.5), true);
  assert.equal(overBudget(12, 0), false);
});

test('on CI both caps must come from the workflow: a run without them is refused before any site is visited', () => {
  assert.deepEqual(ciLimits({CI: 'true', RECORD_MAX_ROWS: '3', RECORD_MAX_USD: '0.50'}), {maxRows: 3, maxUsd: 0.5});
  assert.throws(() => ciLimits({CI: 'true', RECORD_MAX_USD: '0.50'}), /RECORD_MAX_ROWS/);
  assert.throws(() => ciLimits({CI: 'true', RECORD_MAX_ROWS: '3'}), /RECORD_MAX_USD/);
  assert.throws(() => ciLimits({CI: 'true', RECORD_MAX_ROWS: '0', RECORD_MAX_USD: '0.50'}), /RECORD_MAX_ROWS/);
  assert.deepEqual(ciLimits({}), {maxRows: 0, maxUsd: 0}, 'a Mac run has no caps unless it sets them');
  assert.deepEqual(ciLimits({RECORD_MAX_ROWS: '2'}), {maxRows: 2, maxUsd: 0});
});

test('no Electron leg on CI: a refused or fallen row is never visited a second time from the runner', () => {
  assert.equal(electronLegs({CI: 'true'}), false);
  assert.equal(electronLegs({}), true);
});

const report = {day: '2026-10-12', results: {
  'Lever: single page, no account': {reached: 'form', filled: 11, left: 7, usd: 0.0312, seconds: 61},
  'SmartRecruiters: one page, no account': {reached: 'code/bot', filled: null, left: null, usd: 0.004, seconds: 30},
  'Recruitee form': {reached: 'posting', note: SITE_REFUSED, usd: 0.002, seconds: 40},
  'Personio form in German': {reached: 'form', filled: 5, left: 4, blocked: 'overlay', usd: 0.02, seconds: 55},
}, thisRun: {unfinished: [], skipped: [{shape: 'Join: form on join.com', why: 'site-ledger: join.com is not visited: 2 live visits today'}], cut: ['Teamtailor: form on teamtailor.com'], stopped: '', usd: 0.0572, maxUsd: 0.5, maxRows: 3}};

test('the summary: one table row per run row, a bot wall or a refusal is "blocked (CI IP)" and green, a form covered after the fill is its own word', () => {
  const {markdown, red} = summary(report);
  assert.deepEqual(red, []);
  assert.match(markdown, /\| Lever: single page, no account \| thin \| form \| – \| 11 \/ 7 \|  \| – \| \$0\.0312 \| 61 s \|/);
  assert.match(markdown, /\| SmartRecruiters: one page, no account \| thin \| code\/bot \| – \| – \| blocked \(CI IP\): bot check \|/);
  assert.match(markdown, /\| Recruitee form \| thin \| posting \| – \| – \| blocked \(CI IP\): site refused \|/);
  assert.match(markdown, /\| Personio form in German \| thin \| form \| – \| 5 \/ 4 \| covered after the fill \(overlay\) \|/);
  assert.match(markdown, /AI spend: \$0\.0572 of the \$0\.50 cap/);
  assert.match(markdown, /Not run: Teamtailor: form on teamtailor\.com \(row cap 3\)/);
  assert.match(markdown, /Skipped by CI's site limit: Join: form on join\.com/);
  assert.match(markdown, /not in the Mac's ledger/);
});

test('the summary is red for a row that did not finish (a harness error) and for a privacy tripwire hit, and says which', () => {
  const broken = {...report, results: {...report.results, 'Teamtailor: form on teamtailor.com': {reached: 'form', filled: 3, left: 2, tripped: true, usd: 0.01, seconds: 50}},
    thisRun: {...report.thisRun, unfinished: [{shape: 'Join: form on join.com', why: 'no end of the watch, exit 1'}], stopped: 'AI spend $0.5100 reached the cap $0.50'}};
  const {markdown, red} = summary(broken);
  assert.deepEqual(red, ['did not finish: Join: form on join.com (no end of the watch, exit 1)', 'privacy tripwire: Teamtailor: form on teamtailor.com']);
  assert.match(markdown, /Stopped early: AI spend \$0\.5100 reached the cap \$0\.50/);
  assert.match(markdown, /❌/);
});

test('a refused AI stops the run before the next row and turns the job red: a row without AI is not a result', () => {
  assert.equal(stopReason({spent: 0.1, maxUsd: 0.5, refused: null}), '');
  assert.match(stopReason({spent: 0.5, maxUsd: 0.5, refused: null}), /AI spend \$0\.5000 reached the cap \$0\.50/);
  assert.match(stopReason({spent: 0, maxUsd: 0.5, refused: {shape: 'Lever', why: '400 invalid_request_error: Your credit balance is too low'}}), /the AI was refused on Lever \(400 invalid_request_error: Your credit balance is too low\)/);
  const refused = {...report, results: {'Lever: single page, no account': {reached: 'form', filled: 5, left: 13, usd: 0, seconds: 51, aiRefused: {calls: 3, why: '400 invalid_request_error: Your credit balance is too low'}}}};
  const {markdown, red} = summary(refused);
  assert.deepEqual(red, ['AI refused: Lever: single page, no account (3 calls: 400 invalid_request_error: Your credit balance is too low)']);
  assert.match(markdown, /\| Lever: single page, no account \| thin \| form \| – \| 5 \/ 13 \| AI refused \|/);
});

test('the summary shows only the rows this run ran (the day report may hold other runs\' rows) and each row\'s last CI run; falling below it is red', () => {
  const day = {day: '2026-10-12', results: {'Lever: single page, no account': {reached: 'posting', url: 'u', usd: 0.03, seconds: 40}, 'Recruitee form': {reached: 'form', filled: 6, left: 6, url: 'r'}},
    thisRun: {ran: ['Lever: single page, no account'], unfinished: [], skipped: [], cut: [], stopped: '', usd: 0.03, maxUsd: 0.5, maxRows: 1}};
  const baseline = {'Lever: single page, no account': {reached: 'form', filled: 11, left: 7, url: 'u', run: '38237961375', branch: 'main'}};
  const {markdown, red} = summary(day, {baseline});
  assert.doesNotMatch(markdown, /Recruitee form/);
  assert.match(markdown, /\| Row \| Applicant \| Reached \| Ending \| Filled \/ left \| Blocked \| Last CI run \| AI \| Time \|/);
  assert.match(markdown, /\| Lever: single page, no account \| thin \| posting \| – \| – \|  \| form 11 \/ 7 \(run 38237961375, main\) \| \$0\.0300 \| 40 s \|/);
  assert.deepEqual(red, ['less than its last CI run: Lever: single page, no account (reached posting, form in run 38237961375 (main))']);
  assert.deepEqual(summary(day).red, [], 'no earlier CI run: nothing to fall below');
  assert.match(summary(day).markdown, /\| – \| \$0\.0300/);
});

// 12 Oct 2026: a CI recording run (#455) was green in 1 minute and ran nothing (the site limit had refused its row); the owner rightly asked whether it works at all.
const LIMIT = 'site-ledger: seitenbau-gmbh.jobs.personio.de is not visited: 2 live visits today (limit 2), the last at 11:20 by record-sites CI run 38242323673. Counted from the machine-wide ledger (/x); the owner can allow it with JOB_PILOTTO_SITE_LIMIT_OVERRIDE=seitenbau-gmbh.jobs.personio.de.';
const nothingRan = extra => ({day: '2026-10-12', results: {}, thisRun: {ran: [], unfinished: [], skipped: [], cut: [], stopped: '', usd: 0, maxUsd: 0.5, maxRows: 1, ...extra}});
test('a run where no row ran is never a pass: red, and its FIRST line says NOT RUN, why, and when the next visit is possible', () => {
  const now = new Date('2026-10-12T12:30:00Z');
  const {markdown, red, notRun} = summary(nothingRan({skipped: [{shape: 'Personio form in German', why: LIMIT}]}), {now});
  assert.equal(notRun, 'NOT RUN: Personio form in German: the site limit (seitenbau-gmbh.jobs.personio.de: 2 live visits today (limit 2), the last at 11:20 by record-sites CI run 38242323673), next visit possible after 2026-10-13 00:00 UTC');
  assert.equal(markdown.split('\n')[0], notRun);
  assert.deepEqual(red, [notRun]);
  const gone = {...nothingRan(), results: {'Join: form on join.com': {reached: 'none', url: 'u', note: 'posting gone (HTTP 404)'}}};
  assert.equal(summary(gone, {now}).notRun, 'NOT RUN: Join: form on join.com: posting gone (HTTP 404), replace its posting in desktop/e2e/smoke-sites.json');
  assert.equal(summary(nothingRan({skipped: [{shape: 'A', why: 'site-ledger: a.com is not visited: it showed a block page at 09:00 today (bot check), so it rests until tomorrow. Counted from x'}]}), {now}).notRun,
    'NOT RUN: A: the site limit (a.com: it showed a block page at 09:00 today (bot check), so it rests until tomorrow), next visit possible after 2026-10-13 00:00 UTC');
});

test('a run where a row did run is judged by its rows: a skipped neighbour is listed, never NOT RUN', () => {
  const some = {day: '2026-10-12', results: {Lever: {reached: 'form', filled: 11, left: 7, url: 'u', usd: 0.05, seconds: 80}},
    thisRun: {ran: ['Lever'], unfinished: [], skipped: [{shape: 'Personio form in German', why: LIMIT}], cut: [], stopped: '', usd: 0.05, maxUsd: 0.5, maxRows: 2}};
  const {red, notRun, markdown} = summary(some, {now: new Date('2026-10-12T12:30:00Z')});
  assert.equal(notRun, '');
  assert.deepEqual(red, []);
  assert.match(markdown, /Skipped by CI's site limit: Personio form in German/);
});

test('the summary names each row\'s applicant (grown or thin)', () => {
  const day = {day: '2026-10-12', results: {'Lever: single page, no account': {reached: 'ready', filled: 18, left: 0, url: 'u', usd: 0.06, seconds: 70, applicant: 'grown'}},
    thisRun: {ran: ['Lever: single page, no account'], unfinished: [], skipped: [], cut: [], stopped: '', usd: 0.06, maxUsd: 0.5, maxRows: 1}};
  assert.match(summary(day).markdown, /\| Lever: single page, no account \| grown \| ready \| – \| 18 \/ 0 \|/);
});

test('a run refused by the site limit says so in its NOT RUN line', () => {
  const kept = 'site-ledger: jobs.personio.example is not visited: 2 live visits today (limit 2), the last at 11:20 by record-sites CI run 9. Counted from x';
  assert.match(summary(nothingRan({skipped: [{shape: 'Personio form in German', why: kept}]}), {now: new Date('2026-10-12T12:30:00Z')}).notRun,
    /^NOT RUN: Personio form in German: the site limit \(jobs\.personio\.example: 2 live visits today \(limit 2\)/);
});

test('the summary names the Anthropic key the run used (its name, never its value): the live key when set, else the Tests key', () => {
  const report = {day: '2026-10-12', thisRun: {ran: ['A'], usd: 0.05, maxUsd: 0.5}, results: {A: {reached: 'form', filled: 3, left: 1, usd: 0.05}}};
  assert.match(summary(report).markdown, /AI spend: \$0\.0500 of the \$0\.50 cap \(key: E2E_ANTHROPIC_KEY\)\./);
  assert.match(summary(report, {keyName: 'LIVE_POOL_ANTHROPIC_KEY'}).markdown, /\(key: LIVE_POOL_ANTHROPIC_KEY\)\./);
  assert.match(summary(report, {keyName: 'LIVE_POOL_ANTHROPIC_KEY'}).markdown, /\(key: LIVE_POOL_ANTHROPIC_KEY\)\./);
  assert.match(summary(report, {keyName: 'sk-ant-api03-secret'}).markdown, /\(key: E2E_ANTHROPIC_KEY\)\./, 'anything but a known key name is never printed');
});

test('the summary shows each row\'s ending: unresolved stands out, the test\'s own hold says so', () => {
  const report = {day: '2026-10-12', thisRun: {ran: ['A', 'B', 'C']}, results: {A: {reached: 'form', filled: 3, left: 2, ending: 'unresolved'}, B: {reached: 'account', ending: 'held'}, C: {reached: 'ready', ending: 'ready'}}};
  const {markdown} = summary(report);
  assert.match(markdown, /\| A \| thin \| form \| ❌ unresolved \| 3 \/ 2 \|/);
  assert.match(markdown, /\| B \| thin \| account \| held by the test \|/);
  assert.match(markdown, /\| C \| thin \| ready \| ready \|/);
});

test('a false reading at a row\'s end (lib/live-readings.mjs) turns the run red, one line each; a row with none stays green', () => {
  const read = {...report, results: {'Lever: single page, no account': {reached: 'form', filled: 5, left: 1, usd: 0.05, seconds: 60, readings: {failures: ['ready: the panel says ready with 1 required left (Phone)'], boxes: 3}}}};
  assert.deepEqual(summary(read).red, ['false reading: Lever: single page, no account: ready: the panel says ready with 1 required left (Phone)']);
  const clean = {...report, results: {'Lever: single page, no account': {reached: 'form', filled: 5, left: 1, usd: 0.05, seconds: 60, readings: {failures: [], boxes: 3}}}};
  assert.deepEqual(summary(clean).red, []);
});
