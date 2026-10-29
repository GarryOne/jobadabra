// Measures calm e2e step samples and exercises artifact acquisition without network access.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {measure, downloadArtifacts, main} from '../../tools/e2e-step-timings.mjs';

const tool = fileURLToPath(new URL('../../tools/e2e-step-timings.mjs', import.meta.url));
const passed = (name, seconds) => ({name, status: 'passed', seconds});
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'step-timings-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  return dir;
}
function artifact(dir, run, shard, results) {
  const folder = path.join(dir, String(run), `e2e-artifacts-${shard}`);
  mkdirSync(folder, {recursive: true});
  writeFileSync(path.join(folder, 'steps.json'), JSON.stringify({results}));
}

test('drops a 3x slow shard-run, keeps the 1.5x boundary, and pools names across shards', t => {
  const dir = fixture(t);
  [10, 10, 10, 10, 15, 30].forEach((seconds, i) => {
    artifact(dir, i, 'applyflows-1of2', [passed('shared', seconds)]);
    artifact(dir, i, 'applyflows-2of2', [passed('shared', 100)]);
  });
  artifact(dir, 'other', 'apply', [passed('unrelated', 999)]);
  const result = measure(dir, 'applyflows');
  assert.deepEqual([result.runs, result.shardRuns, result.calmShardRuns, result.droppedSlowShardRuns], [6, 12, 11, 1]);
  assert.deepEqual(result.shards.map(s => [s.name, s.medianTotalSeconds, s.droppedSlowRuns]), [
    ['applyflows-1of2', 10, 1], ['applyflows-2of2', 100, 0],
  ]);
  assert.deepEqual(result.steps, [{name: 'shared', n: 11, medianSeconds: 100, p95Seconds: 100, maxSeconds: 100, capSeconds: 300}]);
});

test('uses nearest-rank p95 and an ordinary median on a known list', t => {
  const dir = fixture(t);
  for (let i = 1; i <= 20; i++) artifact(dir, i, 'applyflows', [passed('target', String(i)), passed('balance', 100 - i)]);
  const step = measure(dir, 'applyflows').steps.find(s => s.name === 'target');
  assert.deepEqual(step, {name: 'target', n: 20, medianSeconds: 10.5, p95Seconds: 19, maxSeconds: 20, capSeconds: 60});
});

test('ignores skipped or failed steps, missing seconds, and invalid durations', t => {
  const dir = fixture(t);
  for (let i = 0; i < 5; i++) artifact(dir, i, 'applyflows', [passed('valid', '2.0'),
    {name: 'skipped', status: 'skipped'}, {name: 'failed', status: 'failed', seconds: 1000},
    passed('missing'), passed('invalid', 'oops'), passed('negative', -1), passed('null', null)]);
  assert.deepEqual(measure(dir, 'applyflows').steps, [
    {name: 'valid', n: 5, medianSeconds: 2, p95Seconds: 2, maxSeconds: 2, capSeconds: 10},
  ]);
});

test('withholds the cap below five calm samples and prints n too small', t => {
  const dir = fixture(t);
  for (let i = 0; i < 4; i++) artifact(dir, i, 'applyflows', [passed('short', 5)]);
  assert.equal(measure(dir, 'applyflows').steps[0].capSeconds, null);
  const output = execFileSync(process.execPath, [tool, '--suite', 'applyflows', '--dir', dir], {encoding: 'utf8'});
  assert.match(output, /n too small/);
  assert.match(output, /median.*p95.*max.*cap/i);
  assert.match(output, /0 slow shard-runs dropped/);
});

test('rounds 3 x p95 upwards to five seconds, preserving exact multiples', t => {
  const dir = fixture(t);
  for (let i = 0; i < 5; i++) artifact(dir, i, 'applyflows', [passed('fraction', 5.1), passed('exact', 5)]);
  assert.deepEqual(measure(dir, 'applyflows').steps.map(s => [s.name, s.capSeconds]), [['exact', 15], ['fraction', 20]]);
});

