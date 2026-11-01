// The one order every pool run starts in (owner, 11 Oct 2026: "always start with the ones tested the least"): share, --all, a list or a resume. Owns: orderPool, testedCounts.
// Never run first, then the fewest runs in the last 14 days, then the oldest last run, then the pool's own order. A row resting today (site limit / block page) is left out and listed.
// Guarded by test/record/record-sites-order.test.mjs (a mode that orders rows another way fails there). Pure: reports and the rested check come in as arguments.
export const WINDOW_DAYS = 14;

// reports: the day reports ({day, results}), today's included. -> {shape: {count, last}}: count = days with a result in the window, last = the newest day ever ('' never).
export function testedCounts(reports, day, windowDays = WINDOW_DAYS) {
  const since = new Date(Date.parse(`${day}T00:00:00Z`) - (windowDays - 1) * 86400000).toISOString().slice(0, 10), out = {};
  for (const report of reports) for (const shape of Object.keys(report.results || {})) {
    const entry = out[shape] ||= {count: 0, last: ''};
    if (String(report.day) >= since && String(report.day) <= day) entry.count++;
    if (String(report.day) > entry.last) entry.last = String(report.day);
  }
  return out;
}

// pool: [{shape,...}]; rested(item) -> true when the site rests today. -> {order, rested, lines}: order is the rows to run (rested ones left out), lines say count and last run per row.
export function orderPool(pool, reports, day, {rested = () => false, windowDays = WINDOW_DAYS} = {}) {
  const counts = testedCounts(reports, day, windowDays), at = item => counts[item.shape] || {count: 0, last: ''};
  const rows = pool.map((item, index) => ({item, index, ...at(item)}));
  const resting = rows.filter(row => rested(row.item)), awake = rows.filter(row => !resting.includes(row));
  awake.sort((x, y) => (!y.last - !x.last) || x.count - y.count || x.last.localeCompare(y.last) || x.index - y.index);
  const order = awake.map(row => row.item);
  const lines = awake.map((row, i) => `  ${i + 1}. ${row.item.shape}: ${row.count} run(s) in ${windowDays} days, ${row.last ? `last ${row.last}` : 'never run'}`);
  return {order, rested: resting.map(row => row.item), lines};
}
