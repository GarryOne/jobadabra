// Many-row offline replays run in CI, not on the Mac (owner, 15 Oct 2026: "as long as they are offline replays and they don't generate AI costs, then they can move to CI ... in parallel").
// A 25-row before/after took 60+ min per side on a Mac at load ~110; site-replays.yml replays the same rows in ~14 min on 5 runners, $0 (no AI key, no site visit).
// replay-records.mjs (the published network records, which CI has) asks wideLocalRefusal() before it starts; `npm run rows` replays the Mac's own captures (not in CI) and is not refused. Guard: test/record/wide-local.test.mjs.

export const MOST_LOCAL_ROWS = 3;   // the rows a fix is about; a wider check is CI's

// -> '' (go ahead) or the refusal to print. CI (CI / GITHUB_ACTIONS set) is never refused; JP_WIDE_LOCAL=1 is the deliberate local exception.
export function wideLocalRefusal(count, env = process.env) {
  if (count <= MOST_LOCAL_ROWS || env.CI || env.GITHUB_ACTIONS || env.JP_WIDE_LOCAL === '1') return '';
  return `${count} rows: a replay of more than ${MOST_LOCAL_ROWS} rows runs in CI, in parallel (~14 min, $0): gh workflow run site-replays.yml --ref <your branch> (and --ref main for the before side).\n`
    + 'Here, replay only the rows your fix is about: JP_REPLAY_ONLY="<row>" (one per line). JP_WIDE_LOCAL=1 overrides (say why).';
}
