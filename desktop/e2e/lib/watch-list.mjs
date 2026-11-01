// The daily watch list (owner, 17 Oct 2026): one pool row per multi-step platform, recorded LIVE every day; its cap, its comparison with the row's last live run, its one message. Pure.
// A watch row is a pool row of desktop/e2e/smoke-sites.json with "stage": "watch" (the life cycle's Daily watch stage); the batch adds a row when it finds a new platform.
// The verdict per row is the discovery judge's (lib/discovery-judge.mjs); a flow is WORSE when its verdict got more severe, it reached an earlier step, it filled fewer fields on the same
// posting (lib/record-sites.mjs compare), or its journey check failed after passing. A row that was not measured (held, bot wall, gone posting) is never worse and never the next baseline.
// Guard: e2e/test/watch-list.test.mjs.
import {compare} from './record-sites.mjs';
import {judgeRow, verdictWord} from './discovery-judge.mjs';

export const MONTH_CAP_USD = 25, ROW_USD = 0.06, MAX_ROWS = 12;
const SEVERITY = {fine: 0, 'fields-left': 1, 'stopped-early': 2, wrong: 2};

export const watchRows = (pool = []) => pool.filter(row => row.stage === 'watch');
// The watch rows the daily offline replay skips: the fresh live recording is the debugging copy (owner, 17 Oct 2026). A row still PINNED stays in the replay: the scheduled gate needs every pinned
// row, and a pin leaves only in a PR with the owner's Replay-accept line (replay-gate.mjs), never from here.
export const replaySkipped = (pool = [], pinned = []) => new Set(watchRows(pool).map(row => row.shape).filter(shape => !pinned.includes(shape)));
export const monthOf = at => String(at).slice(0, 7);

// states: [{at, usd}] the earlier watch runs' own spend lines. -> {month, spent, remaining, maxUsd, capped}: the run's AI cap is twice its expected spend, never above what the month has left.
export function budget(states = [], now = new Date(), rows = MAX_ROWS, {cap = MONTH_CAP_USD, rowUsd = ROW_USD} = {}) {
  const month = monthOf(now.toISOString()), spent = states.filter(state => monthOf(state.at) === month).reduce((sum, state) => sum + (Number(state.usd) || 0), 0);
  const remaining = Math.max(0, cap - spent);
  return {month, spent: round(spent), remaining: round(remaining), maxUsd: round(Math.min(remaining, Math.max(rows * rowUsd * 2, 0.2))), capped: remaining < rowUsd};
}
const round = value => Math.round(value * 1000) / 1000;

// The row's state to keep: what the judge said and where it got to. null when the run did not measure it.
export function measured(result, journeyFailed = false) {
  const judged = judgeRow(result);
  if (judged.verdict === 'not-measured') return null;
  return {verdict: judged.verdict, detail: judged.detail, reached: result.reached, filled: result.filled ?? null, url: result.url || '', journey: journeyFailed ? 'failed' : 'passed'};
}

// previous: the row's last measured state (or undefined: the first live run, nothing to be worse than). current: measured() of today. -> the reason, or '' when it is not worse.
export function worse(previous, current, shape = '') {
  if (!previous || !current) return '';
  if (previous.journey === 'passed' && current.journey === 'failed') return 'the journey check failed (card or panel)';
  if ((SEVERITY[current.verdict] ?? 0) > (SEVERITY[previous.verdict] ?? 0)) return `${verdictWord(current.verdict)}${current.detail ? ` (${current.detail})` : ''}, last live run ${verdictWord(previous.verdict)}`;
  return compare({[shape]: previous}, {[shape]: current})[0]?.why || '';
}

// report: the day report; picked: the watch rows' names; previous: {shape: state}; failedJourneys: Set of row names. -> {rows: {shape: state}, held: [shape], worse: [{shape, why}], measured: [shape]}
export function judgeWatch(report = {}, picked = [], previous = {}, failedJourneys = new Set()) {
  const rows = {}, held = [], list = [], done = [];
  for (const shape of picked) {
    const result = (report.results || {})[shape], now = measured(result, failedJourneys.has(shape));
    if (!now) { held.push(shape); if (previous[shape]) rows[shape] = previous[shape]; continue; }
    done.push(shape); rows[shape] = now;
    const why = worse(previous[shape], now, shape);
    if (why) list.push({shape, why});
  }
  return {rows, held, worse: list, measured: done};
}

// ONE message a run, only when a flow got worse than its previous live run. '' otherwise (day 1 sends nothing).
export function telegramText({day, judged, usd = 0, monthSpent = 0, monthCap = MONTH_CAP_USD, labUrl = 'https://www.jobpilotto.top/admin/form-filling/lab'}) {
  if (!judged.worse.length) return '';
  return [`📉 Daily watch ${day}: ${judged.worse.length} of ${judged.measured.length} flows worse than the last live run`,
    ...judged.worse.map(item => `• ${item.shape}: ${item.why}`),
    ...(judged.held.length ? [`⚪ ${judged.held.length} held (no account, bot wall or posting gone)`] : []),
    `Spent $${usd.toFixed(2)} (month $${monthSpent.toFixed(2)} of $${monthCap.toFixed(2)}). ${labUrl}`].join('\n');
}

export const capText = ({month, spent, cap}) => `⛔ Daily watch paused: $${spent.toFixed(2)} of the $${cap.toFixed(2)} month cap (${month}) is spent. It resumes on the 1st.`;
