// Measures calm e2e step samples and exercises artifact acquisition without network access.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
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
      return JSON.stringify([{databaseId: 4}, {databaseId: 3}, {databaseId: 2}, {databaseId: 1}].slice(0, Number(args[args.indexOf('--limit') + 1])));
    }
    if (args[0] === 'api') {
      if (args.some(a => a.includes('/runs/4/'))) return 'e2e-artifacts-applycv\n';
      return 'e2e-artifacts-apply-1of2\ne2e-artifacts-apply-2of2\n';
    }
    assert.deepEqual(args.slice(0, 2), ['run', 'download']);
    assert.equal(args[args.indexOf('--pattern') + 1], 'e2e-artifacts-apply*');
    const dest = args[args.indexOf('--dir') + 1];
    downloaded.push(args[2]);
    artifact(path.dirname(dest), path.basename(dest), 'apply-1of2', [passed('fill', 10)]);
    return '';
  };
  downloadArtifacts({suite: 'apply', runs: 2, dir}, gh);
  assert.deepEqual(downloaded, ['3', '2']);
  assert.equal(measure(dir, 'apply').runs, 2);
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
