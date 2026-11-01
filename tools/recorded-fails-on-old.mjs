#!/usr/bin/env node
// Check for a branch/PR (a CI job; NOT in the push hook: the Mac's heavy lock queues, owner weighing PRs, 12 Oct 2026), owner 12 Oct 2026: a recorded case the push adds or changes must FAIL on the code before the push, or it proves nothing ("every fix lands with a case that fails on the old code").
// Only the push's own cases (tools/recorded-cases.mjs casesOf) are replayed, on a detached worktree of the merge-base (origin/main: the app's desktop/lib and the extension as they were), through the one replay path
// there is (desktop/e2e/test/record/recorded-pages.test.mjs under tools/heavy-lock.sh): page cases and row cases alike. That the case PASSES on the push is the journey gate's and CI's replay.
// A case that only pins current behaviour (no fix) says so in a commit message: "Recorded-pins: <why>" (refused with a Pool-row or an issue the commit fixes: a fix is not a pin).
//   node tools/recorded-fails-on-old.mjs [--base origin/main] [--log <file>]   exit 1 with the reason. --list: print the cases it would replay (git only, seconds; the CI job's
//   first step, so a PR that brings none installs nothing). On CI there is no lock to wait for (heavy-lock.sh is then a no-op: check). Guard: desktop/test/recorded-fails-on-old.test.js.
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NAMES_A_FAILURE, casesOf, commitFiles} from './recorded-cases.mjs';

export const PINS = /^Recorded-pins:\s*\S/m;
// A follow-up to a fix already on main (12 Oct 2026: PRs #374, #386 tightened the case of a merged fix; on the PR's base, which has the fix, it passed):
// "Fix-commit: <sha>" names that fix, and the commit's cases are replayed on the code before it (<sha>^) instead of the PR's base. A proof, so allowed with a Pool-row.
export const FIX_COMMIT = /^Fix-commit:\s*([0-9a-f]{7,40})\s*$/m;

// -> {pinned, check, refused, fixOf}: the cases a "Recorded-pins:" commit of the push covers (never one that names a failure it fixes), the rest, which must fail on the old code,
// and for a follow-up's cases the fix whose parent is their old code ({case: sha}).
export function splitPinned(commits) {
  const pinned = new Set(), check = new Set(), refused = new Set(), fixOf = {};
  for (const commit of commits) for (const name of casesOf(commit.files)) {
    const fix = commit.message.match(FIX_COMMIT)?.[1];
    if (fix) { check.add(name); fixOf[name] = fix; }
    else if (PINS.test(commit.message) && !NAMES_A_FAILURE.test(commit.message)) pinned.add(name);
    else { check.add(name); if (PINS.test(commit.message)) refused.add(name); }
  }
  for (const name of check) { pinned.delete(name); if (fixOf[name]) refused.delete(name); }
  return {pinned: [...pinned], check: [...check], refused: [...refused], fixOf};
}

