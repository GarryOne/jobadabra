// Judge BEFORE filing (5 Oct 2026): the verdict pass used to read a finding only after its issue was open, so every false positive still cost an issue, a
// notification and a place in the statistics. Now the run's NEW findings (at most PREJUDGE_MAX) are judged first, in one Claude session: `false-positive` and
// `harness` are never filed (listed in the run's log and remembered in the pinned noise register, so the same noise is not judged again), `real` is filed
// already `confirmed`, `needs-human` is filed parked. A finding over the cap, or a run without AI, is filed as before and judged later (ui-verdict.yml). Pure.
import {checkEvidence, parse, verdictComment} from './verdict-comment.mjs';
import {FALSE_POSITIVE, labelFor} from './triage.mjs';
import {matchLearned} from './signatures.mjs';

export const PREJUDGE_MAX = 3;   // per run; four runs a day = at most 12 judgements a day
export const NOISE_WORDS = ['false-positive', 'harness'];
export const REGISTER_LABEL = 'noise-register';
export const REGISTER_KEEP = 300;

// Which new findings are worth a judgement: every one, a failed step too. Until 6 Oct 2026 a plain failed step was "the suite's own judgement" and filed as it was; 14 of the
// 25 filed were the test's mistake (a fault that never fired, a read before Notion listed a new page, a look while the page was still loading), each read and closed by hand,
// and the detector breaker could not trip on them (too few judged outcomes). Now the judge reads the step's logs first (ui-verdict-prompt.md).
// A finding that is the harness's own mistake by its signature, never a product bug (5 Oct 2026: 11 of the first 47 findings were such noise, filed, read and closed by hand): the test
// or the probe lost its page, or the recall benchmark's planted broken image leaked into the record. Judged `harness` without a model: no issue, a line in the register.
export const HARNESS_SIGNATURES = [
  {re: /Target page, context or browser has been closed|Target closed|browser has been closed/i, why: 'the test or the probe lost its page (the app was closed or relaunched under the step), so the step failed without a product fault: the same signature closed #84'},
  {re: /nonexistent-recall-plant/i, why: 'the recall benchmark\'s planted broken image leaked into the journey\'s record: it is the harness\'s own bug, not the app\'s (#116, #117)'},
];
export const signatureVerdict = (finding, learned = []) => {
  const text = `${finding.title || ''}\n${finding.detail || ''}`;
  const hit = HARNESS_SIGNATURES.find(({re}) => re.test(text));
  if (hit) return `harness\nWhy: ${hit.why}.`;
  const taught = matchLearned(finding, learned);   // a mistake the loop learned from three closures (lib/signatures.mjs)
  return taught ? `harness\nWhy: ${taught.why}.` : '';
};
// `learned`: the signatures the loop taught itself (a known test mistake needs no model). A tripped detector (lib/breaker.mjs) still matters in triage.mjs: what it finds is held unjudged.
export const judgeable = (finding, {learned = []} = {}) => !signatureVerdict(finding, learned);
// The most severe first, so the cap never leaves a high finding unjudged for a medium one.
export function pendingOf(findings, max = PREJUDGE_MAX, options = {}) {
  const rank = {high: 0, medium: 1, low: 2};
  return findings.filter(finding => judgeable(finding, options)).sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3)).slice(0, max)
    .map(item => ({id: item.id, view: item.view, kind: item.kind, severity: item.severity, source: item.source, title: item.title, detail: item.detail,
      impact: item.impact || '', workaround: item.workaround || '', screenshot: item.screenshot || '', logs: item.source === 'suite-failure' ? logFiles(item) : [], also: item.also || []}));
}

// A failed step's own logs, as files the judge reads (the run's artifacts keep them next to its screenshot): the engine's and the app's.
export const logFiles = finding => finding.dir ? ['engine.log', 'app.log'].map(name => `${finding.dir}/logs/${name}`) : [];

// The one prompt for the session: the verdict pass's own rules, then every finding with the picture to open, and the answer's shape.
export function prejudgePrompt(pending, base) {
  const blocks = pending.map(item => [`## ${item.id}`, `Detector: ${item.source} · kind: ${item.kind} · severity: ${item.severity} · page: ${item.view}`, `Title: ${item.title}`, `What was found: ${item.detail}`,
    ...(item.impact ? [`Why it matters (the detector's words): ${item.impact}`] : []), ...(item.screenshot ? [`Screenshot: ${item.screenshot} (open it with Read)`] : ['Screenshot: none']),
    ...(item.logs?.length ? [`Logs: ${item.logs.join(', ')} (Read them before the screenshot: did the step's own setup take effect?)`] : []),
    ...(item.also?.length ? [`Failed after it (probably consequences): ${item.also.slice(0, 5).join('; ')}`] : [])].join('\n'));
  return `${base}\n\n---\nTHIS RUN: you judge ${pending.length} NEW finding(s) BEFORE any issue is opened, in one go (about 8 turns each). Each is a section below; its screenshot is a file to Read.\n` +
    'Write ONE file, .heal/verdicts.md: for every finding a section `## <its id>` (exactly the id below), then the verdict word on its own line, then `Why:` and, for needs-human, `Check:`, as described above.\n\n' + blocks.join('\n\n');
}

