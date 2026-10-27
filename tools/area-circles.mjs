#!/usr/bin/env node
// Counts the PRs that already touched the product files this PR changes, so a session going in circles on one area is told before it adds another patch.
// Why (owner, 27 Oct 2026): "to avoid going in circles, with tens of PRs about a specific area of the app". Panel dim: 4 fixes in a day (0d0327b, be1c238, 16acd70, #2262).
// Usage: node tools/area-circles.mjs [base=origin/main]   prints the report; the last line is machine-readable: AREA-CIRCLES 7d=<n> 30d=<n> files=<a,b,c>
// Paste that line into the PR body: the Gitar rule (.gitar/review/root-cause.md) reads it and asks for a "Design:" block when 7d >= 2. Always exits 0 (a counter, never a gate).
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const CIRCLE_AT = 2;   // Why (owner, 27 Oct 2026): a 3rd fix on the same files within 7 days gets no patch; 2 earlier = this PR would be the 3rd
// Why (27 Oct 2026): no keyword list decides "is this a fix" (the AI-decides rule), and it would miss the very panel-dim case: those subjects say "Keep the panel steady", not "Fix".
// The tool counts every earlier PR on the files and prints the subjects; the Gitar reviewer judges which were fixes. Tests and docs are not "the area": every PR touches them.
export const NOT_AREA = /(^|\/)(tests?|docs?|e2e|fixtures)\/|\.md$|\.test\.|package-lock\.json$/;
const DAY = 86400e3;

// Commits {hash, time (ms), subject, files} -> the PRs ("#N" from the subject, else the commit hash) touching `files` within `days` of `now`, as {id, subject}.
export function priorPrs(commits, files, days, now) {
  const mine = new Set(files), seen = new Map();
  for (const commit of commits) {
    if (now - commit.time > days * DAY || !commit.files.some(file => mine.has(file))) continue;
    const pr = commit.subject.match(/\(#(\d+)\)\s*$/), id = pr ? `#${pr[1]}` : commit.hash;
    if (!seen.has(id)) seen.set(id, {id, subject: commit.subject});
  }
  return [...seen.values()];
}

// -> the report lines (empty when no earlier PR touched the area). Last line: AREA-CIRCLES 7d=<n> 30d=<n> files=<list>.
export function report(commits, changed, now) {
  const files = changed.filter(file => !NOT_AREA.test(file));
  const week = priorPrs(commits, files, 7, now), month = priorPrs(commits, files, 30, now);
  if (!month.length) return [];
  const short = list => list.slice(0, 8).map(pr => `  ${pr.id} ${pr.subject.replace(/\s*\(#\d+\)$/, '')}`);
  const lines = [`Files: ${files.slice(0, 6).join(', ')}${files.length > 6 ? `, +${files.length - 6} more` : ''}`,
    ` 7 days : ${week.length} earlier PRs`, ...short(week), `30 days : ${month.length} earlier PRs`];
  if (week.length >= CIRCLE_AT) lines.push(`circle: ${week.length} earlier PRs on these files in 7 days (if they were fixes, this PR is fix number ${week.length + 1}). Write a Design: block (states, their one owner, the verdicts that change them).`);
  lines.push(`AREA-CIRCLES 7d=${week.length} 30d=${month.length} files=${files.join(',')}`);
  return lines;
}

const git = (...args) => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 64 << 20});

// Merged history of `base` for the last 30 days: records start with \x01 so file names (one per line after --name-only) belong to their commit.
export function readCommits(base) {
  return git('log', base, '--since=30 days ago', '--name-only', '--format=%x01%h%x09%ct%x09%s').split('\x01').filter(Boolean).map(block => {
    const [head, ...files] = block.split('\n'), [hash, time, ...subject] = head.split('\t');
    return {hash, time: Number(time) * 1000, subject: subject.join('\t'), files: files.filter(Boolean)};
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] || 'origin/main';
  try {
    const files = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
    const lines = files.length ? report(readCommits(base), files, Date.now()) : [];
    if (lines.length) console.log(lines.join('\n'));
  } catch (error) { console.error(`area-circles: skipped (${String(error.message).split('\n')[0]})`); }   // never blocks a ship
}
