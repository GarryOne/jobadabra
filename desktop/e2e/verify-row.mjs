// Replays ONE planned row for "Confirmed offline" (verify-plan.mjs job; .github/workflows/fix-verdicts.yml) and writes its verdict: the recording on its own build (the control), then on
// the build to judge (main for a fix, the older build for a regression), twice. A build other than this checkout is a worktree of this one with that commit's extension/ laid over it;
// any step that fails leaves a missing replay, which the judge reads as "Needs a recording". Never a site, never a model call.
// Run: node verify-row.mjs <records dir> <job json> <out dir>. Guard: e2e/test/verify-judge.test.mjs (the verdicts), the workflow run (the replays).
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fidelityRecord} from './replay-records.mjs';
import {wholeTree} from './lib/older-tree.mjs';
import {controlWhy, judgeFixed, judgeRegression} from './lib/verify-judge.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname), ROOT = path.resolve(HERE, '..', '..');
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const json = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

// The tree of a build: this checkout for HEAD, else a worktree at that commit (its own app, extension and src) with main's e2e tools over it and the files main added since taken from main (lib/older-tree.mjs).
// Dependencies are linked from this checkout.
export function treeAt(commit, work) {
  const head = git(ROOT, 'rev-parse', 'HEAD');
  if (!commit || !commit.endsWith('^') && (head.startsWith(commit) || commit.startsWith(head))) return ROOT;
  const dir = path.join(work, `tree-${commit.replace(/[^0-9a-f]/gi, '').slice(0, 10)}${commit.endsWith('^') ? '-parent' : ''}`);
  if (fs.existsSync(dir)) return dir;
  git(ROOT, 'worktree', 'add', '--detach', dir, commit);
  const added = wholeTree(dir, commit, head);
  console.error(`verify-row: tree at ${commit.slice(0, 10)}: main's e2e tools over it, ${added.length} file(s) main added since taken from main`);
  for (const folder of ['desktop', 'desktop/e2e']) fs.symlinkSync(path.join(ROOT, folder, 'node_modules'), path.join(dir, folder, 'node_modules'), 'dir');
  return dir;
}

// One replay of a recording on a tree -> its "Replay vs live" record, or null (no result).
export function replayOn(tree, record, out) {
  fs.mkdirSync(out, {recursive: true});
  spawnSync(process.execPath, [path.join(tree, 'desktop', 'e2e', 'replay-net.mjs'), record.dir, out], {encoding: 'utf8', timeout: 6 * 60 * 1000, stdio: ['ignore', 'inherit', 'inherit']});
  const replay = json(path.join(out, 'replay.json')), meta = json(path.join(record.dir, 'record.json'));
  return replay && meta ? fidelityRecord({name: record.name || '', dir: record.dir, record: meta}, replay) : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(HERE, 'verify-row.mjs')) {
  const [records, jobFile, out] = process.argv.slice(2), job = json(jobFile);
  if (!records || !job || !out) { console.error('usage: node verify-row.mjs <records dir> <job json> <out dir>'); process.exit(2); }
  const recording = {...job.record, name: job.row, dir: path.join(records, job.record.dir)};   // the plan keeps the folder relative to the records
  const attempt = (build, label) => { try { return build ? replayOn(treeAt(build, out), recording, path.join(out, label)) : null; } catch (error) { console.error(`verify-row: ${label}: ${String(error?.message || error).split('\n')[0]}`); return null; } };
  const control = attempt(job.record.build?.commit, 'control'), runs = [];
  const target = job.kind === 'fixed' ? git(ROOT, 'rev-parse', 'HEAD') : job.older.build?.commit;
  if (!controlWhy(control)) for (const label of ['run1', 'run2']) runs.push(attempt(target, label));
  const before = job.beforeBuild && !controlWhy(control) ? attempt(job.beforeBuild, 'before') : null;   // a recording after the fix: the build just before it
  const verdict = job.kind === 'fixed' ? judgeFixed({recordedAt: job.record.at, landedAt: job.landedAt, control, runs, before}) : judgeRegression({control, runs});
  const result = {kind: job.kind, row: job.row, commit: job.commit || null, ...verdict, buildBy: job.record.build?.by || null, recordedAt: job.record.at, beforeBuild: job.beforeBuild || null, olderAt: job.older?.at || null, olderBuildBy: job.older?.build?.by || null};
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'verdict.json'), `${JSON.stringify(result, null, 1)}\n`);
  console.log(`verify-row: ${job.kind} ${job.row}: ${verdict.verdict} (${verdict.why})`);
}
