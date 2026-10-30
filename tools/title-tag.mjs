#!/usr/bin/env node
// Puts a PR's "[xx] " session tag back when a hand edit of the title drops it (owner, 30 Oct 2026: auto-restore). PR #2549 lost its "[ac]" to a manual `gh pr edit`.
// Design: one verdict: the edit's old title had a tag and the new one has none -> the new title gets the old tag; every other edit is left alone.
// Called by the "PR description laid out" step of .github/workflows/pr-gate.yml, which is the one owner of the title verdict: it repairs, then judges the title this prints,
// all in one run (a separate workflow's repair, made with GITHUB_TOKEN, starts no new gate run and its own check never reaches "All checks passed": Gitar on #2577).
// Usage: OLD_TITLE=… NEW_TITLE=… PR=<n> GH_TOKEN=… GITHUB_REPOSITORY=… node tools/title-tag.mjs  -> prints the title to judge. A failed repair exits 1 (the step is red).
// The tag rule is pr-body-check.py's TAG (tests/test_title_tag.py replays the cases through both). Cases: tests/title_tag_cases.mjs.
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
  const {OLD_TITLE, NEW_TITLE = '', PR, GITHUB_REPOSITORY} = process.env;
  try {
    const title = restoredTitle(OLD_TITLE, NEW_TITLE);
    if (title) { retitle(GITHUB_REPOSITORY, PR, title); console.error(`title-tag: #${PR} "${NEW_TITLE}" -> "${title}"`); }
    console.log(title ?? NEW_TITLE);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) cli();
