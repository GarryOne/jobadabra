// Self-healing triage, part 3: matching a finding to an open issue, sightings, regressions, ranking and priorities, the scorecard, and which issue is ready for a fixer.
// Re-exported by triage.mjs; guarded by desktop/e2e/test/triage.test.mjs (and the other triage-*.test.mjs, severity, a11y, prejudge, regress-flaky tests).
import {afterEpoch} from './stats-epoch.mjs';
import {LABEL, NEEDS_HUMAN, FALSE_POSITIVE, CONFIRMED, NOT_SEEN, SIGHTINGS_NEEDED, LOGIC_KINDS, FIX_KINDS, allowedPath, labelFor} from './triage-findings.mjs';
import {foundText, similar} from './triage-issues.mjs';
import {resolutionOf} from './resolution.mjs';

// A finding from a Windows run that the Mac already told: an open Mac issue, or one a person rejected as not planned (4 Oct 2026: #239 / #202, #215 / #146 were the same finding filed twice).
// A Mac issue closed as fixed does not count: a Windows run that sees it again may be a real regression.
// At most this many NEW issues from the AI screenshot review in one run, the highest severity first (owner, 4 Oct 2026: "no need to invent trivial bugs"). A full run that finds more than
// this is more likely noisy than broken; the rest are dropped, and a real one shows again in the next run.
export const MAX_NEW_AI_PER_RUN = 3;
export function capNewAi(plan, max = MAX_NEW_AI_PER_RUN) {
  const fresh = plan.filter(item => !item.existing && !item.twin && item.finding.source === 'ai-review');
  const rank = item => ({high: 0, medium: 1, low: 2})[item.finding.severity] ?? 3;
  const keep = new Set([...fresh].sort((a, b) => rank(a) - rank(b)).slice(0, max));
  return plan.filter(item => !fresh.includes(item) || keep.has(item));
}
// What the filters cut this run, as a table the owner can read (4 Oct 2026: to tell whether the Finder is too restrictive).
export function droppedTable(dropped, max = 30) {
  if (!dropped.length) return '';
  const rows = dropped.slice(0, max).map(item => `| ${String(item.source || 'ai-review').replace(/\|/g, '/')} | ${String(item.view || '').replace(/\|/g, '/')} | ${String(item.severity || '?')} | ${String(item.title || '').replace(/\|/g, '/')} | ${String(item.why).replace(/\|/g, '/')} |`);
  return ['', `### Raised but not filed: ${dropped.length}`, 'What the filters cut (so a missing bug can be found here): low ones, no stated impact, over the per-run cap, matching a closed false positive.', '',
    '| Detector | Page | Severity | Finding | Why not filed |', '|---|---|---|---|---|', ...rows, ...(dropped.length > max ? [`| | | | … and ${dropped.length - max} more | |`] : [])].join('\n');
}
export function macTwin(finding, issues) {
  const mac = issues.filter(issue => ((issue.labels || []).map(item => item.name || item).find(name => name.startsWith('platform:')) || 'platform:mac') === 'platform:mac');
  const asMac = {...finding, id: String(finding.id).replace(/-win$/, '')};
  return matchExisting(asMac, mac) || matchExisting(asMac, mac.filter(issue => issue.stateReason === 'NOT_PLANNED'), 0.3, 'CLOSED') || null;
}
export function matchExisting(finding, issues, threshold = 0.3, state = 'OPEN') {
  const label = labelFor(finding.id);
  const named = issues.find(issue => issue.state === state && (issue.labels || []).some(item => (item.name || item) === label));
  if (named) return named;
  const text = `${finding.title} ${finding.detail}`;
  const kindOf = issue => /·\s*([a-z0-9-]+)\s*·/.exec(issue.body || '')?.[1] || '';
  const best = (pool, floor) => pool.map(issue => ({issue, score: similar(text, `${(issue.title || '').replace(/^\[auto-ui\] [^:]+:/, '')} ${foundText(issue.body)}`)}))
    .filter(item => item.score >= floor).sort((a, b) => b.score - a.score)[0]?.issue || null;
  const open = issues.filter(issue => issue.state === state && kindOf(issue) === finding.kind);
  const same = best(open.filter(issue => viewOf(issue) === finding.view), threshold);
  if (same) return same;
  // The same bug seen from another variant of the page (activity-run-failed and activity-limit-paused, calendar and calendar-empty, jobs and jobs-narrow) was
  // filed twice (#103 and #105, #120 and #122, 4 Oct 2026). Within a page family and a kind, alike words are the same issue: those pairs scored 0.22 and 0.38,
  // distinct bugs of the same family at most 0.14.
  return best(open.filter(issue => viewOf(issue) !== finding.view && viewFamily(viewOf(issue)) === viewFamily(finding.view)), FAMILY_SIMILAR);
}
export const FAMILY_SIMILAR = 0.2;
export const viewFamily = view => String(view || '').replace(/-narrow$/, '').split('-')[0];

