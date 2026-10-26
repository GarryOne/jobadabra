// Files the AI code review's findings (code-review.yml) as issues on the same board as the UI loop: label auto-ui, source:code-review, one issue per bug, never twice.
//   node code-review-file.mjs --findings .review/findings.json --range <a>..<b> --run-url <url>      (needs gh and GH_TOKEN)
// Only well-formed findings with a file, a line, a scenario and a failing test are filed: the proof bar of the review (code-review-prompt.md).
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {LABEL, labelFor} from './lib/triage.mjs';

const KINDS = ['functionality', 'crash', 'error-shown', 'security', 'release'];
const SEVERITY = ['high', 'medium', 'low'];
const DOT = {high: '🔴', medium: '🟠', low: '🟡'};
const realGh = args => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 20 * 1024 * 1024});

// The cited place must exist: #109 cited job_alerts.py:453 in a 155-line file, so its link was broken. A file that is not in the checkout drops the finding; a line past the
// end keeps it, without the line (said as not verified). `lines(file)` -> its line count, or 0 when it does not exist.
const countLines = file => { try { return fs.readFileSync(file, 'utf8').split('\n').length; } catch { return 0; } };
export function placed(items, lines = countLines) {
  return items.flatMap(item => { const count = lines(item.file); return !count ? [] : [item.line >= 1 && item.line <= count ? item : {...item, line: null}]; });
}
export function wellFormed(list) {
  return (Array.isArray(list) ? list : []).filter(item => item && typeof item.file === 'string' && item.file && Number.isInteger(item.line) && KINDS.includes(item.kind)
    && SEVERITY.includes(item.severity) && String(item.title || '').trim() && String(item.scenario || '').trim().length >= 20 && String(item.test || '').trim().length >= 10)
    .slice(0, 5);
}
export const reviewId = item => `code-review-${crypto.createHash('sha256').update(`${item.file}|${String(item.title).toLowerCase().trim()}`).digest('hex').slice(0, 10)}`;
const area = file => file.split('/').slice(0, file.startsWith('desktop/') ? 2 : 1).join('/');

export function reviewBody(item, {range, runUrl, repo, sha}) {
  const at = item.line ? `${item.file}:${item.line}` : `${item.file} (line not verified)`;
  const link = repo && sha ? `https://github.com/${repo}/blob/${sha}/${item.file}${item.line ? `#L${item.line}` : ''}` : at;
  return [`${DOT[item.severity]} **${item.severity.toUpperCase()}** · ${item.kind} · found by the AI code review (it read the changes; nothing was run)`, '',
    `> 📍 [\`${at}\`](${link})`, `> 🏷️ Build tested: main @ ${String(sha || '').slice(0, 7)} (code review of ${range})`, `> 🔗 First seen: ${runUrl}`, '',
    '### What was found', item.scenario, '', '### The test that would fail', item.test, '',
    '<sub>A person or the verdict pass should confirm it before a fix: the review read the code, it did not run it.</sub>', '', `<!-- fingerprint: ${reviewId(item)} -->`].join('\n');
}

export function fileReview({findings, range, runUrl, repo = '', sha = '', gh = realGh, lines = countLines}) {
  const items = placed(wellFormed(findings), lines);
  const existing = items.length ? JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '300', '--json', 'number,labels'])) : [];
  const has = id => existing.some(issue => (issue.labels || []).some(label => (label.name || label) === labelFor(id)));
  const filed = [];
  for (const item of items) {
    const id = reviewId(item);
    if (has(id)) continue;
    const labels = [LABEL, labelFor(id), 'source:code-review', `kind:${item.kind}`, `severity:${item.severity}`, `view:${area(item.file)}`.slice(0, 50)];
    for (const label of labels.slice(1)) gh(['label', 'create', label, '--force', '--color', label.startsWith('severity:high') ? 'D93F0B' : 'EDEDED']);
    gh(['issue', 'create', '--title', `[auto-ui] ${area(item.file)}: ${String(item.title).trim()}`.slice(0, 120), '--body', reviewBody(item, {range, runUrl, repo, sha}), '--label', labels.join(',')]);
    filed.push(id);
  }
  return {checked: items.length, filed};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2), option = name => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : ''; };
  let findings = [];
  try { findings = JSON.parse(fs.readFileSync(option('findings'), 'utf8')); } catch { /* none written: nothing to file */ }
  const result = fileReview({findings, range: option('range'), runUrl: option('run-url'), repo: process.env.REPO || '', sha: process.env.SHA || ''});
  let read = [];
  try { read = fs.readFileSync('.review/reviewed.txt', 'utf8').split('\n').map(line => line.trim()).filter(Boolean); } catch { /* not written */ }
  const line = `AI code review: ${read.length} commit(s) read, ${Array.isArray(findings) ? findings.length : 0} finding(s) written, ${result.checked} well-formed, ${result.filed.length} filed (${result.filed.join(', ') || 'none new'}).`;
  console.log(line);
}
