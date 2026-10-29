// The Sentry fixer's decisions, as pure functions (tested in desktop/test/sentry-fixer.test.js): which Sentry issues are worth a fix, which one is first, which files a fix may touch.
// Care taken against stale or false work: end-to-end runs report to Sentry too (environment `e2e`) and never count; a warning is the app telling the user something (a spend limit), not a bug;
// an issue not seen for a week is stale; one that already has a pull request (open, or closed/merged in the last 14 days) is left alone, and so is one Claude already judged
// needs no change (not-a-bug, needs-human) in the last 14 days: without that the fixer picked the same issue every day (4-9 Oct 2026: a planted test error, six days running).

export const NOT_REAL_ENVIRONMENTS = ['test', 'dev', 'development', 'ci'];
export const FRESH_DAYS = 7;
export const COOLDOWN_DAYS = 14;
const DAY = 86400000;
// The exception type of the recall benchmark's planted errors (desktop/e2e/lib/recall.mjs): a bug made on purpose to see that the detectors catch it, never one to fix.
export const PLANT_TYPE = 'RecallPlant';

// issue: Sentry's issue JSON ({shortId, level, status, count (a string), userCount, firstSeen, lastSeen, ...}); environment: its latest event's environment tag.
// An end-to-end run (environment e2e) is synthetic monitoring: its report counts only when it is tagged `expected: no` (a suite that does not break things on purpose, tagged by lib/sentry.js);
// an untagged one (older than the tag) or `expected: yes` is the test's own doing.
// type: the latest event's exception type, when it has one.
export function judge(issue, environment, now = Date.now(), tags = {}, type = '') {
  const env = String(environment || '').toLowerCase();
  if (type === PLANT_TYPE) return {ok: false, why: 'planted on purpose by the recall benchmark'};
  if (NOT_REAL_ENVIRONMENTS.includes(env)) return {ok: false, why: `reported by a ${environment} run, not a user`};
  if (env === 'e2e' && tags.expected !== 'no') return {ok: false, why: tags.expected === 'yes' ? 'caused on purpose by an end-to-end suite' : 'an end-to-end report without the expected tag'};
  if (issue.status && issue.status !== 'unresolved') return {ok: false, why: `already ${issue.status} in Sentry`};
  if (!['error', 'fatal'].includes(issue.level)) return {ok: false, why: `a ${issue.level}: the app telling the user something, not a bug`};
  const seen = Date.parse(issue.lastSeen);
  if (!Number.isFinite(seen) || now - seen > FRESH_DAYS * DAY) return {ok: false, why: `not seen for more than ${FRESH_DAYS} days: stale`};
  const count = Number(issue.count) || 0, users = Number(issue.userCount) || 0;
  if (issue.level !== 'fatal' && count < 3 && users < 2) return {ok: false, why: 'seen once by one person: a one-off until it comes back'};
  return {ok: true, why: ''};
}

// Most affected people first, then how often, then how recently.
export const score = issue => (Number(issue.userCount) || 0) * 1000 + Math.min(Number(issue.count) || 0, 999) + (issue.level === 'fatal' ? 5000 : 0);

// The pull requests of this fixer carry the branch `sentry-fix/<short id>`. prs: [{headRefName, state: OPEN|MERGED|CLOSED, closedAt, mergedAt}]
export function handled(shortId, prs, now = Date.now()) {
  const branch = `sentry-fix/${String(shortId).toLowerCase()}`;
  return prs.some(pr => pr.headRefName === branch && (pr.state === 'OPEN' || now - Date.parse(pr.mergedAt || pr.closedAt || 0) < COOLDOWN_DAYS * DAY));
}

// A run where Claude made no change leaves a closed GitHub issue titled `Sentry fixer: <short id> <verdict>` (label VERDICT_LABEL). issues: [{title, createdAt}]
export const VERDICT_LABEL = 'sentry-fix-verdict';
export function judgedRecently(shortId, issues, now = Date.now()) {
  const found = issues.find(item => String(item.title || '').split(' ')[2] === shortId && now - Date.parse(item.createdAt || 0) < COOLDOWN_DAYS * DAY);
  return found ? String(found.title).split(' ')[3] || 'no change' : '';
}

// The exception type of a Sentry event (the first one), '' without one.
export const exceptionType = event => String((event?.entries || []).find(entry => entry.type === 'exception')?.data?.values?.[0]?.type || '');

// candidates: [{issue, environment, tags, type}] -> the first fixable one, and why each other was left out. verdicts: the closed verdict issues (judgedRecently).
export function choose(candidates, prs = [], now = Date.now(), verdicts = []) {
  const left = [];
  const ready = candidates.filter(({issue, environment, tags, type}) => {
    const verdict = judge(issue, environment, now, tags, type);
    if (!verdict.ok) { left.push({shortId: issue.shortId, why: verdict.why}); return false; }
    if (handled(issue.shortId, prs, now)) { left.push({shortId: issue.shortId, why: 'already has a pull request'}); return false; }
    const judged = judgedRecently(issue.shortId, verdicts, now);
    if (judged) { left.push({shortId: issue.shortId, why: `already judged in the last ${COOLDOWN_DAYS} days: ${judged}`}); return false; }
    return true;
  }).sort((a, b) => score(b.issue) - score(a.issue));
  return {pick: ready[0] || null, left};
}

// What a fix may touch: the app's code and the engine, and their tests. Never what reports, secrets, licences or the build itself.
export const ALLOWED = [/^desktop\/lib\/[^/]+\.js$/, /^desktop\/main\.js$/, /^desktop\/renderer\/.+/, /^src\/.+\.py$/, /^desktop\/test\/[^/]+\.test\.js$/, /^tests\/[^/]+\.py$/];
export const FORBIDDEN = /(secret|license|licence|crash_reporting|telemetry|sentry|analytics|keychain|\.\.)/i;
export const TEST = /^(desktop\/test\/[^/]+\.test\.js|tests\/[^/]+\.py)$/;
export function checkChange(files) {
  const bad = files.filter(file => !ALLOWED.some(pattern => pattern.test(file)) || FORBIDDEN.test(file));
  if (bad.length) return {ok: false, why: `edits outside what a fix may touch: ${bad.join(', ')}`};
  if (!files.some(file => TEST.test(file))) return {ok: false, why: 'a fix must come with a test'};
  return {ok: true, why: ''};
}

// The latest event, reduced to what a fix needs: the exception with its own code frames, the trail of steps, the release. No user, no install id.
export function eventFacts(event) {
  const tags = Object.fromEntries((event.tags || []).map(tag => [tag.key, tag.value]));
  const values = (event.entries || []).find(entry => entry.type === 'exception')?.data?.values || [];
  const exceptions = values.map(value => ({type: value.type, value: String(value.value || '').slice(0, 600),
    frames: (value.stacktrace?.frames || []).filter(frame => frame.inApp !== false).slice(-8).map(frame => ({file: frame.filename, line: frame.lineNo, function: frame.function, code: frame.context?.find(([n]) => n === frame.lineNo)?.[1]?.trim() || ''}))}));
  const trail = ((event.entries || []).find(entry => entry.type === 'breadcrumbs')?.data?.values || []).slice(-25).map(item => item.message || item.category || '').filter(Boolean);
  return {release: tags.release || '', environment: tags.environment || '', exceptions, trail, message: String(event.message || event.title || '').slice(0, 400)};
}