// One sighting per commit: an unchanged commit is looked at up to three times a day (lib/plan.mjs), and a cosmetic finding that shows every time
// filled the fixer's queue (#66 scored 14 from one build, 3 Oct 2026). The commit is the "Build tested: … @ <sha>" line; without one, each sighting counts.
const commitOf = text => /Build tested: .*? @ ([0-9a-f]{7})/.exec(text || '')?.[1] || '';
function sightingKeys(issue, keep = () => true) {
  const keys = new Set(), add = (text, key) => keys.add(commitOf(text) || key);
  if (keep(issue.createdAt)) add(issue.body, 'filed');
  (issue.comments || []).forEach((comment, i) => { if (/^Seen again\b/.test(comment.body || '') && keep(comment.createdAt)) add(comment.body, `seen-${i}`); });
  return keys;
}
// How many commits an issue has been seen on: the finding itself plus each "Seen again" on another commit.
export const sightings = issue => Math.max(1, sightingKeys(issue).size);

// Sightings of an issue in the last `days` days, one per commit: the issue itself (when it was filed that recently) and each "Seen again" comment. Undated ones (older data, tests) count.
// REGRESSIONS and FLAKY steps (5 Oct 2026). A new finding that matches an issue a FIX closed (a commit said it fixes it, or the fixer's merge) is a regression:
// labelled, raised to P1 at least, so a fix that did not hold is never a quiet new P3. A failed step whose suite then passed on the SAME commit is flaky: the
// product did not change, so the test is the problem; labelled, ranked last, and listed as such (13 of 28 failed-step issues cleared on their own).
export const REGRESSION = 'regression', FLAKY = 'flaky';
const FIXED = /^(?:Closed: commit [0-9a-f]+ says it fixes this|Fixed by https?:\/\/)/;
// Closed by a fix: the label `resolution:fixed` (the loop's own word since 5 Oct 2026, set by the fixer, a person and the triage-github-open-issues skill), or one of the two older closing comments.
// Until 9 Oct 2026 only the comments counted, so /admin/self-healing said "no defect closed by a fix yet" over 42 issues labelled fixed.
export const closedByFix = issue => issue.state === 'CLOSED' && issue.stateReason !== 'NOT_PLANNED' && (resolutionOf(issue) === 'fixed' || (issue.comments || []).some(comment => FIXED.test(comment.body || '')));
export const fixedBefore = (finding, issues) => matchExisting(finding, (issues || []).filter(closedByFix), 0.3, 'CLOSED');
// The commits a failed-step issue was seen failing on (its body and its "Seen again" comments).
export const failedCommits = issue => new Set([commitOf(issue.body), ...(issue.comments || []).filter(comment => /^Seen again\b/.test(comment.body || '')).map(comment => commitOf(comment.body))].filter(Boolean));
export const flakyOn = (issue, sha7) => !!sha7 && /·\s*test-failure\s*·/.test(issue.body || '') && failedCommits(issue).has(sha7);
export const regressionComment = (issue, runUrl) => `↩️ **Regression:** this looks like #${issue.number} ("${String(issue.title || '').replace(/^\[auto-ui\] /, '').slice(0, 80)}"), which a fix closed. The fix did not hold (${runUrl}).`;
export const flakyComment = (sha7, runUrl, why = '') => `🎲 **Flaky:** this step failed and then passed on the same commit \`${sha7}\` (${runUrl})${why ? `, on ${why}` : ''}: the test's timing or environment, not a wrong value. Labelled \`flaky\`, ranked last, never offered to the fixer. (A wrong value that comes right on a rerun is labelled \`intermittent\` instead: lib/flaky-proof.mjs.)`;