// The node test runner's output for recorded-pages.test.mjs ("ok 3 - <case>: <shape>" / "not ok 3 - ..."): -> {failed, passed, missing} case names.
export function outcomes(cases, text) {
  const lines = String(text).split('\n').map(line => line.replace(/\u001b\[[0-9;]*m/g, '').trim());
  const find = name => lines.find(line => new RegExp(`^(?:(?:not )?ok \\d+ - |[✔✖] )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`).test(line));
  const failed = [], passed = [], missing = [];
  for (const name of cases) { const line = find(name); if (!line) missing.push(name); else if (/^(not ok|✖)/.test(line)) failed.push(name); else passed.push(name); }
  return {failed, passed, missing};
}

// The keys of a case's `expect` the old tree's replay never reads (12 Oct 2026, #516: a case checking only `stuck` and `ending`, new in that PR, "passed" on main's
// replay, which skipped both). sources: the old replay files' text; a key counts as read when its name appears outside a // comment. -> sorted keys.
export function unreadKeys(expect = {}, sources = []) {
  const code = sources.map(text => String(text).split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n')).join('\n');
  return Object.keys(expect || {}).filter(key => !new RegExp(`\\b${key.replace(/[^\w]/g, '')}\\b`).test(code)).sort();
}

// unread: {case: [keys main's replay cannot check]} (unreadKeys), named under a case that passed on the old code.
export function verdict({passed, missing}, unread = {}) {
  const lines = [];
  for (const name of passed) if ((unread[name] || []).length) lines.push(`${name}: main's replay cannot check: ${unread[name].join(', ')} (new in this push): add a check it knows (e.g. told, filled, empty) that fails on the old code.`);
  if (passed.length) lines.push(`the recorded case${passed.length > 1 ? 's' : ''} ${passed.join(', ')} PASS${passed.length > 1 ? '' : 'ES'} on the code before this push: ${passed.length > 1 ? 'they' : 'it'} prove${passed.length > 1 ? '' : 's'} nothing.
A case must show the failure: make it fail on origin/main's code (npm run row-to-case -- "<row>" <case> --old-commit <the fix's sha> refuses unless it does), or, for a case that only pins behaviour that already works, say so in the commit message: "Recorded-pins: <why>" (not with a Pool-row or an issue it fixes).
A follow-up to a fix already on main (it only corrects that fix's case): name the fix in the commit message, "Fix-commit: <sha>", and the case is replayed on the code before it.`);
  if (missing.length) lines.push(`the replay on the old code gave no result for ${missing.join(', ')} (it did not run: see the log above). A case with no verdict is not accepted.`);
  return lines.join('\n');
}

// A case the push REMOVED or moved (parked in recorded-pending/) has nothing left to replay (13 Oct 2026, #604: the replay copied its vanished folder, ENOENT).
// -> {kept, removed}: `exists(name)` tells whether desktop/e2e/recorded/<name> is still there at HEAD.
export function withoutRemoved(names, exists) {
  return {kept: names.filter(exists), removed: names.filter(name => !exists(name))};
}

function main() {
  const args = process.argv.slice(2), base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main', logFile = args.includes('--log') ? args[args.indexOf('--log') + 1] : '';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const git = (...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', maxBuffer: 64 << 20});
  let commits;
  try { commits = git('rev-list', '--reverse', `${base}..HEAD`).split('\n').filter(Boolean).map(sha => ({message: git('log', '-1', '--format=%B', sha), files: commitFiles(git, sha)})); } catch { return 0; }   // commitFiles: a label-only case.json edit is no case (recorded-cases.mjs LABEL_KEYS)
  const {pinned, check: named, refused, fixOf} = splitPinned(commits);
  const {kept: check, removed} = withoutRemoved(named, name => fs.existsSync(path.join(root, 'desktop/e2e/recorded', name)));
  if (removed.length) console.error(`recorded cases on the old code: removed, not replayed: ${removed.join(', ')}`);
  if (refused.length) { console.error(`"Recorded-pins:" is refused for ${refused.join(', ')}: that commit names a Pool-row or an issue it fixes, and a fix must show its failure on the old code (a follow-up to a fix on main: "Fix-commit: <sha>").`); return 1; }
  if (pinned.length) console.error(`recorded cases on the old code: ${pinned.join(', ')} said "Recorded-pins" (they pin behaviour, no fix): not replayed on the old code`);
  if (args.includes('--list')) { console.log(check.join(' ')); return 0; }
  if (!check.length) return 0;
  if (process.env.RECORDED_OLD_OK === '1') { console.error(`recorded cases on the old code: RECORDED_OLD_OK=1: ${check.join(', ')} NOT replayed on origin/main's code`); return 0; }
  const mergeBase = git('merge-base', base, 'HEAD').trim(), groups = new Map();
  for (const name of check) {
    let old = mergeBase;
    if (fixOf[name]) {
      try { git('merge-base', '--is-ancestor', fixOf[name], mergeBase); old = git('rev-parse', `${fixOf[name]}^`).trim(); }
      catch { console.error(`"Fix-commit: ${fixOf[name]}" (case ${name}) is not a commit on ${base}: name the fix that is already there.`); return 1; }
    }
    groups.set(old, [...(groups.get(old) || []), name]);
  }
  for (const [old, cases] of groups) { const code = replayOn(git, root, old, cases, logFile); if (code) return code; }
  return 0;
}

// Replays `check` on a detached worktree of `mergeBase` (the code before the push, or before the fix a follow-up names): -> 0 when each fails there, 1 with the reason.
function replayOn(git, root, mergeBase, check, logFile) {
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-old-code-')), tree = path.join(old, 'tree');
  try {
    git('worktree', 'add', '--detach', tree, mergeBase);
    for (const dir of ['desktop', 'desktop/e2e']) if (fs.existsSync(path.join(root, dir, 'node_modules'))) fs.symlinkSync(path.join(root, dir, 'node_modules'), path.join(tree, dir, 'node_modules'));
    for (const name of check) fs.cpSync(path.join(root, 'desktop/e2e/recorded', name), path.join(tree, 'desktop/e2e/recorded', name), {recursive: true});   // the push's case, over the old tree's own copy when it changed one
    console.error(`recorded cases on the old code (${mergeBase.slice(0, 8)}): replaying ${check.join(', ')}, each must FAIL there`);
    const run = spawnSync('bash', [path.join(root, 'tools/heavy-lock.sh'), 'recorded-old', process.execPath, '--test', 'test/record/recorded-pages.test.mjs'], {cwd: path.join(tree, 'desktop/e2e'), encoding: 'utf8', maxBuffer: 256 << 20,
      env: {...process.env, JP_REPLAY: '1', JP_REPLAY_CASES: check.join(','), JP_REPLAY_TABS: '1'}});
    const text = `${run.stdout || ''}\n${run.stderr || ''}`;
    if (logFile) fs.writeFileSync(logFile, text);
    const replayCode = ['page-replay.mjs', 'row-case-run.mjs', 'row-replay.mjs'].map(file => { try { return fs.readFileSync(path.join(tree, 'desktop/e2e/lib', file), 'utf8'); } catch { return ''; } });
    const unread = Object.fromEntries(check.map(name => { try { return [name, unreadKeys(JSON.parse(fs.readFileSync(path.join(root, 'desktop/e2e/recorded', name, 'case.json'), 'utf8')).expect, replayCode)]; } catch { return [name, []]; } }));
    const found = outcomes(check, text), why = verdict(found, unread);
    if (why) { console.error(`${text.split('\n').filter(line => /heavy-lock|^(not )?ok|rror/.test(line)).slice(-12).join('\n')}\n${why}`); return 1; }
    console.error(`recorded cases on the old code: ${found.failed.join(', ')} fail${found.failed.length > 1 ? '' : 's'} there, as they must`);
    return 0;
  } finally {
    try { git('worktree', 'remove', '--force', tree); } catch { /* removed with the temp folder below */ }
    fs.rmSync(old, {recursive: true, force: true});
    try { git('worktree', 'prune'); } catch { /* nothing to prune */ }
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main());
