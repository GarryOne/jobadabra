// The flaky read of a gate/night red (mac-07, 1 Nov 2026: apply-3of3 red 4 times; "Unknown" for every step on 2 runs, silence for 150 s on 5): per-leg red stores from the cause's job,
// runs taken around the red's time, a progress line and one hang guard, and a 1 GB view artifact read by ranges. Every read is injected; nothing reaches GitHub.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {ghIo, mayHoldSuite, verdictsFor, verdictsForCauses} from '../lib/flaky-evidence.mjs';
import {sayLine} from '../lib/flaky-verdict.mjs';

const STEP = 'Full automation presses Submit once on its own, and a Stop in the wait presses nothing';
const RED = '5b63233', GREEN = 'a1b42a2', RED_AT = '2026-11-01T03:30:39Z';
const SQLITE = 'e2e-view-apply-3of3', STAND = 'e2e-view-apply-3of3-standin';
const table = (...passed) => ({results: passed.map(name => ({name, status: 'passed'}))});
const base = (over = {}) => ({
  runs: async () => [
    {id: 100, sha: GREEN, at: '2026-11-01T02:55:00Z', title: 'E2E after merge · a1b42a2 · apply,applyflows,settings', url: 'https://x/100'},
    {id: 900, sha: RED, at: RED_AT, title: 'Night burn-in 4/5 · main', url: 'https://x/900'}],
  viewNames: async id => (id === 100 ? [SQLITE] : [SQLITE, STAND]),
  stepsOf: async (id, name) => (id === 100 && name === SQLITE ? table(STEP) : null),
  changedNames: async () => [],   // no file changed between the green and the red
  readAt: () => null, coverageMap: async () => ({suites: {apply: {steps: {[STEP]: {'desktop/lib/apply-run.js': {lines: []}}}}}}),
  // the real artifact listing of the night run: the sqlite leg keeps the key, the stand-in leg adds -standin; the green is an after-merge run with a coverage artifact
  storesOf: async id => (id === 100 ? {[SQLITE]: 'sqlite'} : {[SQLITE]: 'sqlite', [STAND]: 'standin'}),
  ...over,
});
const cause = (job, step = STEP) => ({suite: 'apply', step, message: 'the owned extension poll did not acknowledge completion', job});

test('a night red on both legs is judged per leg: a sqlite green on unchanged code makes it flaky, not "unknown for everything" (41269467529)', async () => {
  const [both] = await verdictsForCauses([cause('apply-3of3'), cause('apply-3of3-standin')], {redSha: RED, redRun: 900, redAt: RED_AT, io: base()});
  assert.equal(both.verdict, 'flaky', 'failed on sqlite and stand-in: the sqlite green is the same input as its sqlite red');
  assert.equal(both.green.sha, GREEN);
  const [standOnly] = await verdictsForCauses([cause('apply-3of3-standin')], {redSha: RED, redRun: 900, redAt: RED_AT, io: base()});
  assert.equal(standOnly.verdict, 'unknown', 'failed on the stand-in leg only: a sqlite green is another input');
  assert.equal(standOnly.otherStore, 1);
  assert.match(sayLine(standOnly), /^Unknown: .* \(no green in 1 runs since 2026-11-01 02:55 UTC\)/);
});

test('a leg whose store cannot be told is unknown with that reason, and the window is never walked for it', async () => {
  let walked = 0;
  const io = base({storesOf: async () => ({[SQLITE]: null, [STAND]: 'standin'}), viewNames: async () => { walked++; return [SQLITE]; }});
  const [step] = await verdictsForCauses([cause('apply-3of3')], {redSha: RED, redRun: 900, redAt: RED_AT, io});
  assert.equal(step.verdict, 'unknown');
  assert.match(step.reason, /store cannot be told/);
  assert.equal(walked, 0);
  const [nameless] = await verdictsForCauses([cause('some-other-job')], {redSha: RED, redRun: 900, redAt: RED_AT, io: base()});
  assert.equal(nameless.verdict, 'unknown', 'a job with no view artifact of that name has no known store');
});

test('the runs are asked for around the red\'s time, and a progress line is said before the first run is opened', async () => {
  const asked = [], said = [];
  await verdictsFor({suite: 'apply', steps: [STEP], redSha: RED, redRun: 900, redAt: RED_AT, redJobs: {[STEP]: ['apply-3of3']}, say: line => said.push(line),
    io: base({runs: async (limit, options) => { asked.push([limit, options]); return base().runs(); }, viewNames: async () => { said.push('(a run opened)'); return []; }})});
  assert.deepEqual(asked, [[100, {redAt: RED_AT}]]);
  assert.match(said[0], /^reading 1 runs of apply around 2026-11-01T03:30:39Z/);
  assert.equal(said[1], '(a run opened)');
});

