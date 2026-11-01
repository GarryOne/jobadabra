// Counts the push gate's log per day for /admin/operations/agent-coding (owner, 1 Nov 2026: "New page incl. push gate"): per day the pushes, the stopped ones by what stopped them
// (form = a trailer, comment, list, count or size check; real = a suite; other), their seconds, and per check its runs, stops and seconds. Pure counting: only fixed check labels,
// counts and seconds come out, never a branch, a path or any text of the log. Test: desktop/test/gate-stats.test.js. Upload: tools/gate-stats-upload.mjs.
// The log (<git common dir>/gate-timing.log, tools/gate-timing.sh): a header "# <iso> <label> total=<s>s [SLOW] branch=<b>" then "<secs> <exit> <check>" lines; other "# ..." lines are lock waits.

// Why (1 Nov 2026, pa's prune audit): these two sets are the audit's own, so the page and the audit agree. Form = it checks how a change is written down, not whether it works.
export const FORM = new Set(['recorded cases', 'rung trailer', 'e2e cause trailer', 'owner report', 'spec proof', 'why comments', 'new code comments', 'prompt cases', 'e2e issue links',
  'workflow paths', 'registry lists', 'harness test sets', 'stale expectations', 'new e2e steps', 'e2e reliability', 'file size']);
export const SUITES = new Set(['desktop (clean checkout)', 'python (clean checkout)', 'worker (clean checkout)', 'site (clean checkout)', 'e2e unit tests (desktop/e2e npm test, as CI)',
  'renderer class tests', 'journey gate', 'ladder gate', 'places check (real AI)']);

export const classOf = name => (SUITES.has(name) ? 'real' : FORM.has(name) ? 'form' : 'other');
// The log text -> [{day, secs, steps: [{name, secs, exit}]}], one per push header with a total.
export function parseLog(text) {
  const pushes = [];
  let current = null;
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('# ')) {
      const header = /^# (\d{4}-\d\d-\d\d)\S* .*total=(\d+)s/.exec(line);
      if (header) { current = {day: header[1], secs: Number(header[2]), steps: []}; pushes.push(current); }
      continue;
    }
    const step = /^(\d+) (\d+) (.+)$/.exec(line);
    if (step && current) current.steps.push({secs: Number(step[1]), exit: Number(step[2]), name: step[3].replace(/^workflow paths \S+\.yml$/, 'workflow paths')});
  }
  return pushes;
}
// A push's class by the checks that failed: a suite -> real; only form checks -> form; anything else -> other; null when nothing failed.
export function stoppedAs(push) {
  const failed = push.steps.filter(step => step.exit !== 0).map(step => step.name);
  if (!failed.length) return null;
  return failed.some(name => SUITES.has(name)) ? 'real' : failed.every(name => FORM.has(name)) ? 'form' : 'other';
}
// Pushes -> one card per day, the last `days` days up to `now`, oldest first. Shape: admin/agent-coding.js cleanGate.
export function byDay(pushes, {days = 35, now = new Date()} = {}) {
  const since = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10), cards = new Map();
  for (const push of pushes.filter(item => item.day >= since)) {
    const card = cards.get(push.day) || {day: push.day, pushes: 0, secs: 0, stopped: {form: 0, real: 0, other: 0}, stoppedSecs: {form: 0, real: 0, other: 0}, steps: {}};
    cards.set(push.day, card);
    card.pushes++; card.secs += push.secs;
    const kind = stoppedAs(push);
    if (kind) { card.stopped[kind]++; card.stoppedSecs[kind] += push.secs; }
    for (const step of push.steps) {
      const at = card.steps[step.name] ||= {runs: 0, fails: 0, secs: 0, cls: classOf(step.name)};
      at.runs++; at.secs += step.secs; if (step.exit !== 0) at.fails++;
    }
  }
  return [...cards.values()].sort((a, b) => a.day.localeCompare(b.day));
}
