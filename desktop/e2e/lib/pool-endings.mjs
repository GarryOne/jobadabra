// A CI pool run's endings (the outcome contract, spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 1a): one record per row THIS run ran that has an ending word
// Job: report health
// (record-sites.mjs sets it from lib/ending.mjs: an ending, or 'held' for the test's own hold), sent in ONE PUT to /applying/endings with CI's narrow REPLAYS_PUBLISH_KEY (it writes only the
// replays, the proven records, the test-source moves and these). The site keeps main's for the Resolution tile (site/src/applying-resolution.js). Names, words, a run id, a branch
// and a sha only: never an address. CI only; JP_ENDINGS_DRY=1|true: say it, send nothing. Guard: e2e/test/pool-endings.test.mjs.
import {ENDINGS} from '../../../extension/ladder/endings.js';

export const ENDINGS_SITE = 'https://www.jobadabra.top/applying/endings';
const WORDS = new Set([...ENDINGS, 'held']);

// report: the day report (record-sites.mjs); ctx: {run, branch, sha, at}. -> [{row, ending, step, cause, run, branch, sha, at}]
export function endingRecords(report = {}, ctx = {}) {
  const ran = Array.isArray(report.thisRun?.ran) ? new Set(report.thisRun.ran) : null;
  return Object.entries(report.results || {}).filter(([row, item]) => (!ran || ran.has(row)) && WORDS.has(item?.ending))
    .map(([row, item]) => ({row, ending: item.ending, step: item.reached || '', cause: item.cause || '', run: String(ctx.run || ''), branch: String(ctx.branch || ''), sha: String(ctx.sha || ''), at: ctx.at}));
}

// -> one line for the run's output; never throws.
export async function uploadEndings(records, {env = process.env, fetcher = fetch} = {}) {
  const why = env.REAL_EXTENSION_DIR ? 'a control run on another build' : !env.CI ? 'a local run: only CI sends a run\'s endings' : !env.REPLAYS_PUBLISH_KEY ? 'REPLAYS_PUBLISH_KEY not set up' : '';
  if (why) return `endings report: not sent (${why})`;
  if (!records.length) return 'endings report: nothing to send (no row of this run has an ending)';
  if (['1', 'true'].includes(String(env.JP_ENDINGS_DRY || '').toLowerCase())) return `endings report: dry run: would send ${records.length} ending(s)`;
  try {
    const answer = await fetcher(ENDINGS_SITE, {method: 'PUT', headers: {Authorization: `Bearer ${env.REPLAYS_PUBLISH_KEY}`, 'Content-Type': 'application/json', 'X-Caller': 'endings-upload'},
      body: JSON.stringify({records}), signal: AbortSignal.timeout(20000)});
    const body = await answer.json().catch(() => ({}));
    return answer.ok ? `endings report: ${records.length} ending(s) sent (${body.stored ?? 0} new)` : `endings report: refused (${answer.status} ${body.error || ''})`;
  } catch (error) { return `endings report: not sent (${String(error?.message || error).slice(0, 80)})`; }
}
