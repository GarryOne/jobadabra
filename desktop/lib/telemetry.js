// Technical reports (on by default; Settings → Advanced turns them off): crashes, failed runs, form issues and a
// daily health line, so problems every user hits can be found and fixed for everyone. Scrubbed here, before
// anything leaves the Mac: no answers, CV, emails, names, phone numbers, keys, file paths or link queries.
// Queued in telemetry-queue.json and sent in batches to the website (POST /report/telemetry); an offline Mac
// loses nothing. The last 20 events stay visible in Settings ("See what's sent"). Design: Notion "📡 Technical
// reports (telemetry) — design".
import crypto from 'node:crypto';
import os from 'node:os';

// Why this run must not report anything to the product, or '' when it may (the user's own switch is checked separately). Test runs of every kind
// are off by construction: CI, the packaged-app smoke tests and the end-to-end journey (JOBADABRA_E2E). 2 Oct 2026: the journey passed
// JOBADABRA_TELEMETRY=0 to mean "off", the app read any non-empty value as "on", and eight test profiles showed up as installs.
export const DEV_BUILD = 'a development build';   // the owner's app run from source is one: what a person presses reaches the site from it (recipes.js siteOffForUser)
export function reportingOff(env = process.env, {packaged = false} = {}) {
  if (env.JOBADABRA_E2E) return 'the end-to-end journey';
  if (env.JOBADABRA_TWIN) return 'a live-test twin';
  if (env.JOBADABRA_SMOKE || env.JOBADABRA_PTY_SMOKE) return 'a smoke test';
  if (env.CI || env.GITHUB_ACTIONS) return 'CI';
  if (!packaged && !sourceRunReports(env)) return DEV_BUILD;
  return '';
}

// Whether this run may exchange FORM LEARNING with the site (lib/recipes.js: fill records, reasons, proposal use, control samples out;
// recipes and wording meanings in), or why not. As reportingOff, except a live-test twin: it fills real forms on real sites with the owner's
// real profile, so its fills are real use and it should fill with what other fills taught (owner, 9 Oct 2026: "Twin form filling I think are
// real data ... we should learn from it and reuse the learning"). Its analytics, crash reports and install attribution stay off (reportingOff).
// The twin is a clone of the owner's folder: it reports under the owner's install id, so it never counts as another install.
export function learningOff(env = process.env, {packaged = false} = {}) {
  if (env.JOBADABRA_TWIN && !env.JOBADABRA_E2E) return '';
  return reportingOff(env, {packaged});
}

// The journey on CI is the one test run that may reach Sentry (tagged environment "e2e", one fixed anonymous id, never your /telemetry store or PostHog):
// a crash during the journey is a real bug and the stack trace helps. A local run reports nothing at all.
export const sentryOnly = (env = process.env) => !!(env.JOBADABRA_E2E && env.GITHUB_ACTIONS);

export const ENDPOINT = 'https://www.jobadabra.top/report/telemetry';
const QUEUE = 'telemetry-queue.json';
const MAX_QUEUE = 500, SHOWN = 20, BATCH = 50;
export const KINDS = ['crash', 'run_failed', 'run_warning', 'form_issue', 'stuck', 'health', 'setup', 'control', 'advice', 'tab', 'search'];   // advice: a recommendation shown / taken / dismissed (renderer/coverage-actions.js)

