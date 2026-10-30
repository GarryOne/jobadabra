// Keep fingerprint-aware nightly evidence and render drift rates, bars and a lasting-red issue payload.
// Job: serve stored answers
// Invariants: incomplete nights never vote; run retries never replace evidence; prompt changes invalidate only their own votes.
import {BARS, MIN_FACT_NIGHTS, MIN_TEXTS} from './quality-rate.mjs';

// Why (30 Oct 2026, owner, JOB-45): borrow qualityai's exact-fact and prose bars; five nights warm up, two consecutive red dates raise one issue.
const KEEP_NIGHTS = 120;
const sum = (rows, key) => rows.reduce((n, row) => n + row[key], 0);
const pct = (n, d) => d ? `${Math.round(n / d * 1000) / 10}%` : 'n/a';
const previousDay = (a, b) => Date.parse(a) - Date.parse(b) === 86400000;

// Manifest ids include the body hash; a source location stays stable when that prompt changes.
const identity = entry => entry.source.file && Array.isArray(entry.source.path) ? JSON.stringify([entry.kind, entry.source.file, entry.source.path]) : entry.id;

function observations(report, identities) {
  return report.results.filter(result => !result.error && !result.invalidReply).map(result => {
    const checks = result.checks, fields = checks.flatMap(check => check.fields);
    return {id: identities[result.id], promptId: result.id, fingerprint: result.bodySha256, factsTotal: checks.reduce((n, check) => n + check.exact.checked, 0),
      factsExact: checks.reduce((n, check) => n + check.exact.same, 0),
      judged: fields.filter(field => field.judgment).length, flagged: fields.filter(field => field.judgment?.verdict === 'different').length};
  });
}

function daily(nights) {
  const days = new Set();
  return nights.filter(night => { if (days.has(night.day)) return false; days.add(night.day); return true; });
}

function rates(nights, fingerprints) {
  const eligible = daily(nights).filter(night => night.complete).map(night => {
    const rows = night.observations.filter(row => row.fingerprint === fingerprints[row.id]);
    return {...night, factsTotal: sum(rows, 'factsTotal'), factsExact: sum(rows, 'factsExact'), judged: sum(rows, 'judged'), flagged: sum(rows, 'flagged')};
  }).filter(night => night.factsTotal || night.judged);
  const facts = eligible.filter(night => night.factsTotal).slice(0, BARS.factNights);
  const judged = [];
  for (const night of eligible) { if (sum(judged, 'judged') >= BARS.texts) break; if (night.judged) judged.push(night); }
  return {nights: eligible.length, facts: {nights: facts.length, exact: sum(facts, 'factsExact'), total: sum(facts, 'factsTotal')},
    flags: {texts: sum(judged, 'judged'), flagged: sum(judged, 'flagged')}};
}

function verdict(rate, complete, reason) {
  const problems = [];
  if (rate.facts.total && rate.facts.exact / rate.facts.total < BARS.facts) problems.push('exact agreement below 99.5%');
  if (rate.flags.texts && rate.flags.flagged / rate.flags.texts > BARS.flagged) problems.push('judged-different above 10%');
  const warmup = rate.nights < MIN_FACT_NIGHTS;
  const broken = (rate.facts.nights >= MIN_FACT_NIGHTS && rate.facts.total && rate.facts.exact / rate.facts.total < BARS.facts)
    || (rate.flags.texts >= MIN_TEXTS && rate.flags.flagged / rate.flags.texts > BARS.flagged);
  const state = !complete ? 'incomplete' : warmup ? 'warning' : broken ? 'red' : 'healthy';
  const line = `exact ${pct(rate.facts.exact, rate.facts.total)} (${rate.facts.exact}/${rate.facts.total}, ${rate.facts.nights} nights; bar ≥ ${BARS.facts * 100}%), `
    + `prose different ${pct(rate.flags.flagged, rate.flags.texts)} (${rate.flags.flagged}/${rate.flags.texts}; bar ≤ ${BARS.flagged * 100}%, judged from ${MIN_TEXTS} texts)`;
  return {state, warmup, problems, line: `${state}: ${line}${warmup ? '; warm-up: fewer than 5 nights' : ''}${reason ? `; ${reason}` : ''}`};
}

function changes(report, resetIds, identities) {
  return report.results.filter(result => !resetIds.has(result.id)).flatMap(result => result.checks.filter(check => check.status === 'changed'
    || check.fields.some(field => field.judgment?.verdict === 'different' || ['numeric-delta', 'missing'].includes(field.status)
      || (field.status === 'needs-judge' && !field.judgment && JSON.stringify(field.stored) !== JSON.stringify(field.live)))).map(check => ({promptId: result.id, identity: identities[result.id], fingerprint: result.bodySha256, ...check})));
}