test('--json emits only the structured report and --dir bypasses acquisition', t => {
  const dir = fixture(t);
  artifact(dir, 1, 'settings', [passed('open', 0)]);
  let output;
  main(['--suite', 'settings', '--dir', dir, '--json'], {
    acquire: () => assert.fail('local input must never download'), write: text => { output = text; },
  });
  const cli = execFileSync(process.execPath, [tool, '--suite', 'settings', '--dir', dir, '--json'], {encoding: 'utf8'});
  assert.deepEqual(JSON.parse(cli), JSON.parse(output));
  assert.deepEqual(JSON.parse(cli), {suite: 'settings', runs: 1, shardRuns: 1, calmShardRuns: 1, droppedSlowShardRuns: 0,
    shards: [{name: 'settings', runs: 1, calmRuns: 1, droppedSlowRuns: 0, medianTotalSeconds: 0}],
    steps: [{name: 'open', n: 1, medianSeconds: 0, p95Seconds: 0, maxSeconds: 0, capSeconds: null}]});
});

test('acquisition selects newest completed main runs with suite artifacts, not just newest runs', t => {
  const dir = fixture(t), downloaded = [];
  const gh = args => {
    if (args[0] === 'run' && args[1] === 'list') {
      assert.equal(args[args.indexOf('--workflow') + 1], 'e2e.yml');
      assert.equal(args[args.indexOf('--branch') + 1], 'main');
      assert.equal(args[args.indexOf('--status') + 1], 'completed');
      return JSON.stringify([4, 3, 2, 1].map(databaseId => ({databaseId, displayTitle: 'E2E check · on time (Worker cron)'}))
        .slice(0, Number(args[args.indexOf('--limit') + 1])));
    }
    if (args[0] === 'api') {
      if (args.some(a => a.includes('/runs/4/'))) return 'e2e-artifacts-applycv\n';
      return 'e2e-artifacts-apply-1of2\ne2e-artifacts-apply-2of2\n';
    }
    assert.deepEqual(args.slice(0, 2), ['run', 'download']);
    assert.deepEqual(args.slice(3, -2), ['--name', 'e2e-artifacts-apply-1of2', '--name', 'e2e-artifacts-apply-2of2']);
    const dest = args[args.indexOf('--dir') + 1];
    downloaded.push(args[2]);
    artifact(path.dirname(dest), path.basename(dest), 'apply-1of2', [passed('fill', 10)]);
    return '';
  };
  downloadArtifacts({suite: 'apply', runs: 2, dir}, gh);
  assert.deepEqual(downloaded, ['3', '2']);
  assert.equal(measure(dir, 'apply').runs, 2);
});

test('partial and mutant runs plus alternate stores cannot change the comparable baseline', t => {
  const dir = fixture(t), baseline = fixture(t), downloaded = [];
  const fullRuns = [10, 10, 10, 10, 15, 30].map((seconds, i) => {
    const databaseId = 90 - i;
    artifact(baseline, databaseId, 'applyflows-1of2', [passed('fill', seconds)]);
    return {databaseId, displayTitle: i % 2 ? 'E2E Mac + Linux · applyflows · main' : 'E2E check · on time (Worker cron)', seconds};
  });
  // Half the candidates are partial after-merge runs; the mutant is also newer than every full run.
  const candidates = [
    ...Array.from({length: 7}, (_, i) => ({databaseId: 107 - i, displayTitle: 'E2E after merge · abc123 · applyflows', seconds: 1})),
    {databaseId: 99, displayTitle: 'Mutant fill', seconds: 500}, ...fullRuns,
  ];
  downloadArtifacts({suite: 'applyflows', runs: 6, dir}, args => {
    if (args[0] === 'run' && args[1] === 'list') {
      assert.equal(args[args.indexOf('--json') + 1], 'databaseId,displayTitle');
      return JSON.stringify(candidates.slice(0, Number(args[args.indexOf('--limit') + 1])));
    }
    if (args[0] === 'api') return 'e2e-artifacts-applyflows-1of2\ne2e-artifacts-applyflows-1of2-standin\ne2e-artifacts-applyflows-1of2-sqlite\n';
    assert.deepEqual(args.slice(0, 2), ['run', 'download']);
    assert.deepEqual(args.slice(3, -2), ['--name', 'e2e-artifacts-applyflows-1of2']);
    downloaded.push(Number(args[2]));
    const run = candidates.find(candidate => candidate.databaseId === Number(args[2]));
    artifact(dir, run.databaseId, 'applyflows-1of2', [passed('fill', run.seconds)]);
    return '';
  });
  assert.deepEqual(downloaded, [90, 89, 88, 87, 86, 85]);
  const report = measure(dir, 'applyflows');
  assert.deepEqual(report, measure(baseline, 'applyflows'));
  assert.deepEqual([report.steps[0].p95Seconds, report.droppedSlowShardRuns, report.steps[0].capSeconds], [15, 1, 45]);
});

