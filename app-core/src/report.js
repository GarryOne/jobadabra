// Fill-failure reports from the Jobadabra app: form STRUCTURE only (site, field labels, types, options, why a
// field couldn't be filled, extension version, and a scrubbed HTML snapshot of the field for replay tests: see
// snapshot.js, which scrubs it again here); never answers or personal data. A report signed with
// REPORT_TOKEN (the owner's app) is trusted and queued for the daily fixer; anything else lands as triage and
// waits for the owner. The Worker only starts the intake workflow on the public repo (existing GITHUB_TOKEN).
import { snapshotFromReport } from './snapshot.js';

const MECHANICAL = [   // the menu reasons: extension/menu-reason.js (desktop/test/menu-reason-copies.test.js keeps them equal)
  'dropdown not clicked', 'dropdown clicked, but its menu did not open', 'dropdown clicked, but no option matched',
  'dropdown option clicked, but not selected', 'dropdown selected, but the reader cannot see it', 'dropdown clicked, but it selected another choice', 'dropdown that opens only on a real click',
  'answer given, but the field did not take it',
  'question text not found on the page',
  'question on the page not read',
];
const READING = /^question (on the page not read|text not found)/;
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// All snapshots of one report together stay under this, so the intake workflow's input (64 KB) always fits.
export const SNAPSHOTS_MAX = 32 * 1024;

export function sanitize(report) {
  const site = text(report.site, 80).toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(site)) return null;
  let room = SNAPSHOTS_MAX;
  const fields = (Array.isArray(report.fields) ? report.fields : []).slice(0, 20)
    .filter((f) => MECHANICAL.some((reason) => String(f.reason || '').startsWith(reason)))
    .map((f) => {
      const field = { label: text(f.label, 120), type: text(f.type, 30), required: !!f.required, reason: f.reason,
        options: (Array.isArray(f.options) ? f.options : []).slice(0, 30).map((o) => text(o, 60)) };
      const snapshot = f.snapshot && typeof f.snapshot === 'object' ? snapshotFromReport(f.snapshot) : '';
      if (snapshot && snapshot.length <= room) { field.snapshot = snapshot; room -= snapshot.length; }
      return field;
    });
  if (!fields.length) return null;
  return { site, version: text(report.version, 20), fields };
}

// Untrusted reports (anyone can POST) are limited per sender per day. Every report is counted by failure (site + fields);
// the intake workflow (an issue) starts only when it recurs (ISSUE_MIN_SENDERS / ISSUE_MIN_REPORTS), once a week per failure.
// Kept in the site's KV (WAITLIST, keys "report:…", expiring); without it (the bot's worker) every report dispatches.
export const PER_SENDER_PER_DAY = 10;
const TWO_WEEKS = 14 * 24 * 3600;
// An issue is opened only for a failure that recurs: reported by this many different senders, or this many times in all. One
// report is data, not a ticket (2 Oct 2026: 17 single-field issues piled up before the self-improving system could judge them).
export const ISSUE_MIN_SENDERS = 3, ISSUE_MIN_REPORTS = 10;
const SENDERS_KEPT = 20, FIELDS_KEPT = 60;

// Each FIELD is one failure (site + question + cause), counted on its own: the same field reported beside other fields is the same
// failure (20 Oct 2026: 8 of 40 private issues were duplicates of that kind). One KV record per site holds its fields' counts.
const words = (value) => String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const fieldKey = (field) => `${words(field.label)}|${words(field.reason)}`;

// Is build `build` later than `than`? "0.9.460" > "0.9.448"; "0.9.461-dev" counts as 0.9.461; anything beats none; an unstamped copy
// ("0.9", the checkout loaded as is) is no later than a stamped 0.9.x. The private triage compares the same way (triage/triage.py newer).
export function newer(build, than) {
  const parts = (text) => { const m = /^(\d+(?:\.\d+)*)/.exec(String(text || '')); return m ? m[1].split('.').map(Number) : null; };
  const mine = parts(build), theirs = parts(than);
  if (!mine) return false;
  if (!theirs) return true;
  if (mine.length < theirs.length) return false;
  for (let i = 0; i < mine.length; i++) { const a = mine[i], b = theirs[i] ?? 0; if (a !== b) return a > b; }
  return false;
}

export async function handleReport(request, env, dispatch, now = Date.now()) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const report = sanitize(await request.json().catch(() => ({})));
  if (!report) return Response.json({ ok: false, error: 'no mechanical failures in the report' }, { status: 400 });
  const trusted = !!env.REPORT_TOKEN && request.headers.get('Authorization') === `Bearer ${env.REPORT_TOKEN}`;
  const kv = env.WAITLIST;
  if (!trusted && kv) {
    const sender = request.headers.get('CF-Connecting-IP') || 'unknown';
    const countKey = `report:sender:${sender}:${new Date(now).toISOString().slice(0, 10)}`;
    const count = Number(await kv.get(countKey)) || 0;
    if (count >= PER_SENDER_PER_DAY) return Response.json({ ok: false, error: 'too many reports today' }, { status: 429 });
    await kv.put(countKey, String(count + 1), { expirationTtl: 2 * 24 * 3600 });
  }
  if (kv) {
    // Counted per field, for everyone: distinct senders and total reports. Passed on when it recurs, and again only from a newer build.
    const key = `report:site:${report.site}`;
    const who = trusted ? 'owner' : (request.headers.get('CF-Connecting-IP') || 'unknown');
    const record = JSON.parse((await kv.get(key)) || '{"fields":{}}');
    const build = report.version || '';
    const due = [];
    let counted = 0, senders = 0;
    for (const field of report.fields) {
      const seen = record.fields[fieldKey(field)] || { senders: [], n: 0, sent: null };
      seen.n += 1;
      if (!seen.senders.includes(who) && seen.senders.length < SENDERS_KEPT) seen.senders.push(who);
      // On first sight: the owner's own app (trusted: it is how the owner tests a new board) and a required question the
      // reader did not read (a whole question missed on every install, not one widget's quirk). Others wait until they recur.
      const recurs = trusted || READING.test(field.reason) || seen.senders.length >= ISSUE_MIN_SENDERS || seen.n >= ISSUE_MIN_REPORTS;
      if (recurs && (seen.sent === null || newer(build, seen.sent))) { seen.sent = build; due.push(field); }
      record.fields[fieldKey(field)] = seen;
      counted = Math.max(counted, seen.n);
      senders = Math.max(senders, seen.senders.length);
    }
    const kept = Object.entries(record.fields);
    if (kept.length > FIELDS_KEPT) record.fields = Object.fromEntries(kept.slice(-FIELDS_KEPT));
    await kv.put(key, JSON.stringify(record), { expirationTtl: TWO_WEEKS });
    if (!due.length) return Response.json({ ok: true, trusted, counted, senders, issue: false });
    await dispatch(env, { report: JSON.stringify({ ...report, fields: due }), trusted: String(trusted) }, 'fill-failure-intake.yml');
    return Response.json({ ok: true, trusted, issue: true });
  }
  await dispatch(env, { report: JSON.stringify(report), trusted: String(trusted) }, 'fill-failure-intake.yml');
  return Response.json({ ok: true, trusted });
}