export function recentSightings(issue, now = Date.now(), days = 7) {
  return sightingKeys(issue, date => !date || now - Date.parse(date) <= days * 86400000).size;
}
const WEIGHT = {HIGH: 3, MEDIUM: 2, LOW: 1};
// How critical a finding is: its severity times how often it came back this week; a person's "confirmed" doubles it.
export function score(issue, now = Date.now()) {
  const label = (issue.labels || []).map(item => item.name || item);
  const severity = /\*\*(HIGH|MEDIUM|LOW)\*\*/.exec(issue.body || '')?.[1] || 'LOW';
  return WEIGHT[severity] * Math.max(1, recentSightings(issue, now)) * (label.includes(CONFIRMED) ? 2 : 1);
}

// ---- Ranking: where an open issue stands, kept on its labels (priority:P0..P3) and in one pinned list, so the most important are on top without anyone sorting. ----
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
export const priorityLabel = band => `priority:${band}`;
const BLOCKING_KINDS = ['functionality', 'error-shown', 'test-failure', 'page-overflow', 'tall-row', 'broken-image'];   // the kinds that keep a build from beta (blockers(), tools/canary_promote.py)

// P0 would keep a build from beta or stable (a high, wrong-app finding seen twice this week or confirmed); P1 score 6+ (a high one seen twice, a medium one seen three times);
// P2 score 3+ (a high one seen once, a medium one seen twice); P3 the rest (a medium or low one seen once). score() = severity x sightings this week, doubled by `confirmed`.
export function priorityOf(issue, now = Date.now()) {
  const labels = (issue.labels || []).map(item => item.name || item);
  const severity = /\*\*(HIGH|MEDIUM|LOW)\*\*/.exec(issue.body || '')?.[1] || 'LOW';
  const kind = /·\s*([a-z0-9-]+)\s*·/.exec(issue.body || '')?.[1] || '';
  const seen = recentSightings(issue, now), points = score(issue, now);
  if (labels.includes(NOT_SEEN)) return 'P3';   // already clean in the latest run: waiting to close, never above the rest
  if (labels.includes(FLAKY)) return 'P3';   // the test, not the product
  const regressed = labels.includes(REGRESSION);
  if (severity === 'HIGH' && BLOCKING_KINDS.includes(kind) && (seen >= 2 || labels.includes(CONFIRMED))) return 'P0';
  return points >= 6 || regressed ? 'P1' : points >= 3 ? 'P2' : 'P3';   // a fix that did not hold is never a quiet P3
}

// What breaks the product outranks what is only rough: a wrong result > a dead or broken control > a missing spinner; a crashed test step is the harness, not the product.
// The score alone tied eleven of twelve rows on 3 Oct 2026 (a red status dot ranked like a missing spinner).
const KIND_WEIGHT = {functionality: 3, 'error-shown': 3, 'wrong-result': 3, 'console-error': 3, 'dead-control': 2, 'silent-control': 2, 'expand-broken': 2, 'page-overflow': 2, 'tall-row': 2, 'broken-image': 2, 'no-loading-state': 1, 'test-failure': 0.5};
const CRITICAL_VIEWS = ['apply', 'applyflows', 'strategy', 'activity', 'wizard'];   // the critical path: apply, strategy sync, run results, setup
const kindOf = issue => /·\s*([a-z0-9-]+)\s*·/.exec(issue.body || '')?.[1] || '';
const viewOf = issue => /^\[auto-ui\] ([^:]+):/.exec(issue.title || '')?.[1] || '';
export const rankWeight = (issue, now = Date.now()) => score(issue, now) * (KIND_WEIGHT[kindOf(issue)] ?? 1) * (CRITICAL_VIEWS.includes(viewOf(issue)) ? 1.5 : 1);

// -> the open UI-loop issues, most important first: priority, then (already clean last), then weighted score, Mac before Windows (Windows never blocks a release), then the oldest.
// Parked ones (needs-human, wontfix-auto) are left out.
export function rankIssues(issues, now = Date.now()) {
  const has = (issue, name) => (issue.labels || []).some(item => (item.name || item) === name);
  // An issue that needs a person is open and the most relevant one to the owner, so it stays on the list, marked (4 Oct 2026: #265 was open with needs-human and #73 said "0 open"); only a false positive drops out.
  return issues.filter(issue => issue.state === 'OPEN' && !(issue.labels || []).some(item => (item.name || item) === FALSE_POSITIVE))
    .map(issue => ({issue, priority: priorityOf(issue, now), score: score(issue, now), weight: rankWeight(issue, now)}))
    .sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || Number(has(a.issue, NOT_SEEN)) - Number(has(b.issue, NOT_SEEN)) || b.weight - a.weight
      || Number(has(a.issue, 'platform:windows')) - Number(has(b.issue, 'platform:windows')) || a.issue.number - b.issue.number);
}