// Personal or secret data out of any text: keys and tokens, emails, phone numbers, the user's home folder, link
// queries and fragments, long digit runs (IDs, card-like numbers). Then cut to `max` characters.
export function scrub(value, max = 500, home = os.homedir()) {
  let text = String(value ?? '');
  const secrets = [/sk-ant-[\w-]+/g, /\bntn_\w+/g, /\bsecret_\w+/g, /\bgh[pousr]_\w+/g, /github_pat_\w+/g, /GOCSPX-[\w-]+/g,
    /\b\d{6,12}:AA[\w-]{20,}/g, /\bxox[abprs]-[\w-]+/g, /\bBearer\s+[\w.-]+/gi, /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g];
  for (const pattern of secrets) text = text.replace(pattern, '<secret>');
  if (home && home.length > 1) text = text.split(home).join('~');
  text = text.replace(/\/(Users|home)\/[^/\s"']+/g, '/$1/<user>').replace(/[A-Z]:\\Users\\[^\\\s"']+/gi, 'C:\\Users\\<user>');
  text = text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');
  text = text.replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, '$1');
  text = text.replace(/\+?\d[\d ()-]{7,}\d/g, '<number>');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// A run from source (npm start, the e2e harness) stays silent unless JOBADABRA_TELEMETRY asks for reports. "0", "off",
// "false" and "no" mean no: the e2e harness sets '0', and a plain "is it set?" test read that as yes, so every e2e run
// reported itself as a new machine (2 Oct 2026: nine fake installs on /telemetry).
export function sourceRunReports(env = process.env) {
  const value = String(env.JOBADABRA_TELEMETRY ?? '').trim().toLowerCase();
  return value !== '' && !['0', 'off', 'false', 'no'].includes(value);
}

// One event: its kind, its own safe fields (every string scrubbed, shallow), and who/what/when without identity.
export function event(kind, fields, {install, version, platform = process.platform, osVersion = os.release(), now = Date.now()}) {
  const safe = {};
  for (const [key, value] of Object.entries(fields || {}).slice(0, 20)) {
    if (value == null) continue;
    safe[scrub(key, 40)] = typeof value === 'number' || typeof value === 'boolean' ? value
      : Array.isArray(value) ? value.slice(0, 20).map(item => scrub(item, 120)) : scrub(value, key === 'stack' ? 2000 : 500);
  }
  return {kind: KINDS.includes(kind) ? kind : 'crash', at: new Date(now).toISOString(), install, version, platform, os: osVersion, ...safe};
}

export function create(storage, {version, fetcher = globalThis.fetch, endpoint = ENDPOINT, now = () => Date.now(), silent = false} = {}) {
  const enabled = () => !silent && storage.settings().telemetry !== false;   // silent: the object exists so every call site works, but it never records or sends
  const install = () => {
    let id = storage.settings().telemetryId;
    if (!id) { id = crypto.randomUUID(); storage.saveSettings({telemetryId: id}); }
    return id;
  };
  const load = () => { try { return JSON.parse(storage.readText(QUEUE) || '{}'); } catch { return {}; } };
  const save = data => storage.writeText(QUEUE, JSON.stringify(data));
  let sending = false;
  return {
    enabled,
    // Record one event (nothing when the user turned reports off). Never throws.
    record(kind, fields = {}) {
      try {
        if (!enabled()) return null;
        const item = event(kind, fields, {install: install(), version, now: now()});
        const channel = storage.settings().installSource;  // where the install came from (lib/install-source.js); a label, never a person
        if (channel && item.source == null) item.source = channel;
        const data = load();
        data.queue = [...(data.queue || []), item].slice(-MAX_QUEUE);
        data.shown = [item, ...(data.shown || [])].slice(0, SHOWN);
        save(data);
        return item;
      } catch { return null; }
    },
    shown: () => load().shown || [],
    // Positive evidence for the release check (tools/canary_promote.py): each finished pipeline run counted per app
    // version, then taken (and reset) by the daily health line as runsOk / runsFailed since the last line.
    countRun(ok) {
      try {
        if (!enabled()) return;
        const runs = storage.settings().telemetryRuns;
        const mine = runs?.version === version ? runs : {version, ok: 0, failed: 0};
        storage.saveSettings({telemetryRuns: {...mine, [ok ? 'ok' : 'failed']: mine[ok ? 'ok' : 'failed'] + 1}});
      } catch { /* never breaks a run */ }
    },
    takeRuns() {
      const runs = storage.settings().telemetryRuns;
      storage.saveSettings({telemetryRuns: {version, ok: 0, failed: 0}});
      return runs?.version === version ? {runsOk: runs.ok || 0, runsFailed: runs.failed || 0} : {runsOk: 0, runsFailed: 0};
    },
    // Send what's queued, in batches; what the server took is removed. Off: the queue is dropped, nothing sent.
    async flush() {
      if (sending) return 0;
      const data = load();
      if (!enabled()) { if (data.queue?.length) save({...data, queue: []}); return 0; }
      if (!data.queue?.length) return 0;
      sending = true;
      let sent = 0;
      try {
        while (data.queue.length) {
          const batch = data.queue.slice(0, BATCH);
          const response = await fetcher(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({events: batch})});
          if (!response.ok) break;
          data.queue = data.queue.slice(batch.length);
          sent += batch.length;
          save(data);
        }
      } catch { /* offline: kept for the next try */ } finally { sending = false; }
      return sent;
    },
  };
}