test('the hang guard: at the deadline the read says "unknown: read cut at N of M runs", for steps still undecided, never "flaky"', async () => {
  const runs = Array.from({length: 5}, (_, i) => ({id: i + 1, sha: `c${i}`, at: `2026-11-01T03:${10 + i}:00Z`, title: 'E2E after merge · apply', url: `https://x/${i}`}));
  let now = 1000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const said = [];
    const [step] = await verdictsFor({suite: 'apply', steps: [STEP], redSha: RED, redRun: 900, redAt: RED_AT, redJobs: {[STEP]: ['apply-3of3']}, deadlineAt: 1500, say: line => said.push(line),
      io: base({runs: async () => runs, viewNames: async () => [SQLITE], stepsOf: async () => { now += 200; return table(); }})});   // each read costs 200 ms of the 500 ms guard
    assert.equal(step.verdict, 'unknown');
    assert.match(step.reason, /^read cut at 1 of 5 runs$/, 'the 5 runs were read at once (look-ahead): their 1000 ms had passed before the second was applied');
    assert.ok(said.includes('unknown: read cut at 1 of 5 runs'));
    assert.match(sayLine(step), /\(read cut at 1 of 5 runs\)/);
  } finally { Date.now = realNow; }
});

test('a verdict found before the guard stands: the cut only touches the steps still undecided', async () => {
  let now = 1000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const other = 'another step';
    const [done, left] = await verdictsFor({suite: 'apply', steps: [STEP, other], redSha: RED, redRun: 900, redAt: RED_AT, deadlineAt: 1300,
      redJobs: {[STEP]: ['apply-3of3'], [other]: ['apply-3of3']},
      io: base({runs: async () => [{id: 100, sha: GREEN, at: '2026-11-01T02:55:00Z', title: 't', url: 'u'}, {id: 101, sha: 'c1', at: '2026-11-01T02:50:00Z', title: 't', url: 'u'}],
        viewNames: async () => [SQLITE], stepsOf: async () => { now += 400; return table(STEP); }, storesOf: async () => ({[SQLITE]: 'sqlite'})})});
    assert.equal(done.verdict, 'flaky');
    assert.equal(left.verdict, 'unknown');
    assert.match(left.reason, /read cut at 1 of 2 runs/);
  } finally { Date.now = realNow; }
});

// --- the real reads over a fake gh -------------------------------------------------------------------------------------------------------------------------------
const fakeGh = (answers, calls = []) => (args, options = {}) => {
  calls.push({args, options});
  const joined = args.join(' ');
  for (const [pattern, answer] of answers) if (pattern.test(joined)) return typeof answer === 'function' ? answer(args) : answer;
  throw new Error(`unexpected gh ${joined}`);
};

test('runs(): the newest at or before the red, plus the 6 h after it, each in its own created= range', async () => {
  const calls = [];
  const page = id => JSON.stringify([{id, sha: 's', at: 'x', title: 't', url: 'u'}]);
  const io = ghIo({repo: 'o/r', run: fakeGh([[/created=%3C%3D2026-11-01T03%3A30%3A39Z/, page(1)], [/created=2026-11-01T03%3A30%3A39Z\.\.2026-11-01T09%3A30%3A39Z/, page(2)]], calls)});
  assert.deepEqual((await io.runs(100, {redAt: RED_AT})).map(item => item.id), [1, 2]);
  assert.equal(calls.length, 2);
  const none = ghIo({repo: 'o/r', run: fakeGh([[/runs\?status=completed&per_page=100 --jq/, page(7)]])});
  assert.deepEqual((await none.runs(100)).map(item => item.id), [7], 'without a red time: the newest runs, as before');
});

test('storesOf(): an unsuffixed key beside its own -standin sibling is the sqlite leg of a gate/night run, with no coverage artifact needed', async () => {
  const listing = ['1\t3240\te2e-view-apply-1of3', '2\t3790\te2e-view-apply-1of3-standin', '3\t3000\te2e-view-apply-2of3', '4\t3000\te2e-view-settings'].join('\n');
  const io = ghIo({repo: 'o/r', run: fakeGh([[/artifacts\?per_page=100/, listing]])});
  assert.deepEqual(await io.storesOf(9, 'apply'), {'e2e-view-apply-1of3': 'sqlite', 'e2e-view-apply-1of3-standin': 'standin', 'e2e-view-apply-2of3': null}, 'a key with no sibling and no coverage is still unknown');
});

