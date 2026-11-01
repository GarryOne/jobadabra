// Where a replay's model ask differs from the live run's (npm run row, when an ask misses its kept answer): the app's capture (ai-calls.json: the page-kind, form-answer and form-judge asks as the app received them)
// against the requests the replayed extension sent, per route in order, as short "path: live X | now Y" lines. Only keys the live call has are compared. Guard: e2e/test/ai/ask-diff.test.mjs.
const cut = value => { const text = typeof value === 'string' ? value : JSON.stringify(value); return String(text ?? 'undefined').replace(/\s+/g, ' ').slice(0, 90); };

function walk(live, now, at, out) {
  if (Array.isArray(live) && Array.isArray(now)) {
    for (let i = 0; i < Math.max(live.length, now.length); i++) walk(live[i], now[i], `${at}[${i}]`, out);
  } else if (live && now && typeof live === 'object' && typeof now === 'object' && !Array.isArray(live) && !Array.isArray(now)) {
    for (const key of Object.keys(live)) walk(live[key], now[key], at ? `${at}.${key}` : key, out);
  } else if (JSON.stringify(live) !== JSON.stringify(now)) out.push(`${at}: live ${cut(live)} | now ${cut(now)}`);
}

// liveCalls: ai-calls.json's [{route, request}]; requests: the replay's [{route, body}]. -> up to `max` lines.
export function askDiff(liveCalls = [], requests = [], {max = 12} = {}) {
  const out = [], seen = {};
  for (const call of liveCalls) {
    const n = seen[call.route] = (seen[call.route] ?? -1) + 1;
    const mine = requests.filter(request => request.route === call.route)[n];
    if (!mine) { out.push(`${call.route} #${n + 1}: live asked, the replay never did`); continue; }
    let body = {}; try { body = JSON.parse(mine.body); } catch { out.push(`${call.route} #${n + 1}: the replay's body is cut`); continue; }
    const diffs = []; walk(call.request, body, '', diffs);
    out.push(...diffs.map(text => `${call.route} #${n + 1} ${text}`));
  }
  return out.slice(0, max);
}
