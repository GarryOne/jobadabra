// The Finder's scorecard for the triage-github-open-issues skill (.claude/skills/triage-github-open-issues): per detector, how many findings were real, false (and why), and how often the filed severity
// was wrong; plus the change since the last scorecard. Builds on lib/selfheal-stats.mjs (the same classify(), so /admin/operations/self-healing and this agree). Pure; finder-scorecard.mjs runs it.
import {detectorOf, summarize} from './selfheal-stats.mjs';
import {resolutionOf} from './resolution.mjs';

export const SCORECARD_LABEL = 'finder-scorecard';
// severity.mjs leaves this in the body when a judge changes the filed level, so the filed level is not lost.
export const FILED = /<!-- severity-filed:(high|medium|low) -->/;
const BLOCK = /<!-- scorecard:(\{.*\}) -->/;
const LEVEL = {low: 1, medium: 2, high: 3};
const levelOf = issue => ((issue.labels || []).map(label => label.name || label).find(name => name.startsWith('severity:')) || '').slice(9);

export function scorecard(issues, {now = new Date()} = {}) {
  const {totals} = summarize(issues), groups = {};
  for (const issue of issues) (groups[detectorOf(issue)] ??= []).push(issue);
  const detectors = Object.entries(groups).map(([source, list]) => {
    const row = summarize(list).byDetector[0], causes = {}, severityChanged = {judged: 0, raised: 0, lowered: 0};
    for (const issue of list) {
      const why = resolutionOf(issue);
      if (why.startsWith('fp:') || why === 'by-design') causes[why] = (causes[why] || 0) + 1;
      const filed = FILED.exec(String(issue.body || ''))?.[1], level = levelOf(issue);
      if (filed && level && filed !== level) { severityChanged.judged++; severityChanged[LEVEL[level] > LEVEL[filed] ? 'raised' : 'lowered']++; }
    }
    const real = row.fixed + row.queued, judged = real + row.falsePositive + row.harness;
    return {source, detector: row.detector, filed: row.filed, real, falsePositive: row.falsePositive + row.harness, open: row.open + row.unclear,
      precision: judged ? Math.round(100 * real / judged) : null, causes, severityChanged};
  }).sort((a, b) => b.filed - a.filed);
  // The yield (owner, 9 Oct 2026: "more and more real issues, fewer and fewer false"): real and false findings by the week they were found, this week vs the one before.
  const week = (from, to) => { const list = issues.filter(issue => { const at = Date.parse(issue.createdAt || 0); return at >= now - from * 86400000 && at < now - to * 86400000; });
    const {totals: t} = summarize(list); return {real: t.real, falsePositive: t.falsePositive + t.harness}; };
  const yieldOf = {thisWeek: week(7, 0), lastWeek: week(14, 7)};
  return {at: now.toISOString().slice(0, 10), yield: yieldOf, totals: {filed: totals.filed, real: totals.real, falsePositive: totals.falsePositive + totals.harness, open: totals.unjudged, precision: totals.precision}, detectors};
}

// The previous scorecard, read back from its comment.
export function previousOf(comments = []) {
  for (const comment of [...comments].reverse()) { const match = BLOCK.exec(String(comment.body || '')); if (match) { try { return JSON.parse(match[1]); } catch { /* an edited comment */ } } }
  return null;
}

const delta = (now, was) => (was == null || now == null ? '' : now === was ? ' (=)' : ` (${now > was ? '+' : ''}${now - was})`);
const cell = value => (value == null ? '–' : String(value));

// A comment that reads at a glance: the headline numbers with their change, one row per detector, the false-positive causes; the data rides along in a hidden block.
export function scorecardComment(card, previous = null) {
  const was = source => previous?.detectors?.find(row => row.source === source);
  const rows = card.detectors.map(row => `| ${row.detector} | ${row.filed} | ${row.real} | ${row.falsePositive} | ${row.open} | ${cell(row.precision)}%${delta(row.precision, was(row.source)?.precision)} | ${Object.entries(row.causes).map(([why, n]) => `${why} ${n}`).join(', ') || '–'} | ${row.severityChanged.judged ? `${row.severityChanged.raised}↑ ${row.severityChanged.lowered}↓` : '–'} |`);
  return [
    `### 🎯 Finder scorecard · ${card.at}`,
    ...(card.yield ? [`**This week ${card.yield.thisWeek.real} real · ${card.yield.thisWeek.falsePositive} false** (the week before: ${card.yield.lastWeek.real} real · ${card.yield.lastWeek.falsePositive} false)${card.yield.thisWeek.real < card.yield.lastWeek.real ? ' · ⚠️ fewer real bugs than the week before: find out why before anything else' : ''}`] : []),
    `**Precision ${cell(card.totals.precision)}%${delta(card.totals.precision, previous?.totals?.precision)}** · ${card.totals.real} real of ${card.totals.filed} filed · ${card.totals.falsePositive} false · ${card.totals.open} not judged yet${previous ? ` · since ${previous.at}` : ''}`,
    '',
    '| Detector | Filed | Real | False | Open | Precision | False because | Severity fixed |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    '<sub>Real = fixed or confirmed; False = a false positive or a test mistake (resolution labels, lib/resolution.mjs). Severity fixed = a judge changed the filed level (↑ raised, ↓ lowered).</sub>',
    `<!-- scorecard:${JSON.stringify(card)} -->`,
  ].join('\n');
}
