// Main's run after a merge replays the merged PR's own AI answers: lays the PR's last green answers for one suite over main's cache.
// Why: a PR replays its own cache (PR-scoped), which main cannot read; main then asked the PR's new questions live and could get other answers
// (27 Oct 2026: #2180 green on its PR with 0 misses, main red after 8 live questions). The PR's green suite job uploads `ai-answers-<suite>` (e2e.yml).
// Usage (e2e.yml, after-merge runs): node pr-answers.mjs <merged sha> <suite key> <cache dir>. Never fails the job: no answers found is one line.
// Guards: test/pr-answers.test.mjs, tests/test_workflow_ai_cache.py.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// GitHub's PRs for a commit (/commits/{sha}/pulls) -> {number, branch} of the merged one, or null.
export function prOfCommit(pulls) {
  const merged = (Array.isArray(pulls) ? pulls : []).find(pull => pull?.merged_at && pull?.head?.ref);
  return merged ? {number: merged.number, branch: merged.head.ref} : null;
}

// The repo's artifacts -> the newest unexpired one with this name from a run on this branch, or null.
export function pickArtifact(artifacts, {branch, name}) {
  return (artifacts || []).filter(item => item.name === name && !item.expired && item.workflow_run?.head_branch === branch)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] || null;
}

// Copies each answer file (*.json) of `from` into `cache`, replacing main's answer to the same question. -> how many.
export function layOver(from, cache) {
  fs.mkdirSync(cache, {recursive: true});
  const files = fs.readdirSync(from).filter(file => file.endsWith('.json'));
  for (const file of files) fs.copyFileSync(path.join(from, file), path.join(cache, file));
  return files.length;
}

const gh = args => JSON.parse(execFileSync('gh', ['api', ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [sha, key, cache] = process.argv.slice(2), repo = process.env.GITHUB_REPOSITORY, name = `ai-answers-${key}`;
  try {
    const pr = prOfCommit(gh([`repos/${repo}/commits/${sha}/pulls`]));
    if (!pr) { console.log(`No merged PR found for ${sha}: main's own answers only`); process.exit(0); }
    // The PR branch's e2e runs, newest first; the first with this suite's answers (a repo-wide list keeps only the newest 100 of a name: busy suites push a PR's out).
    let found = null;
    for (const run of gh([`repos/${repo}/actions/workflows/e2e.yml/runs?branch=${encodeURIComponent(pr.branch)}&per_page=30`]).workflow_runs || []) {
      found = pickArtifact(gh([`repos/${repo}/actions/runs/${run.id}/artifacts?name=${name}`]).artifacts, {branch: pr.branch, name});
      if (found) break;
    }
    if (!found) { console.log(`PR #${pr.number} has no green ${key} answers (its suite did not run green on the PR): main's own answers only`); process.exit(0); }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-answers-'));
    execFileSync('gh', ['run', 'download', String(found.workflow_run.id), '-R', repo, '-n', name, '-D', dir], {stdio: ['ignore', 'ignore', 'pipe']});
    const count = layOver(dir, cache);
    console.log(`Replaying PR #${pr.number}'s own ${key} answers: ${count} from its run https://github.com/${repo}/actions/runs/${found.workflow_run.id}`);
  } catch (error) { console.log(`The merged PR's answers were not loaded (${String(error.message).split('\n')[0].slice(0, 160)}): main's own answers only`); }
}
