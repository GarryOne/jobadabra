// Layer 2 of the applying tests (owner, 10 Oct 2026): every recorded page case (e2e/recorded/*) replayed in headless Chromium with the real extension and the
// recorded AI answers, offline (lib/page-replay.mjs). One step per case, so a failure names the case. No app window, no Notion, no AI, no network: a few minutes in CI.
// Runs with every e2e suite (the release and beta gates, schedules, a gate by hand) and on a push that touches extension/ or e2e/recorded/ (lib/plan.mjs).
// Guarded by test/recorded-pages.test.mjs (the same replay locally: npm run recorded).
// Job: pick the suites
import {loadCases, runCase} from '../lib/page-replay.mjs';
import {parseShard, shardOf} from '../lib/replay-shard.mjs';

export const name = 'recorded';
export const minutes = 28;   // the CI job's limit: setup + the 11-minute budget, and the same again for the "once more" run after a red one. 63 cases took 5-6 min in CI, 75 over 8 on Windows (12 Oct 2026)
// The gates run it as slices (lib/suite-shards.mjs; JP_REPLAY_SHARD=i/n, the same cut as page-cases.yml): 95 steps in one job ran out of the 11 minutes at 46 on Windows
// (beta run 38376802269, 13 Oct 2026). Raise `shards`, never the budget, when test/suite-shards.test.mjs says a slice is too full.
// Why (31 Oct 2026, a8; owner's pick of a 70% headroom, beta 41229992832): the 149 cases' measured seconds (fixtures/slice-ci-seconds.json) add to 2350 s, 470 s a slice over five, which is 71% of the 660 s
// a part has; re-weighing cannot help (the five parts were already within 10 s of each other), so six slices of ~393 s (60%) (test/part-headroom.test.mjs).
export const shards = 6;
export const secondsPerCaseOnWindows = 15;   // 46 cases in the 11 minutes of that run
export const budgetMinutes = 11;   // the suite's own step budget (lib/runner.mjs budgetMsOf); the default 7 min cut 24 of 75 cases on Windows
export const light = true;
export const needsChromium = true;   // CI installs Chromium for it (.github/workflows/e2e.yml)
export const keepGoing = true;

const slice = parseShard(process.env.JP_REPLAY_SHARD || '');   // a gate job: one slice; a run by hand: every case
const cases = slice ? shardOf(loadCases(), slice.index, slice.count) : loadCases();
export const STEPS = cases.map(item => `${item.name}: ${item.shape}`);

export async function run(ctx) {
  await ctx.run('there are recorded cases to replay', async () => { if (!cases.length) throw new Error('desktop/e2e/recorded/ holds no case'); });
  for (const item of cases) {
    await ctx.run(`${item.name}: ${item.shape}`, async () => {
      const result = await runCase(item, {extensionDir: process.env.REAL_EXTENSION_DIR || undefined});
      if (!result.ok) throw new Error(`${item.name} (${item.why || ''}): ${result.failures.join('; ')}`);
    });
  }
}