// .heal/verdicts.md -> {id: raw verdict text}; a `real` whose cited code does not exist becomes needs-human (checkEvidence). Unknown ids are ignored.
export function parseVerdicts(text, ids, lines = () => 1) {
  const out = {};
  for (const part of String(text || '').split(/^## /m).slice(1)) {
    const [head, ...rest] = part.split('\n');
    const id = head.trim();
    if (!ids.includes(id)) continue;
    let raw = rest.join('\n').trim();
    const {word, note} = checkEvidence(raw, lines);
    if (note) raw = `${word}\n${raw.split('\n').slice(1).join('\n').trim()}\nCheck: ${note}`;
    out[id] = raw;
  }
  return out;
}
export const wordOf = raw => { const {word} = parse(raw); return ['real', 'false-positive', 'harness', 'needs-human'].includes(word) ? word : 'needs-human'; };

// The noise register: one pinned issue whose body keeps what was judged noise before filing, as JSON, so the next run drops the same finding without a judgement.
const BLOCK = /```json\n([\s\S]*?)\n```/;
export function registerEntries(body) { try { const list = JSON.parse(BLOCK.exec(String(body || ''))?.[1] || '[]'); return Array.isArray(list) ? list : []; } catch { return []; } }
export function registerBody(entries) {
  const kept = entries.slice(-REGISTER_KEEP);
  const rows = kept.slice(-15).reverse().map(item => `| ${item.date} | ${item.view} | ${String(item.title).replace(/\|/g, '/').slice(0, 70)} | ${item.word} | ${String(item.why).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 140)} |`);
  return ['**Findings judged noise BEFORE an issue was opened** (the verdict pass, `lib/prejudge.mjs`). The next runs drop the same finding without a judgement. To file one after all, delete its entry below.', '',
    `${kept.length} remembered · the latest ${rows.length}:`, '', '| Date | Page | Finding | Verdict | Why |', '|---|---|---|---|---|', ...rows, '',
    '<details><summary>The register (read by the loop: keep it valid JSON)</summary>', '', '```json', JSON.stringify(kept, null, 0), '```', '', '</details>'].join('\n');
}
// Register entries as the closed issues they would have been: a person's rejection for the loop's own matching (same page and kind, alike words), and a
// false positive (or harness) OF ITS DETECTOR for the numbers: the noise breaker, the precision on /self-heal and the weekly self-review's lessons. Without this,
// noise judged before filing vanished from every place that measures noise (5 Oct 2026): the breaker could never trip again.
export const REGISTER_LIST = ['issue', 'list', '--label', REGISTER_LABEL, '--state', 'open', '--limit', '1', '--json', 'body'];
export const asIssues = entries => entries.map(item => {
  const at = `${item.date || '1970-01-01'}T12:00:00Z`, word = item.word === 'harness' ? 'harness' : 'false-positive';
  return {number: 0, prejudged: true, state: 'CLOSED', stateReason: 'NOT_PLANNED', createdAt: at, closedAt: at, title: `[auto-ui] ${item.view}: ${item.title}`,
    body: `**MEDIUM** · ${item.kind} · found by the register\n\n### What was found\n${item.detail || ''}\n`,
    labels: [{name: 'auto-ui'}, {name: FALSE_POSITIVE}, {name: labelFor(item.id)}, {name: `source:${item.source || 'other'}`}, {name: `kind:${item.kind}`}, ...(word === 'harness' ? [{name: 'harness'}] : [])],
    comments: [{body: verdictComment(`${word}\nWhy: ${item.why || ''}`), createdAt: at, author: {login: 'github-actions'}}]};
});
export const entryOf = (finding, raw, date) => ({id: finding.id, view: finding.view, kind: finding.kind, source: finding.source, title: String(finding.title).slice(0, 120), detail: String(finding.detail || '').slice(0, 300),
  word: wordOf(raw), why: parse(raw).why.slice(0, 300), date});
