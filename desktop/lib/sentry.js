// Crash reports to Sentry, without Sentry's SDK: the SDK instruments HTTP and console by default and drags in 58 MB, which is the wrong
// default for an app that promises not to look at your CV, mail or answers. This builds the event itself, so exactly these fields are sent:
// the error's type, scrubbed message and stack frames (file names without folders above the app, function, line), the app version, the
// platform, a random install id, and short scrubbed tags, plus the trail: the last 25 step names ("page: jobs", "apply started") the app
// also tells PostHog, never what is on a page. A beta tester's report can add the scrubbed tail of the run log, only if they switched that on.
// No local variables, no request data, no IP-derived user.
// Native crashes (renderer, GPU, main) go through Electron's own crashReporter to Sentry's minidump endpoint (see startNativeCrashes).
import crypto from 'node:crypto';
import {scrub} from './telemetry.js';

// https://<key>@<host>/<project> -> where to send.
export function parseDsn(dsn) {
  try {
    const url = new URL(String(dsn));
    const project = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!url.username || !project || !/^\d+$/.test(project.split('/').pop())) return null;
    const id = project.split('/').pop(), base = `${url.protocol}//${url.host}/api/${id}`;
    return {key: url.username, project: id, envelope: `${base}/envelope/`, minidump: `${base}/minidump/?sentry_key=${url.username}`,
      auth: `Sentry sentry_version=7, sentry_key=${url.username}, sentry_client=job-pilotto/1`};
  } catch { return null; }
}

// "    at fn (/Users/x/app/lib/a.js:12:3)" / "at /path/a.js:1:2" -> Sentry frames, oldest first. Folders above the app are dropped.
export function frames(stack) {
  const out = [];
  for (const line of String(stack || '').split('\n')) {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+)(?::(\d+))?\)?\s*$/.exec(line);
    if (!match) continue;
    const file = match[2].replace(/^file:\/\//, '');
    const short = file.replace(/^.*?\/(desktop|renderer|lib|pages|src|app\.asar)\//, '$1/').split('/').slice(-4).join('/');
    out.push({function: scrub(match[1] || '?', 80), filename: scrub(short, 120), lineno: Number(match[3]), colno: Number(match[4] || 0),
      in_app: !/node_modules|node:internal/.test(file)});
  }
  return out.reverse().slice(-40);
}

const LEVEL = {crash: 'fatal', run_failed: 'error', stuck: 'error', run_warning: 'warning', fill_error: 'error', extension_error: 'error'};   // extension errors: lib/real-errors.js
export const CAPTURED = Object.keys(LEVEL);
// What makes two reports one problem: the kind and the part of the message that is not a number or an id.
const normal = text => String(text ?? '').replace(/0x[0-9a-f]+|\b[0-9a-f]{8,}\b|[0-9a-f-]{36}/gi, '<id>').replace(/\d+/g, '#').slice(0, 120);

// An end-to-end run (environment e2e) is synthetic monitoring: its reports say which suite made them and whether that suite makes failures on purpose (the spend limit, a hung task),
// so an alert or a fixer can tell the expected from a surprise. Empty for a user's install.
export const e2eTags = (env = process.env) => (env.JOB_PILOTTO_E2E_SUITE ? {suite: env.JOB_PILOTTO_E2E_SUITE, expected: env.JOB_PILOTTO_E2E_EXPECTS_FAILURES ? 'yes' : 'no'} : {});

export function buildEvent(kind, fields = {}, {release = '', environment = 'production', installId = '', platform = process.platform, os = '', now = Date.now(), trail = [], tags = {}} = {}) {
  if (kind === 'extension_error') { fields = extensionFields(fields); trail = []; }
  const message = scrub([fields.message, fields.error, fields.warning, fields.action].find(text => String(text ?? '').trim()) || kind, 300);   // an empty string is no message (Sentry 2C: "run_failed · src.stores call:")
  const event = {
    event_id: crypto.randomBytes(16).toString('hex'), timestamp: now / 1000, platform: 'javascript', level: LEVEL[kind] || 'error',
    release, environment, user: {id: installId}, server_name: undefined,
    tags: {kind, platform, os: String(os).slice(0, 20), ...(fields.job ? {job: scrub(fields.job, 60)} : {}), ...(fields.where ? {where: scrub(fields.where, 40)} : {}),
      ...(fields.host ? {host: scrub(fields.host, 80)} : {}), ...(fields.extVersion ? {extVersion: scrub(fields.extVersion, 20)} : {}),
      ...(fields.timedOut ? {timedOut: 'yes'} : {}), ...tags, ...(kind === 'extension_error' ? {source: 'extension'} : {})},
    fingerprint: [kind, normal(fields.job || fields.where || ''), normal(message)],
    contexts: {runtime: {name: 'electron'}},
    ...(trail.length ? {breadcrumbs: {values: trail.map(item => ({timestamp: item.at / 1000, category: 'step', message: item.message, level: 'info'}))}} : {}),
  };
  const stack = frames(fields.stack);
  if (kind === 'extension_error' || ((kind === 'crash' || kind === 'fill_error') && stack.length)) {
    event.exception = {values: [{type: scrub(fields.type || 'Error', 60), value: message, stacktrace: {frames: stack}}]};
  } else {
    event.message = `${kind}${fields.job ? ` · ${scrub(fields.job, 60)}` : ''}: ${message}`;
    // The last few lines the run printed (already scrubbed by the telemetry module's rules): what it was doing when it stopped.
    if (Array.isArray(fields.tail) && fields.tail.length) event.extra = {tail: fields.tail.slice(-5).map(line => scrub(line, 200))};
  }
  return event;
}