function historicalChanges(nights) {
  const found = new Map();
  let factNights = 0, judged = 0;
  for (const night of daily(nights).filter(night => night.complete)) {
    const facts = sum(night.observations, 'factsTotal'), texts = sum(night.observations, 'judged');
    if ((facts && factNights < BARS.factNights) || (texts && judged < BARS.texts)) {
      for (const row of night.changedAnswers) {
        const key = `${row.promptId}/${row.key}`;
        if (!found.has(key)) found.set(key, row);
      }
    }
    if (facts) factNights++;
    judged += texts;
  }
  return [...found.values()];
}

function changedText(changed) {
  if (!changed.length) return 'No changed answers in this sample; the historical rate still breaks a bar.';
  return changed.map(check => `- ${check.kind}/${check.key} (prompt ${check.promptId})\n  - stored: ${JSON.stringify(check.stored)}\n  - live: ${JSON.stringify(check.live)}\n`
    + check.fields.filter(field => field.judgment).map(field => `  - ${field.path}: ${field.judgment.verdict} — ${field.judgment.reason}\n`).join('')).join('\n');
}

/** Add one immutable run, reset changed-prompt votes, evaluate bars and prepare a single deduplicated-issue payload after lasting red. */
export function finalizeNight(report, history = [], {runId, day} = {}) {
  if (!runId || !/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('history needs runId and UTC day');
  const prompts = report.prompts || report.sample;
  const identities = Object.fromEntries(prompts.map(entry => [entry.id, identity(entry)]));
  const fingerprints = Object.fromEntries(prompts.map(entry => [identity(entry), entry.source.sha256]));
  const known = Object.assign({}, ...[...history].reverse().map(night => night.fingerprints));
  const promptDrift = prompts.filter(entry => known[identity(entry)] && known[identity(entry)] !== entry.source.sha256)
    .map(entry => ({id: entry.id, identity: identity(entry), previous: known[identity(entry)], current: entry.source.sha256}));
  const allFingerprints = report.prompts ? fingerprints : {...known, ...fingerprints};
  const existing = history.find(night => String(night.runId) === String(runId));
  const night = existing || {runId: String(runId), day, complete: report.complete, incompleteReason: report.incompleteReason,
    fingerprints: allFingerprints, observations: observations(report, identities), changedAnswers: changes(report, new Set(promptDrift.map(item => item.id)), identities)};
  const next = existing ? history : [night, ...history].slice(0, KEEP_NIGHTS);
  // Remove stale prompt observations permanently: a fingerprint changing back must not resurrect its old model evidence.
  const cleaned = next.map(item => ({...item, observations: item.observations.filter(row => row.fingerprint === allFingerprints[row.id]),
    changedAnswers: (item.changedAnswers || []).filter(row => row.fingerprint === allFingerprints[row.identity])}));
  const rate = rates(cleaned, allFingerprints), decision = verdict(rate, report.complete && night.complete, report.incompleteReason || night.incompleteReason);
  const current = cleaned.find(item => String(item.runId) === String(runId));
  current.verdict = existing?.verdict || decision.state;
  const nights = daily(cleaned), at = nights.findIndex(item => String(item.runId) === String(runId)), previous = nights[at + 1];
  const changedAnswers = changes(report, new Set(promptDrift.map(item => item.id)), identities);
  const lasting = at === 0 && decision.state === 'red' && previous?.verdict === 'red' && previousDay(day, previous.day);
  const rateChanges = historicalChanges(cleaned);
  const details = changedText(rateChanges);
  const issueDetails = details.length > 54000 ? `${details.slice(0, 54000)}\n… Remaining changed answers are in the report artifact.` : details;
  const issue = lasting ? {title: 'Stored AI answers drift from the live model', body: `${decision.line}\n\nTwo consecutive red nights: ${previous.day}, ${day}. Run ${runId}.\n\nChanged answers\n\n${issueDetails}\n\nPrompt drift: ${promptDrift.map(item => item.id).join(', ') || 'none'}. Stored answers were not rewritten.`} : null;
  const notice = `${report.callsUsed.app} prompts, ${report.callsUsed.judge} judges, ${report.callsUsed.total}/24 attempts; ${decision.line}`;
  const markdown = `# Stored AI answer drift — ${day}\n\n${notice}\n\nPrompt drift: ${promptDrift.map(item => item.id).join(', ') || 'none'}.\n\nChanged answers\n\n${details}\n`;
  return {history: cleaned, report: {...report, runId: String(runId), day, promptDrift, changedAnswers, rateChanges, rates: rate, verdict: decision, issue, notice, markdown}};
}
