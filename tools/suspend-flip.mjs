// Propose lane suspension and an owner issue from same-commit red-then-green GitHub job attempts.
// Job: report health
// Usage: node tools/suspend-flip.mjs --attempts attempts.json --owner <login> [--registry file] [--dry-run | --open] [--repo owner/repo]
// Input: {attempts: [<GitHub /actions/runs/ID/attempts/N/jobs JSON>, ...]}; include every page of each attempt's jobs.
// Why (2026-10-28, owner): a retry flip does not protect a PR; name its evidence and owner instead of retrying it green.
// Invariants: never edit the registry; no network in dry-run (the default); only --open creates issues.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {entryProblems} from './lanes-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Return suspension proposals for completed failures followed by successes on the same run, SHA and suite.
 * Attempts are GitHub jobs API responses; suites lists actual journey names, so infrastructure jobs never become checks.
 * registry is lanes.json's parsed object; any already-listed suite is left alone. owner is required, never guessed.
 */
export function suspensions({attempts, registry = {}, suites, owner, since = new Date().toISOString().slice(0, 10)}) {
  if (!owner?.trim()) throw new Error('A named --owner is required for a suspension.');
  const groups = new Map();
  for (const response of attempts) for (const job of response.jobs || []) {
    const suite = String(job.name || '').replace(/-\d+of\d+$/, '');
    if (!suites.includes(suite) || Object.hasOwn(registry.suites || {}, suite)) continue;
    if (!job.head_sha || !job.run_id || !Number.isInteger(job.run_attempt) || job.run_attempt < 1) continue;
    const key = JSON.stringify([job.run_id, job.head_sha, suite]);
    if (!groups.has(key)) groups.set(key, {suite, sha: job.head_sha, run: job.run_id, attempts: new Map()});
    const group = groups.get(key);
    if (!group.attempts.has(job.run_attempt)) group.attempts.set(job.run_attempt, new Map());
    group.attempts.get(job.run_attempt).set(job.id, job);
  }
  const out = [], seen = new Set();
  for (const group of groups.values()) {
    if (seen.has(group.suite)) continue;
    let red;
    const latest = new Map();
    for (const [number, jobs] of [...group.attempts].sort(([a], [b]) => a - b)) {
      const rows = [...jobs.values()];
      const failed = rows.some(job => job.status === 'completed' && job.conclusion === 'failure');
      // Why (2026-10-28, owner, same-suite flip): a retry of one shard cannot erase another shard's red.
      for (const job of rows) latest.set(job.name, job);
      const all = [...latest.values()], total = Math.max(1, ...all.map(job => Number(/-(\d+)of(\d+)$/.exec(job.name)?.[2] || 1)));
      const green = all.length === total && all.every(job => job.status === 'completed' && job.conclusion === 'success');
      if (failed) red = {number, job: rows.find(job => job.conclusion === 'failure')};
      if (!green || !red || number <= red.number) continue;
      // API html_url identifies the repository; attempt links keep both reruns visible even when the run id is shared.
      const url = job => String(job.html_url || '').split('/actions/runs/')[0];
      if (!url(red.job).startsWith('https://github.com/') || url(red.job) !== url(rows[0])) continue;
      const before = `${url(red.job)}/actions/runs/${group.run}/attempts/${red.number}`;
      const after = `${url(rows[0])}/actions/runs/${group.run}/attempts/${number}`;
      const why = `${group.suite} failed then passed on unchanged commit ${group.sha}: red ${before}; green ${after}. A retry flip leaves this check unable to protect a PR.`;
      const entry = {lane: 'suspended', input: 'same-commit flip', since, why, owner};
      const problems = entryProblems(entry);
      if (problems.length) throw new Error(problems.join('; '));
      const issue = {
        title: `Suspend ${group.suite}: red then green on ${group.sha.slice(0, 7)}`,
        body: `Owner: @${owner}\n\n${why}\n\nthis check does not protect you now\n\nRead the first failing step and logs in [red attempt](${before}) and compare [green attempt](${after}) on commit ${group.sha}. Fix the product or test race without loosening expectations.\n\nTo lift suspension: link the fix PR, wait for it to land, and read the next 3 main runs proving this suite passes. Then remove its lanes.json entry (design: backbone → suspended → backbone; rule E).\n\nProposed registry entry:\n\n\`\`\`json\n${JSON.stringify({[group.suite]: entry}, null, 2)}\n\`\`\``,
      };
      out.push({suite: group.suite, entry, issue});
      seen.add(group.suite);
      break;
    }
  }
  return out.sort((a, b) => a.suite < b.suite ? -1 : a.suite > b.suite ? 1 : 0);
}

function main(argv) {
  const value = flag => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  if (argv.includes('--open') && argv.includes('--dry-run')) throw new Error('Choose --open or --dry-run.');
  const input = value('--attempts');
  if (!input) throw new Error('Pass --attempts <recorded JSON file> and --owner <login>.');
  const data = JSON.parse(fs.readFileSync(input, 'utf8'));
  const registry = JSON.parse(fs.readFileSync(value('--registry') || path.join(ROOT, 'desktop/e2e/lanes.json'), 'utf8'));
  const suites = fs.readdirSync(path.join(ROOT, 'desktop/e2e/suites')).filter(name => name.endsWith('.mjs')).map(name => name.slice(0, -4));
  const found = suspensions({attempts: data.attempts || data, registry, suites, owner: value('--owner')});
  for (const {suite, entry, issue} of found) {
    console.log(`## Proposed lanes.json entry\n${JSON.stringify({[suite]: entry}, null, 2)}\n\n## Owner issue\nTitle: ${issue.title}\n\n${issue.body}\n`);
    if (argv.includes('--open')) {
      execFileSync('gh', ['issue', 'create', '--repo', value('--repo') || process.env.GITHUB_REPOSITORY || 'GarryOne/jobadabra', '--assignee', entry.owner, '--title', issue.title, '--body', issue.body], {stdio: 'inherit'});
    }
  }
  if (!found.length) console.log('No new same-commit retry flips; no suspension proposed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(`suspend-flip: ${error.message}`); process.exitCode = 1; }
}
