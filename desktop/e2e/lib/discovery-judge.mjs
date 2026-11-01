// The discovery batch's verdict per recorded row, its one Telegram message and its spend line (owner, 17 Oct 2026). Pure: the CLI (discovery-report.mjs) passes the day report in.
// The judge is the one the recordings already use: the row's ending and cause (lib/ending.mjs), the form judge's "blocked", and the shortfall (fields reached but not explained). A row says:
//   fine           the form is reached and what is left is the person's (or a stop the person is told about)
//   fields-left    the form is reached but required fields stayed empty (a field we missed, the AI declined, a control it could not see, a shortfall)
//   wrong          the form was reached and filled, then a dialog, error or overlay covered it, or a value was marked wrong
//   stopped-early  the run ended before the form with no reason the person is told
//   not-measured   the test's own hold, a bot wall on a CI address, a gone posting, a refused AI, a run that did not finish: never a failure
// A failure is new when its row is new (the picker never picks a recorded host), so every failing row of the batch is listed. Guard: e2e/test/discovery-judge.test.mjs.
export const VERDICTS = ['fields-left', 'wrong', 'stopped-early', 'fine', 'not-measured'];
export const FAILURES = ['fields-left', 'wrong', 'stopped-early'];
const FIELD_CAUSES = new Set(['field-missed', 'ai-miss', 'control-unseen']);
const WORDS = {'fields-left': 'fields left', wrong: 'wrong', 'stopped-early': 'stopped early', fine: 'fine', 'not-measured': 'not measured'};
export const verdictWord = verdict => WORDS[verdict] || verdict;

// result: a pool row's result in the day report. -> {verdict, detail}
export function judgeRow(result) {
  if (!result) return {verdict: 'not-measured', detail: 'the run did not finish'};
  if (result.tripped || result.aiRefused) return {verdict: 'not-measured', detail: result.tripped ? 'the privacy tripwire' : 'the AI was refused'};
  if (result.reached === 'none' || result.reached === 'code/bot' || result.note) return {verdict: 'not-measured', detail: result.note ? String(result.note).slice(0, 80) : result.reached === 'none' ? 'no posting' : 'a bot wall'};
  if (!result.ending || result.ending === 'held') return {verdict: 'not-measured', detail: 'held by the test'};
  if (result.blocked) return {verdict: 'wrong', detail: `covered after the fill (${String(result.blocked).slice(0, 60)})`};
  if (result.wrong > 0) return {verdict: 'wrong', detail: `${result.wrong} wrong value${result.wrong === 1 ? '' : 's'}`};
  const formReached = result.reached === 'form' || result.reached === 'ready';
  if (formReached && result.short) return {verdict: 'fields-left', detail: `${result.short.miss + result.short.noSuggestion} of ${result.short.total} asked fields unexplained`};
  if (result.ending === 'unresolved') {
    if (formReached || FIELD_CAUSES.has(result.cause)) return {verdict: 'fields-left', detail: `${result.left ?? '?'} fields left${result.cause ? ` (${result.cause})` : ''}`};
    return {verdict: 'stopped-early', detail: `ended on ${result.reached || 'the posting'}${result.cause ? ` (${result.cause})` : ''}`};
  }
  if (result.ending === 'blind' || result.ending === 'site_broken') return {verdict: formReached ? 'fields-left' : 'stopped-early', detail: `${result.ending.replace('_', ' ')}${result.cause ? ` (${result.cause})` : ''}`};
  return {verdict: 'fine', detail: ''};
}

// report: the day report; picked: the batch's rows ([{shape, urls, source}]). -> [{shape, host, source, url, verdict, detail}], the picked rows only, in the batch's order.
export function judgeBatch(report = {}, picked = []) {
  return picked.map(row => {
    const result = (report.results || {})[row.shape], judged = judgeRow(result);
    return {shape: row.shape, source: row.source, url: result?.url || row.urls?.[0] || '', host: hostOf(result?.url || row.urls?.[0]), signature: result?.signature || '', reached: result?.reached || '', ...judged};
  });
}
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// Telegram: ONE message a run, only when something new failed. -> '' when nothing did.
export function telegramText({day, judged = [], usd = 0, weekSpent = 0, weekCap = 3, labUrl = 'https://www.jobpilotto.top/admin/form-filling/lab'}) {
  const failed = judged.filter(item => FAILURES.includes(item.verdict));
  if (!failed.length) return '';
  const fine = judged.filter(item => item.verdict === 'fine'), unmeasured = judged.filter(item => item.verdict === 'not-measured');
  return [`🔎 Discovery ${day}: ${judged.length} sites recorded, ${failed.length} failed`,
    ...failed.map(item => `• ${item.host || item.shape}: ${verdictWord(item.verdict)}${item.detail ? ` (${item.detail})` : ''}`),
    ...(fine.length ? [`✅ ${fine.length} fine: ${fine.map(item => item.host).join(', ')}`] : []),
    ...(unmeasured.length ? [`⚪ ${unmeasured.length} not measured`] : []),
    `Spent $${usd.toFixed(2)} (week $${weekSpent.toFixed(2)} of $${weekCap.toFixed(2)}). Needs a fix: ${labUrl}`].join('\n');
}

// The message when the week's cap stops the batch: once a week (alerted: the week an earlier run already told).
export const capText = ({week, spent, cap}) => `⛔ Discovery batch paused: $${spent.toFixed(2)} of the $${cap.toFixed(2)} week cap (week of ${week}) is spent. It resumes on Monday.`;

// Rows that reached a flow shape the pool does not have yet join the pool by a PR: not-measured and unclear rows never do (a recording that taught nothing).
export function poolAdditions(judged, known = new Set()) {
  const seen = new Set(known), out = [];
  for (const item of judged) {
    if (item.verdict === 'not-measured' || !item.signature || item.signature === 'unclear' || seen.has(item.signature) || !item.url) continue;
    seen.add(item.signature);
    out.push({shape: item.shape, urls: [item.url], signature: item.signature});
  }
  return out;
}