function extensionFields(fields) {
  const type = /^(?:Error|EvalError|RangeError|ReferenceError|SyntaxError|TypeError|URIError|AggregateError)$/.test(fields.type) ? fields.type : 'Error';
  // Why (29 Oct 2026, owner): a page-derived string can appear even in an Error; extension reports carry fixed messages and own filenames only.
  return {type, message: fields.rejection === true ? `Unhandled ${type} rejection` : `Uncaught ${type}`,
    extVersion: /^\d+(?:\.\d+){1,3}$/.test(fields.extVersion) ? fields.extVersion : '',
    stack: String(fields.stack || '').split('\n').filter(line => /^at [\w-]+\.m?js:\d{1,9}:\d{1,9}$/.test(line)).slice(0, 8).join('\n')};
}

// The tester's own run log, scrubbed line by line (same rules as every other field), the last 200 lines and 40 KB at most.
export function logAttachment(lines) {
  const text = (Array.isArray(lines) ? lines : []).slice(-200).map(line => scrub(line, 300)).join('\n').slice(-40_000);
  return text ? {filename: 'run.log', text} : null;
}

export function envelope(event, dsn, attachment = null) {
  const sent = new Date().toISOString();
  const head = `${JSON.stringify({event_id: event.event_id, sent_at: sent, dsn})}\n${JSON.stringify({type: 'event'})}\n${JSON.stringify(event)}\n`;
  return attachment
    ? `${head}${JSON.stringify({type: 'attachment', length: Buffer.byteLength(attachment.text), content_type: 'text/plain', filename: attachment.filename})}\n${attachment.text}\n`
    : head;
}

// capture(kind, fields): fire and forget, never throws. Per problem: extension errors once a minute, others every 10 minutes; at most 30 an hour.
export function create({dsn, release, environment = 'production', installId, platform = process.platform, os = '', tags = {}, enabled = () => true,
  fetcher = globalThis.fetch, now = () => Date.now()} = {}) {
  const target = parseDsn(dsn);
  const seen = new Map(), hour = [], trail = [];
  return {
    active: !!target,
    // note(name, props): remember a step for the next report. Only names the app already sends to PostHog; at most 25 are kept.
    note(name, props = {}) {
      const extra = props.page || props.step || props.how;
      trail.push({at: now(), message: scrub(extra ? `${name}: ${extra}` : name, 80)});
      if (trail.length > 25) trail.shift();
    },
    capture(kind, fields = {}) {
      try {
        if (!target || !enabled(kind, fields) || !CAPTURED.includes(kind)) return false;
        const event = buildEvent(kind, fields, {release, environment, installId, platform, os, now: now(), trail, tags});
        const key = event.fingerprint.join('|');
        const t = now();
        while (hour.length && t - hour[0] > 3600_000) hour.shift();
        // Why (29 Oct 2026, owner): an extension loop must report the same message at most once a minute per install, across worker restarts.
        const cooldown = kind === 'extension_error' ? 60_000 : 600_000;
        if (hour.length >= 30 || (seen.has(key) && t - seen.get(key) < cooldown)) return false;
        seen.set(key, t);
        hour.push(t);
        void Promise.resolve(fetcher(target.envelope, {method: 'POST', headers: {'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': target.auth},
          body: envelope(event, dsn, kind === 'extension_error' ? null : logAttachment(fields.logLines))})).catch(() => {});
        return true;
      } catch { return false; }
    },
  };
}

// Electron's built-in crash reporter, pointed at Sentry's minidump endpoint: native crashes (a renderer that dies, the GPU process, the
// main process) that no JavaScript handler can see. Only the app version and platform ride along; no folder paths (compress, no PII).
export function startNativeCrashes(crashReporter, {dsn, release, installId}) {
  const target = parseDsn(dsn);
  if (!target) return false;
  try {
    crashReporter.start({submitURL: target.minidump, uploadToServer: true, compress: true, extra: {release: String(release || ''), install: String(installId || '')},
      globalExtra: {}, rateLimit: true});
    return true;
  } catch { return false; }
}
