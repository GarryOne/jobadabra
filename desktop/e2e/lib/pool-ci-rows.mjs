// A CI recording run's rows for the pool table on /admin/form-filling/lab (owner, 14 Oct 2026: the CI workflow's one job is recording, so its rows must move the page): one PUT to
// /applying/ci-rows with CI's narrow REPLAYS_PUBLISH_KEY, a run on main only (the site refuses any other branch: site/src/applying-ci-rows.js). The Mac's own upload (lib/applying-report.mjs)
// still refuses CI. Same row fields as record-sites.mjs sends from a Mac. JP_CI_ROWS_DRY=1|true: say it, send nothing. Guard: e2e/test/pool-ci-rows.test.mjs.
import {hostOnly} from './applying-report.mjs';
import {rungFields, verdictFields} from './record-sites.mjs';

export const CI_ROWS_SITE = 'https://www.jobpilotto.top/applying/ci-rows';

// report: the day report (record-sites.mjs). -> [{name, host, reached, filled, left, note, ending, ...}] for the rows THIS run ran
export function ciRows(report = {}) {
  const ran = Array.isArray(report.thisRun?.ran) ? new Set(report.thisRun.ran) : null;
  return Object.entries(report.results || {}).filter(([name, item]) => (!ran || ran.has(name)) && item)
    .map(([name, item]) => ({name, host: hostOnly(item.url), reached: item.reached, filled: item.filled, left: item.left, note: item.note || '', regression: false, ending: item.ending || '', ...rungFields(item), ...verdictFields(item)}));
}

// ctx: {branch, day, version}. -> one line for the run's output; never throws.
export async function uploadCiRows(rows, ctx = {}, {env = process.env, fetcher = fetch} = {}) {
  const why = env.REAL_EXTENSION_DIR ? 'a control run on another build' : !env.CI ? 'a local run: the Mac sends its own rows' : ctx.branch !== 'main' ? `branch ${ctx.branch || '(none)'}: only a run on main reaches the page` : !env.REPLAYS_PUBLISH_KEY ? 'REPLAYS_PUBLISH_KEY not set up' : '';
  if (why) return `ci rows report: not sent (${why})`;
  if (!rows.length) return 'ci rows report: nothing to send (no row ran)';
  if (['1', 'true'].includes(String(env.JP_CI_ROWS_DRY || '').toLowerCase())) return `ci rows report: dry run: would send ${rows.length} row(s)`;
  try {
    const answer = await fetcher(CI_ROWS_SITE, {method: 'PUT', headers: {Authorization: `Bearer ${env.REPLAYS_PUBLISH_KEY}`, 'Content-Type': 'application/json', 'X-Caller': 'ci-rows-upload'},
      body: JSON.stringify({branch: ctx.branch, day: ctx.day, version: ctx.version, rows}), signal: AbortSignal.timeout(20000)});
    const body = await answer.json().catch(() => ({}));
    return answer.ok ? `ci rows report: ${body.stored ?? 0} row(s) sent to /admin/form-filling/lab` : `ci rows report: refused (${answer.status} ${body.error || ''})`;
  } catch (error) { return `ci rows report: not sent (${String(error?.message || error).slice(0, 80)})`; }
}