const lastBuild = issue => [issue.body, ...(issue.comments || []).filter(comment => /^Seen again\b/.test(comment.body || '')).map(comment => comment.body)].map(commitOf).filter(Boolean).at(-1) || '';
const lastSeen = issue => [issue.createdAt, ...(issue.comments || []).filter(comment => /^Seen again\b/.test(comment.body || '')).map(comment => comment.createdAt)].filter(Boolean).sort().at(-1) || '';
// Each detector's record over the last 30 days, from the issues themselves: how many it filed, how many were false positives (wontfix-auto), how many were real
// (confirmed, or closed as completed), how many are still open. With the recall plants (recall.json), this is how "better" is measured, not guessed.
const SOURCE_NAMES = {'ai-review': 'AI screenshot review', 'interaction-probe': 'Interaction probe', 'layout-check': 'Layout and DOM checks', 'suite-failure': 'Failed test steps', 'code-review': 'AI code review', explorer: 'AI explorer'};
export function scorecard(issues, now = Date.now(), days = 30) {
  const rows = {};
  for (const issue of issues || []) {
    if (issue.createdAt && now - Date.parse(issue.createdAt) > days * 86400000) continue;
    if (!afterEpoch(issue)) continue;
    const labels = (issue.labels || []).map(item => item.name || item);
    const source = (labels.find(name => name.startsWith('source:')) || '').slice(7);
    if (!source) continue;
    const row = (rows[source] ??= {filed: 0, falsePositive: 0, real: 0, open: 0});
    row.filed++;
    if (labels.includes(FALSE_POSITIVE)) row.falsePositive++;
    else if (labels.includes(CONFIRMED) || (issue.state === 'CLOSED' && issue.stateReason === 'COMPLETED' && !labels.includes(NOT_SEEN))) row.real++;
    if (issue.state === 'OPEN') row.open++;
  }
  return Object.entries(rows).sort((a, b) => b[1].filed - a[1].filed).map(([source, row]) => ({source: SOURCE_NAMES[source] || source, ...row}));
}
export const scorecardLines = rows => (rows.length ? ['', '**Detectors, last 30 days**', '', '| Detector | Filed | False positives | Real | Open |', '|---|---|---|---|---|',
  ...rows.map(row => `| ${row.source} | ${row.filed} | ${row.falsePositive}${row.filed ? ` (${Math.round(100 * row.falsePositive / row.filed)}%)` : ''} | ${row.real} | ${row.open} |`),
  '', '<sub>Real = confirmed by a person or the verdict pass, or closed as fixed. Closed as "not seen" counts as neither. Recall (known bugs planted into the page, caught or not) is in each interactions run\'s summary.</sub>'] : []);
