// The shared pool end to end (7 Oct 2026): what an install sends to the central scout and what it does with the central list, through the real engine
// code against a local stand-in of the website (tools/pool_e2e.py): Find new employers sends each find and dead end at once, Search for jobs every feed
// and board it read, only what changed, nothing when switched off, never the search's own words; a photographer's crawl leaves out software firms and
// feeds where no photographer found a job; employers and job sources ranked for people like them; the list checked hourly by its publish time.
// No app window, no Notion, no AI: about ten seconds. Each check is its own step.
import {execFile} from 'node:child_process';
import path from 'node:path';
import {python, pythonEnv} from '../lib/python.mjs';

export const name = 'pool';
export const minutes = 2;
// No schedule, push or release gate runs it: the e2e audit dropped it (no catch in 30 days; owner's yes, 26 Oct 2026). Run it by name (cadence 'manual', lib/plan.mjs).
export const cadence = 'manual';
export const light = true;
export const keepGoing = true;

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
export const STEPS = [
  'Find new employers sends each verified employer and each dead end at once, with fixed labels only',
  'Search for jobs sends every feed it read (also with no match) and each board by fixed id, with counts only',
  'A second check sends only what changed',
  'With "Help the pool grow" off, nothing is sent',
  'The central list: software left out; a feed quiet for photographers named in shadow mode, left out after it, never when the user matched it; employers for you ranked',
  'A job source suggestion says what it gave people like you (by the most specific label)',
  'The central list is checked about hourly, by its publish time, and kept on 304',
];

export async function run(ctx) {
  let checks = null;
  await ctx.run('the engine runs the pool against a stand-in website, and the stand-in saw it', async () => {
    const report = await new Promise(resolve => execFile(python(), [path.join(repo, 'tools', 'pool_e2e.py')], {cwd: repo, timeout: 90 * 1000, maxBuffer: 4 << 20, env: pythonEnv()},
      (error, stdout, stderr) => resolve({out: String(stdout), err: String(stderr)})));
    const last = report.out.trim().split('\n').pop() || '';
    try { checks = JSON.parse(last).checks; } catch { throw new Error(`no result from tools/pool_e2e.py: ${(report.err || report.out).trim().split('\n').slice(-3).join(' | ')}`); }
    if (checks.length !== STEPS.length) throw new Error(`${checks.length} checks ran, ${STEPS.length} expected`);
  });
  for (const step of STEPS) {
    await ctx.run(step, async () => {
      const result = checks?.find(check => check.name === step);
      if (!result) throw new Error('this check did not run');
      if (!result.ok) throw new Error(result.detail);
      if (result.detail) console.log(`    ${result.detail}`);
    });
  }
}
