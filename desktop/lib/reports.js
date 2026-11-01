// "Help improve Jobadabra": when a fill leaves a field for a mechanical reason (a widget the extension couldn't
// operate), send the form STRUCTURE (site, labels, types, options, reason, extension version, and the field's HTML
// snapshot, scrubbed in the page by extension/page/snapshot.js and again by the Worker) to the project's Worker,
// which opens an issue for the daily fixer. Never answers or personal data. Part of the technical reports:
// on unless the user turned them off (Settings → Advanced, settings.telemetry); each site + field is reported once
// (once more when a snapshot exists for a field reported before snapshots, so its issue gets one), and once more on each newer extension build
// that still fails on it (20 Oct 2026: a field once reported was never heard of again, so a fix could not be told from a field nobody tried).
import {read as keychainRead} from './keychain.js';

// The owner's app signs its reports (trusted → the daily fixer takes them); the token is in the app's secrets
// or, on the owner's Mac, the Keychain item job-pilotto.report.token. Without one, reports wait in triage.
export function reportToken(storage) {
  const saved = storage.secret('REPORT_TOKEN');
  if (saved || process.platform !== 'darwin') return saved;
  return keychainRead('job-pilotto.report.token') || '';   // a test run or a twin reads none of the owner's (lib/keychain.js)
}

export const ENDPOINT = process.env.JOB_PILOTTO_REPORT_URL || 'https://www.jobpilotto.top/report/fill-failure';
// The menu reasons are extension/menu-reason.js MENU_REASONS (what the pick observed) and the older fixed one; test/menu-reason-copies.test.js keeps them equal.
export const MECHANICAL = ['dropdown not clicked', 'dropdown clicked, but its menu did not open', 'dropdown clicked, but no option matched',
  'dropdown option clicked, but not selected', 'dropdown selected, but the reader cannot see it', 'dropdown clicked, but it selected another choice', 'dropdown that opens only on a real click',
  'answer given, but the field did not take it', 'question text not found on the page',
  'question on the page not read'];
const SNAPPED = '#snapshot';  // reportedFailures entry "<label key> #snapshot": reported with its snapshot
const AT = '@';               // reportedFailures entry "<label key> @<build>": reported from that extension build

// Is build `build` later than `than`? The same rule as the Worker's (app-core/src/report.js newer; test/reports-build.test.js keeps them equal).
export function newer(build, than) {
  const parts = text => { const m = /^(\d+(?:\.\d+)*)/.exec(String(text || '')); return m ? m[1].split('.').map(Number) : null; };
  const mine = parts(build), theirs = parts(than);
  if (!mine) return false;
  if (!theirs) return true;
  if (mine.length < theirs.length) return false;
  for (let i = 0; i < mine.length; i++) { const a = mine[i], b = theirs[i] ?? 0; if (a !== b) return a > b; }
  return false;
}

// The build a report names. A development copy (Chrome loads the checkout's extension/) says only the manifest's base ("0.9"); it runs the
// checkout's code, whose stamped version the app knows (server-env.js latestExtension), so the report names that one, marked "-dev".
export function buildOf(version, latest = '') {
  const named = String(version || '');
  return /^\d+\.\d+\.\d+/.test(named) || !/^\d+\.\d+\.\d+/.test(String(latest || '')) ? named : `${latest}-dev`;
}
const key = label => String(label || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function build(run, reported = {}, {latest = ''} = {}) {
  let site = '';
  try { site = new URL(run.url).hostname; } catch { return null; }
  const done = new Set(reported[site] || []);
  const version = buildOf(run.debug?.version, latest);
  // Reported before from an older build (or before builds were kept): this newer build still fails on it, so it is news again.
  const builds = label => [...done].filter(entry => entry.startsWith(`${key(label)} ${AT}`)).map(entry => entry.slice(key(label).length + 2));
  const newBuild = label => done.has(key(label)) && builds(label).every(old => newer(version, old));
  const byLabel = new Map((run.debug?.form || []).map(f => [key(f.label), f]));
  const snapshotOf = label => run.snapshots?.[label] || null;
  // A clicked dropdown's reason ends with its time ("… no option matched (1.5 s)"): without it, it is the mechanical one.
  const reasonOf = f => String(f.reason || '').replace(/\s*\([\d.]+ s\)$/, '');
  const fields = (run.trace || []).filter(f => MECHANICAL.some(reason => reasonOf(f).startsWith(reason)) && (newBuild(f.label) || (!done.has(`${key(f.label)} ${SNAPPED}`) &&
    !(done.has(key(f.label)) && !snapshotOf(f.label))))).map(f => ({
    label: f.label, type: f.type || byLabel.get(key(f.label))?.type || '', required: !!f.required, reason: reasonOf(f),
    options: (byLabel.get(key(f.label))?.options || []).slice(0, 30), ...(snapshotOf(f.label) ? {snapshot: snapshotOf(f.label)} : {})}));
  return fields.length ? {site, version, fields} : null;
}

export async function send(storage, run, fetcher = globalThis.fetch, onSent = null, {latest = ''} = {}) {
  const settings = storage.settings();
  if (settings.telemetry === false) return null;
  const report = build(run, settings.reportedFailures || {}, {latest});
  if (!report) return null;
  const token = reportToken(storage);
  const response = await fetcher(ENDPOINT, {method: 'POST', body: JSON.stringify(report),
    headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}});
  if (!response.ok) throw new Error(`report not sent: ${response.status}`);
  onSent?.('fill report → /report/fill-failure', report);
  const reported = settings.reportedFailures || {};
  storage.saveSettings({reportedFailures: {...reported, [report.site]: [...new Set([...(reported[report.site] || []), ...report.fields.flatMap(f => [key(f.label), ...(report.version ? [`${key(f.label)} ${AT}${report.version}`] : []), ...(f.snapshot ? [`${key(f.label)} ${SNAPPED}`] : [])])])]}});
  return report;
}
