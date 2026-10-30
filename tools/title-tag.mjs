#!/usr/bin/env node
// Puts a PR's "[xx] " session tag back when a hand edit of the title drops it (owner, 30 Oct 2026: auto-restore). PR #2549 lost its "[ac]" to a manual `gh pr edit`.
// Design: one owner (this script), one verdict: the edit's old title had a tag and the new one has none -> the new title gets the old tag; every other edit is left alone.
// Runs on a PR title edit (workflow .github/workflows/title-tag.yml, main's copy of this script). Its retitle uses GITHUB_TOKEN, so it starts no further run: pr-gate leaves a
// dropped tag to this step (OLD_TITLE in pr-body-check.py), and this step's own check is red when the repair fails. The tag rule is pr-body-check.py's TAG (cross-checked by tests/test_title_tag.py).
// Usage: OLD_TITLE=… NEW_TITLE=… PR=<n> GH_TOKEN=… GITHUB_REPOSITORY=… node tools/title-tag.mjs. Guard: tests/test_title_tag.py.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const TAG = /^(\[[^\]]+\]) \S/;

/** The title to set after an edit from `oldTitle` to `newTitle`, or null when nothing needs restoring (the new title has a tag, or the old one had none). */
export function restoredTitle(oldTitle, newTitle) {
  const old = TAG.exec(oldTitle ?? '');
  if (!old || TAG.test(newTitle ?? '') || !(newTitle ?? '').trim()) return null;
  return `${old[1]} ${newTitle.trim()}`;
}

/** Retitles the PR through gh; `run` is the gh call (a test passes a fake). */
export function retitle(repo, pr, title, run = (...args) => execFileSync('gh', args, {encoding: 'utf8'})) {
  run('pr', 'edit', String(pr), '--title', title, '-R', repo);
}

function cli() {
  try {
    const {OLD_TITLE, NEW_TITLE, PR, GITHUB_REPOSITORY} = process.env;
    const title = restoredTitle(OLD_TITLE, NEW_TITLE);
    if (!title) return;
    retitle(GITHUB_REPOSITORY, PR, title);
    console.log(`title-tag: #${PR} "${NEW_TITLE}" -> "${title}"`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) cli();
