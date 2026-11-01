#!/usr/bin/env node
// Say, for each failed step of a red e2e run, whether it is flaky (it passed on code unchanged since), changed (a likely regression) or unknown (no green to compare).
// Used by tools/red-main-gate.sh and tools/pr-verdict.py (via tools/pr_flaky.py); the Telegram alert calls the same library (desktop/e2e/ci-alert.mjs).
// Usage: node tools/flaky-verdict.mjs --run <red e2e run id> [--repo owner/repo] [--window <runs>] [--deadline <seconds>] [--json]        exit 0 always (it informs, never blocks); 2 on bad usage
// Progress goes to stderr (a first line at once, "reading N runs…" within seconds); the verdict lines go to stdout. One hang guard (--deadline, DEADLINE_S) ends the whole read: "unknown: read cut at N of M runs".
// Why (31 Oct 2026, owner: "You detect flakiness and immediately treat the flakiness root cause"): the tools say "flaky" on the red so no person has to.
// Tests: desktop/e2e/test/pool/flaky-verdict.test.mjs, desktop/e2e/test/pool/flaky-evidence.test.mjs
// Job: report health
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stepCauses} from '../desktop/e2e/ci-alert.mjs';
import {ghIo, verdictsForCauses} from '../desktop/e2e/lib/flaky-evidence.mjs';
import {sayLine} from '../desktop/e2e/lib/flaky-verdict.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEADLINE_S = 180;   // Why (1 Nov 2026): ≥3× the slowest read measured after the fix (52 s on 41269467529, 44 runs of apply); before it one read took 143 s on a 1 GB artifact and 5 others gave nothing in 150 s

/** The verdicts for a red run's failed steps: [{suite, step, verdict, green, files, compared, redSha, line}]. say(line): progress. deadlineAt: ms since epoch, the whole read ends by it. */
export async function verdictsOfRun({runId, repo, io, causes, window, say = () => {}, deadlineAt}) {
  io = io || ghIo({repo, root: ROOT, deadlineAt});
  say(`run ${runId}: reading its failed steps…`);
  const [sha, redAt] = execFileSync('gh', ['api', `repos/${repo}/actions/runs/${runId}`, '--jq', '[.head_sha, .created_at] | @tsv'], {encoding: 'utf8'}).trim().split('\t');
  const token = process.env.GH_TOKEN || execFileSync('gh', ['auth', 'token'], {encoding: 'utf8'}).trim();
  const found = causes || await stepCauses(runId, {...process.env, GH_TOKEN: token, GITHUB_REPOSITORY: repo});
  return (await verdictsForCauses(found, {redSha: sha, redRun: runId, redAt, io, say, deadlineAt, ...(window ? {window} : {})})).map(item => ({...item, line: sayLine(item)}));
}

async function main(argv) {
  const value = flag => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const runId = value('--run');
  if (!/^\d+$/.test(runId || '')) { console.error('usage: node tools/flaky-verdict.mjs --run <run id> [--repo owner/repo] [--window <runs>] [--deadline <seconds>] [--json]'); return 2; }
  const repo = value('--repo') || process.env.GITHUB_REPOSITORY || 'GarryOne/jobadabra';
  const window = Number(value('--window')) || 0;
  const deadlineAt = Date.now() + (Number(value('--deadline')) || Number(process.env.DEADLINE_S) || DEADLINE_S) * 1000;
  const out = await verdictsOfRun({runId, repo, window, deadlineAt, say: line => console.error(`flaky-verdict: ${line}`)});
  if (argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
  else for (const item of out) console.log(item.line);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(`flaky-verdict: ${error.message}`); process.exitCode = 0; });   // a failed read never blocks the caller
}