test('local measurement ignores standin and sqlite artifacts, including sharded keys', t => {
  const dir = fixture(t);
  artifact(dir, 1, 'applyflows', [passed('fill', 10)]);
  for (const store of ['standin', 'sqlite']) for (const key of ['applyflows', 'applyflows-1of2']) {
    artifact(dir, 2, `${key}-${store}`, [passed('fill', 999)]);
  }
  const report = measure(dir, 'applyflows');
  assert.deepEqual([report.runs, report.shardRuns, report.steps[0].p95Seconds], [1, 1, 10]);
});

test('title exclusions track main_e2e_state and reject PR runs without falling back to partial runs', t => {
  const state = readFileSync(new URL('../../tools/main_e2e_state.py', import.meta.url), 'utf8');
  const kinds = state.match(/^NOT_MAIN_CHECK = re\.compile\(r'\^\(([^)]+)\) '\)/m)[1].split('|');
  const afterMerge = state.match(/^AFTER_MERGE = '([^']+)'/m)[1];
  const source = readFileSync(tool, 'utf8');
  const excluded = source.match(/^const comparable = .*!\/\^\(([^)]+)\) /m);
  assert.ok(excluded, 'keep one comparable(title) definition with the canonical excluded run kinds');
  assert.deepEqual(excluded[1].split('|'), [...kinds, 'E2E for PR', afterMerge.split(' · ')[0]]);
  const candidates = [...kinds.map(kind => `${kind} abc123`), 'E2E for PR · applyflows · main', `${afterMerge}abc123 · applyflows`]
    .map((displayTitle, databaseId) => ({databaseId, displayTitle}));
  assert.throws(() => downloadArtifacts({suite: 'applyflows', runs: 1, dir: fixture(t)}, args => {
    assert.deepEqual(args.slice(0, 2), ['run', 'list'], 'excluded runs must never reach artifact lookup or download');
    return JSON.stringify(candidates.slice(0, Number(args[args.indexOf('--limit') + 1])));
  }), /No downloadable artifacts/);
});

test('rejects invalid arguments and missing suite data instead of printing a baseline', t => {
  const dir = fixture(t);
  for (const args of [[], ['--suite', '../apply'], ['--suite', 'apply', '--runs', '0'], ['--suite', 'apply', '--wat']]) {
    assert.throws(() => main(args, {acquire: () => assert.fail('invalid arguments must not download')}));
  }
  assert.throws(() => measure(dir, 'apply'), /No.*steps.json/);
});

test('without --dir, passes the requested run count to acquisition and cleans its temporary folder', () => {
  let downloadedTo, output;
  const report = main(['--suite', 'applyflows', '--runs', '7', '--json'], {
    acquire: ({suite, runs, dir}) => {
      assert.deepEqual([suite, runs], ['applyflows', 7]);
      downloadedTo = dir;
      artifact(dir, 42, suite, [passed('fill', 2)]);
    },
    write: text => { output = text; },
  });
  assert.equal(report.steps[0].medianSeconds, 2);
  assert.deepEqual(JSON.parse(output), report);
  assert.equal(existsSync(downloadedTo), false);
});

test('cleans temporary downloads and reports acquisition errors without printing a report', () => {
  let downloadedTo;
  assert.throws(() => main(['--suite', 'applyflows'], {
    acquire: ({dir}) => { downloadedTo = dir; throw new Error('download failed'); },
    write: () => assert.fail('failed acquisition must not print a baseline'),
  }), /download failed/);
  assert.equal(existsSync(downloadedTo), false);
});