// The fixer and the verdict pass over the same 30 days: pull requests opened, merged, closed unmerged, still open; verdicts real and false. With the detectors'
// scorecard this says whether the loop works on its own (4 Oct 2026). `prs`: [{state, createdAt}] of the label auto-ui-fix.
export function fixerCard(prs, issues, now = Date.now(), days = 30) {
  const recent = date => !date || now - Date.parse(date) <= days * 86400000;
  const pr = {opened: 0, merged: 0, closed: 0, open: 0};
  for (const item of prs || []) { if (!recent(item.createdAt)) continue; pr.opened++; pr[item.state === 'MERGED' ? 'merged' : item.state === 'CLOSED' ? 'closed' : 'open']++; }
  let real = 0, falsePositive = 0;
  for (const issue of issues || []) for (const comment of issue.comments || []) {
    if (!recent(comment.createdAt)) continue;
    if (/^(?:<!-- ui-loop-verdict:real -->|Judged real by the UI loop's verdict pass)/.test(comment.body || '')) real++;
    if (/^(?:<!-- ui-loop-verdict:false-positive -->|Closed by the UI loop as a false positive)/.test(comment.body || '')) falsePositive++;
  }
  return {pr, verdicts: {real, falsePositive}};
}
export const fixerLines = card => (card ? ['', `**Fixer and verdicts, last 30 days:** ${card.pr.opened} pull request(s) opened, ${card.pr.merged} merged, ${card.pr.closed} closed unmerged, ${card.pr.open} open · verdict pass: ${card.verdicts.real} real, ${card.verdicts.falsePositive} false positive(s).`] : []);
export function rankingBody(ranked, now = Date.now(), limit = 12, card = [], fixer = null) {
  const rows = ranked.slice(0, limit).map(({issue, priority, score: points}, index) => {
    const at = lastSeen(issue), days = at ? Math.floor((now - Date.parse(at)) / 86400000) : null;
    const age = days === null ? '' : days <= 0 ? 'today' : `${days} d ago${days >= 7 ? ' ⚠️' : ''}`;
    const platform = (issue.labels || []).some(item => (item.name || item) === 'platform:windows') ? 'Windows' : 'Mac';
    const clean = (issue.labels || []).some(item => (item.name || item) === NOT_SEEN) ? ' · clean last run' : '';
    const person = (issue.labels || []).some(item => (item.name || item) === NEEDS_HUMAN) ? '🙋 needs a person · ' : '';
    return `| ${index + 1} | **${priority}** | ${person}#${issue.number} ${String(issue.title || '').replace(/^\[auto-ui\] /, '').replace(/\|/g, '/').slice(0, 80)} | ${platform} | ${points} | ${[lastBuild(issue) ? `\`${lastBuild(issue)}\`` : '?', age].filter(Boolean).join(' · ')}${clean} |`;
  });
  const counts = PRIORITIES.map(band => `${band}: ${ranked.filter(item => item.priority === band).length}`).join(' · ');
  return ['**The open findings, most important first.** Re-ranked after every run.', '', `${counts} · ${ranked.length} open`, '',
    '| # | Priority | Finding | Platform | Score | Last build seen on |', '|---|---|---|---|---|---|', ...(rows.length ? rows : ['| | | nothing open | | | |']),
    '', '**P0** would keep a build from beta or stable · **P1** seen again and again, or high and confirmed · **P2** worth a look · **P3** seen once, or already clean in the latest run. Score = severity × sightings this week (× 2 when a person confirmed it). Within a priority: a wrong result before a dead control before a missing spinner (a crashed test step counts least), the critical path (apply, strategy, activity, setup) first, Mac before Windows. ⚠️ = not seen for 7 days or more. A finding closes after two clean runs of its page, or one when a commit says it fixes it.',
    ...scorecardLines(card), ...fixerLines(fixer), '', '<sub>Written by `desktop/e2e/triage.mjs`. Do not edit by hand.</sub>'].join('\n');
}

// Why an open issue is not ready for a fix ('' = ready): the fixer's rules, in the order they are checked. One place, so the pick and its summary agree.
export const NOT_READY = {
  parked: {why: 'Parked: a person must look (`needs-human`) or it was judged a false positive (`wontfix-auto`)', next: 'Remove the label once it is understood'},
  clean: {why: 'Clean in the latest run (`not-seen-latest`): waiting to close', next: 'Nothing: it closes by itself after another clean run'},
  'pr-open': {why: 'A fix pull request is already open', next: 'Review the pull request: merge it, or close it to let the fixer try again'},
  once: {why: `Seen fewer than ${SIGHTINGS_NEEDED} times this week, and not \`confirmed\` by a person`, next: 'Label it `confirmed` if it is real (`gh issue edit N --add-label confirmed`), or wait for the next sighting'},
  kind: {why: 'A kind the fixer does not take (a crashed test step, a console error)', next: 'Fix it by hand, or let its suite tell what failed'},
  unconfirmed: {why: 'A logic finding (a wrong result, a crash) not confirmed yet', next: 'The verdict pass or a person labels it confirmed; then the fixer takes it'},
};
// A failed suite step that is only a wait running out (a view that stayed hidden, an app that did not go quiet): the verdict pass reads its logs and says whether the product or the test is at fault.
export const TIMEOUT_FAILURE = /Unexpected token '<'|is not valid JSON|ECONNRESET|ETIMEDOUT|fetch failed|Timeout \d+\s?ms exceeded|waitForSelector|waiting for locator|still busy after|did not (?:appear|finish|go quiet) within|budget ran out|over its \d+-minute budget/i;   // the last two: the suite's own budget cut the step short (lib/runner.mjs), never a value
export function notReadyReason(issue, {openBranches = [], now = Date.now()} = {}) {
  const labels = (issue.labels || []).map(label => label.name || label);
  const id = labels.find(name => name.startsWith('fp:'));
  if (issue.state !== 'OPEN' || !labels.includes(LABEL) || !id) return 'not-loop';
  if (labels.includes(NEEDS_HUMAN) || labels.includes(FALSE_POSITIVE)) return 'parked';
  if (labels.includes(NOT_SEEN)) return 'clean';
  if (openBranches.includes(`auto-fix/${id.slice(3)}`)) return 'pr-open';
  // A low finding is not worth an automatic fix (owner, 4 Oct 2026: polish and wording are low value, and most of the loop's pull requests were that); a person's `confirmed` still sends it.
  if (/\*\*LOW\*\*/.test(issue.body || '') && !labels.includes(CONFIRMED)) return 'low-value';
  if (recentSightings(issue, now) < SIGHTINGS_NEEDED && !labels.includes(CONFIRMED)) return 'once';
  const kind = /·\s*([a-z0-9-]+)\s*·/.exec(issue.body || '')?.[1] || '';
  // A wrong result or a crash is fixed only once someone (the verdict pass or a person) said it is real: two sightings of a logic claim prove nothing.
  if (LOGIC_KINDS.includes(kind)) return labels.includes(CONFIRMED) ? '' : 'unconfirmed';
  return FIX_KINDS.includes(kind) ? '' : 'kind';
}

// Which open issue is ready for a fix: seen twice this week (or confirmed by a person), a kind a UI change can fix, not parked, no pull request open already.
// The most critical first (score), then the oldest.
export function pickCandidate(issues, {openBranches = [], now = Date.now()} = {}) {
  return pickCandidates(issues, {openBranches, now, max: 1})[0] || null;
}
// Several at once for the parallel fixer (4 Oct 2026: one fix per run, four runs a day, left confirmed bugs waiting for days). At most one per kind: two fixers
// on the same kind often chase one root cause and collide (#66 and #74 had one cause).
export function pickCandidates(issues, {openBranches = [], now = Date.now(), max = 4} = {}) {
  const ready = issues.filter(issue => notReadyReason(issue, {openBranches, now}) === '');
  ready.sort((a, b) => score(b, now) - score(a, now) || a.number - b.number);
  const kinds = new Set(), out = [];
  for (const issue of ready) {
    const kind = /·\s*([a-z0-9-]+)\s*·/.exec(issue.body || '')?.[1] || '';
    if (kinds.has(kind)) continue;
    kinds.add(kind); out.push(issue);
    if (out.length >= max) break;
  }
  return out;
}

// The fixer's job summary: how many findings are open, which are ready, why each other one was passed over, and the rules.
export function readinessSummary(issues, {openBranches = [], now = Date.now(), candidate = null} = {}) {
  const open = issues.filter(issue => notReadyReason(issue, {openBranches, now}) !== 'not-loop');
  const byReason = {};
  for (const issue of open) (byReason[notReadyReason(issue, {openBranches, now})] ||= []).push(issue);
  const ready = (byReason[''] || []).sort((a, b) => score(b, now) - score(a, now) || a.number - b.number);
  const list = items => items.map(issue => `#${issue.number}`).join(', ');
  const head = candidate
    ? `**Fixing #${candidate.number}** ${candidate.title}${candidate.mode === 'verdict' ? ' (verdict only: judged, not edited)' : ''}`
    : `**Nothing is ready to fix.** ${open.length} open finding(s), none passed the rules below.`;
  const rows = [[{why: 'Ready (most critical first)', next: 'The fixer takes the first one'}, ready], ...Object.keys(NOT_READY).map(key => [NOT_READY[key], byReason[key] || []])]
    .filter(([, items]) => items.length).map(([reason, items]) => `| ${reason.why} | ${items.length} | ${list(items)} | ${reason.next} |`);
  // Nothing picked while findings are open: say plainly what would let the fixer take one now, issue by issue.
  const waiting = byReason.once || [];
  const suggest = !candidate && open.length ? ['**To have one fixed now:**',
    ...(waiting.length ? [`- If ${waiting.length === 1 ? list(waiting) : `one of ${list(waiting)}`} is real, label it \`confirmed\` and run the fixer again: \`gh issue edit ${waiting[0].number} --add-label confirmed && gh workflow run ui-fix.yml\`.`] : []),
    ...((byReason['pr-open'] || []).length ? [`- Review the open fix pull request(s) for ${list(byReason['pr-open'])}.`] : []),
    ...((byReason.parked || []).length ? [`- Look at the parked ${list(byReason.parked)}; remove \`needs-human\` when one is ready for another try.`] : []),
    `- Or lower the bar for every finding: \`SIGHTINGS_NEEDED\` in \`desktop/e2e/lib/triage.mjs\` (now ${SIGHTINGS_NEEDED}; it also decides which findings block a release).`, ''] : [];
  return ['## UI fixer', '', head, '', `${open.length} open finding(s) · ${ready.length} ready`, '',
    '| Status | Count | Issues | To have it picked |', '|---|---|---|---|', ...(rows.length ? rows : ['| No open findings | 0 | | |']), '', ...suggest,
    '<details><summary>The rules</summary>', '',
    `- A finding is ready when it is open, not parked (\`needs-human\`, \`wontfix-auto\`), not clean in the latest run, has no fix pull request open,`,
    `  was seen on at least ${SIGHTINGS_NEEDED} commits in the last 7 days (or a person labelled it \`confirmed\`), and is a kind a UI change can fix.`,
    `- Kinds it fixes: ${FIX_KINDS.join(', ')}; and, once confirmed, ${LOGIC_KINDS.join(', ')} (the engine in src/ and the app's logic in desktop/lib/ too).`,
    '- The most critical ready one goes first: severity (high 3, medium 2, low 1) × sightings this week, doubled by `confirmed`; then the oldest.',
    '- At most 4 automatic fix pull requests wait for review at once; one fix per run.', '', '</details>', ''].join('\n');
}

// A change is only proposed if every file is allowed, there is a test among them, and nothing was deleted from the tests.
export function checkChange(files) {
  const bad = files.filter(file => !allowedPath(file));
  if (bad.length) return {ok: false, why: `edits outside the allowed folders: ${bad.join(', ')}`};
  // A fix comes with a test of its own side: Python with a tests/test_*.py, the window or the app's logic with a desktop/test/*.test.js.
  if (files.some(file => /^src\//.test(file)) && !files.some(file => /^tests\/test_/.test(file))) return {ok: false, why: 'an engine fix must come with a test in tests/'};
  if (files.some(file => /^desktop\/(renderer|lib)\//.test(file)) && !files.some(file => /^desktop\/test\//.test(file))) return {ok: false, why: 'a fix must come with a test'};
  if (!files.some(file => /^(desktop\/test|tests)\//.test(file))) return {ok: false, why: 'a fix must come with a test'};
  return {ok: true, why: ''};
}

// A finding that a person closed as a false positive (`wontfix-auto`) stays closed: the same fingerprint, or the same view and kind with alike words, however the AI words it now.
export const suppressedBy = (finding, issues) => matchExisting(finding, issues.filter(issue => (issue.labels || []).some(item => (item.name || item) === FALSE_POSITIVE)), 0.3, 'CLOSED');


// Which findings of THIS run keep a build away from beta testers: high severity, and either a deterministic layout check or an AI finding that is already a real
// open issue (seen in two runs, or confirmed by a person). One AI sighting is noise often enough that it alone would block a good build every night. A failed suite
// step is not listed: the gate is already red then.
// An AI finding blocks only when it is about the app being WRONG (a false status, a dead control, an error shown), not about how it looks: the review rated a clipped
// brand name "high" in one issue and "medium" for the same defect in the next (#55 and #56 against #57), and a cosmetic defect must not stop a release.
export const BLOCKING_AI_KINDS = ['functionality', 'error-shown'];
export function blockers(findings, issues) {
  return findings.filter(finding => finding.severity === 'high' && finding.source !== 'suite-failure').filter(finding => {
    // A new deterministic truth check blocks only once it is a real open issue (seen twice, or confirmed), like an AI finding: one buggy check must not stop a release.
    if (finding.source === 'layout-check' && finding.kind !== 'wrong-result') return true;
    if (finding.kind === 'wrong-result') { const issue = matchExisting(finding, issues); return !!issue && (sightings(issue) >= SIGHTINGS_NEEDED || (issue.labels || []).some(item => (item.name || item) === CONFIRMED)); }   // deterministic and "severe" only for a sideways-scrolling page, a row hundreds of pixels tall, a broken image
    if (!BLOCKING_AI_KINDS.includes(finding.kind)) return false;
    const issue = matchExisting(finding, issues);
    return !!issue && (sightings(issue) >= SIGHTINGS_NEEDED || (issue.labels || []).some(item => (item.name || item) === CONFIRMED));
  });
}