test('stepsOf(): a 1 GB view artifact is read by ranges and never downloaded; a failed range read of a big one is unreadable, of a small one falls back to the download', async () => {
  const listing = ['11\t1045025600\te2e-view-apply-3of3', '12\t3240\te2e-view-apply-1of3'].join('\n');
  const calls = [];
  const steps = {v: 1, suite: 'apply', results: [{name: STEP, status: 'failed'}], traces: []};
  const download = args => { const dir = args[args.indexOf('-D') + 1]; fs.writeFileSync(path.join(dir, 'steps.json'), JSON.stringify(steps)); return ''; };
  const run = fakeGh([[/artifacts\?per_page=100/, listing], [/auth token/, 'token\n'], [/run download/, download]], calls);
  const asked = [];
  const zipSource = async ({id, size}) => { asked.push([id, size]); return {length: size, range: async () => { throw new Error('range refused'); }}; };
  const refused = ghIo({repo: 'o/r', run, zipSource});
  await assert.rejects(refused.stepsOf(9, 'e2e-view-apply-3of3'), /read by ranges only/);
  assert.ok(!calls.some(call => call.args[0] === 'run'), 'the 1 GB artifact was not downloaded');
  assert.deepEqual((await refused.stepsOf(9, 'e2e-view-apply-1of3')).results[0].name, STEP, 'a 3 KB artifact falls back to the plain download');
  assert.deepEqual(asked, [['11', 1045025600], ['12', 3240]]);
});

// e2e.yml's run-name states the suites of a main after-merge run and of a PR run; of the 100 runs round the red of 1 Nov 03:30, most were "settings" only and each cost an API call to learn it.
test('a run whose title names its suites without this one is not opened; any other title is', async () => {
  assert.equal(mayHoldSuite('E2E after merge · 5b63233 · linkedin,settings', 'apply'), false);
  assert.equal(mayHoldSuite('E2E for PR · settings · c27-admin-integrations', 'apply'), false);
  assert.equal(mayHoldSuite('E2E for PR · settings,apply,applyflows,visitsauto · c27-int-gap-wizard', 'apply'), true);
  assert.equal(mayHoldSuite('E2E for PR · settings,applyflows · x', 'apply'), false, 'applyflows is another suite');
  assert.equal(mayHoldSuite('E2E after merge · a1b42a2 · apply,applyflows,settings', 'apply'), true);
  for (const title of ['Night burn-in 4/5 · main', 'E2E check · on time (Worker cron)', 'Beta E2E tests v1.2', 'E2E Mac + Linux · all suites · main', '', undefined]) assert.equal(mayHoldSuite(title, 'apply'), true, `${title}: runs that do not say are opened`);
  const opened = [];
  const runs = [{id: 1, sha: 'a', at: '2026-11-01T03:29:00Z', title: 'E2E for PR · settings · x', url: 'u'}, {id: 2, sha: 'b', at: '2026-11-01T03:28:00Z', title: 'Night burn-in 3/5 · main', url: 'u'}];
  await verdictsFor({suite: 'apply', steps: [STEP], redSha: RED, redRun: 900, redAt: RED_AT, redJobs: {[STEP]: ['apply-3of3']}, io: base({runs: async () => runs, viewNames: async id => { opened.push(id); return []; }})});
  assert.deepEqual([...new Set(opened)], [2], 'the settings-only run was never listed, not even ahead');
});

test('a green\'s store is read for the one artifact where the step passed, not for every shard of the suite (each unsuffixed key costs a coverage download)', async () => {
  const asked = [];
  const io = base({viewNames: async () => [SQLITE, 'e2e-view-apply-1of3', 'e2e-view-apply-2of3'], storesOf: async (id, suite, only) => { asked.push([id, only]); return {[SQLITE]: 'sqlite'}; }});
  const [step] = await verdictsFor({suite: 'apply', steps: [STEP], redSha: RED, redRun: 900, redAt: RED_AT, redJobs: {[STEP]: ['apply-3of3']}, io});
  assert.equal(step.verdict, 'flaky');
  assert.deepEqual(asked, [[900, undefined], [100, [SQLITE]]]);
});

test('a run that cannot be read is said and skipped; a call the guard ended is the cut, not an error', async () => {
  const said = [];
  const runs = [{id: 100, sha: GREEN, at: '2026-11-01T02:55:00Z', title: 't', url: 'u'}, {id: 101, sha: 'c1', at: '2026-11-01T02:50:00Z', title: 't', url: 'u'}];
  const [skipped] = await verdictsFor({suite: 'apply', steps: [STEP], redSha: RED, redRun: 900, redAt: RED_AT, redJobs: {[STEP]: ['apply-3of3']}, say: line => said.push(line),
    io: base({runs: async () => runs, viewNames: async id => { if (id === 100) throw new Error('HTTP 502'); return [SQLITE]; }, stepsOf: async () => table(STEP)})});
  assert.equal(skipped.verdict, 'flaky', 'the second run still decided');
  assert.ok(said.some(line => /run 100 could not be read: HTTP 502/.test(line)));
  let now = 1000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const [cut] = await verdictsFor({suite: 'apply', steps: [STEP], redSha: RED, redRun: 900, redAt: RED_AT, redJobs: {[STEP]: ['apply-3of3']}, deadlineAt: 1200,
      io: base({runs: async () => runs, viewNames: async id => { if (id === 100) { now = 2000; throw new Error('spawnSync gh ETIMEDOUT'); } return [SQLITE]; }})});
    assert.equal(cut.verdict, 'unknown');
    assert.match(cut.reason, /^read cut at 0 of 2 runs$/);
  } finally { Date.now = realNow; }
});
