// The app's reports at start-up (moved out of main.js's start, 8 Oct 2026): technical reports, crash reports (Sentry) and usage events (PostHog): only an installed
// build, only with Technical reports on, only where config/analytics.json names. Also the run-end events (a failed or warned run), the form issues and the daily
// health line. The reporter objects stay main.js's (they are read there): they are set through setters. Guards: the telemetry, sentry, analytics and health tests in desktop/test.
import * as analyticsConfig from './analytics-config.js';
import * as analyticsLib from './analytics.js';
import * as engineLog from './engine-log.js';
import * as installSource from './install-source.js';
import * as pipeline from './pipeline.js';
import * as recipesLib from './recipes.js';
import * as sentryLib from './sentry.js';
import * as telegramLib from './telegram.js';
import {createWatcher} from './real-errors.js';
import * as server from './server.js';
import * as telemetryLib from './telemetry.js';
import {onSearchDone, reportSearch} from './search-report.js';
import os from 'node:os';
import {installId as telemetryInstallId} from './app-feedback.js';
import {log as appLog} from './log.js';
import * as review from './review.js';
import * as terminals from './terminals.js';
import {startTracking} from './tab-expect.js';
import {causedByPlant} from './planted.js';

// What a run that did not end with 0 reports as failed, or null for a run stopped from outside (no exit code, not the app's watchdog: the
// person's Stop, quitting the app): 20 Oct 2026, such runs were reported as failed with their last ordinary line as the "error"
// ("Enriched 100 of 100 job(s); 0 failed", "Shared 0 employer feeds…"). Guard: test/telemetry-run-end.test.js.
export function runFailure({code, timedOut, tail = [], errorKind = ''}) {
  if (code === null && !timedOut) return null;
  const error = timedOut ? `stopped by the app: ${timedOut}` : [...tail].reverse().find(line => /error|exception|traceback|failed|refused/i.test(line)) || tail.at(-1) || errorKind || `exit ${code}, no error line`;   // errorKind: a run whose output is private (a store call) has no tail (Sentry 2C)
  return {error, ...(timedOut ? {timedOut} : {}), cutOff: /cut off|max_tokens|Unterminated string/i.test(tail.join(' '))};
}

export function registerTelemetryHandlers(ctx) {
  const {DEMO, app, crashReporter, healthOnce, storage, testerLogsOn, testerOn, track, trackSetup, setTelemetry, setTrail, setAnalytics} = ctx;
  let telemetry = null, analytics = null, staleWarned = '';   // main.js keeps telemetry, trail and analytics too (track() reads them): set through the setters
  let trail = null;
  const quiet = DEMO ? 'demo mode' : telemetryLib.reportingOff(process.env, {packaged: app.isPackaged});
  // The recipe/meanings exchange (lib/recipes.js) follows learningOff: the same as `quiet`, except a live-test twin learns and shares (telemetry.js).
  const learning = DEMO ? 'demo mode' : telemetryLib.learningOff(process.env, {packaged: app.isPackaged});
  recipesLib.setSiteOff(learning);
  appLog('telemetry', learning ? `form learning with the site is off: ${learning}` : 'form learning with the site is on');   // the live twin loop reads it (9 Oct 2026)
  const sentryOnly = telemetryLib.sentryOnly(process.env);   // the journey on CI: Sentry (environment e2e, id "e2e") yes; the store and PostHog never
  telemetry = quiet && !sentryOnly ? null : telemetryLib.create(storage, {version: app.getVersion(), silent: sentryOnly});
  setTelemetry(telemetry);
  // No channel from the installer (a Download button): ask the website once which click from this network it was (lib/install-source.js).
  if (!quiet) installSource.attribute(storage).then(channel => appLog('install', channel ? 'channel matched to a download click' : 'no channel for this install', {channel}))
    .catch(error => appLog('install', 'channel lookup failed', {error: error.message}));
  appLog('telemetry', quiet ? `reporting is off: ${quiet}${sentryOnly ? ' (Sentry only, environment e2e)' : ''}` : 'reporting follows the Technical reports switch');   // the end-to-end harness reads this line
  if (!storage.settings().setupDone) trackSetup({wizardStep: 'welcome'}, storage.settings());  // the funnel's first step: the app opened
  // Real fill errors (lib/real-errors.js): a Sentry event when crash reports are on, and one Telegram line per error kind per hour through the owner's own bot.
  let sentryCapture = () => false;
  server.setErrorWatcher(createWatcher({sentry: (kind, fields) => sentryCapture(kind, fields), notice: text => {
    const token = storage.secret('TELEGRAM_BOT_TOKEN'), chat = storage.settings().telegramChatId;
    if (quiet || !token || !chat) return;
    telegramLib.api(token, 'sendMessage', {chat_id: chat, text}).catch(error => appLog('telegram', 'error notice not sent', {error: error.message}));
  }}));
  if (telemetry) {
    // Crash reports (Sentry) and usage events (PostHog): only an installed build, only with Technical reports on, only when
    // config/analytics.json (or env) names where. Every problem the app records for itself goes to Sentry too; native crashes go through
    // Electron's own reporter. Nothing a person wrote or read is part of any of it (lib/sentry.js, lib/analytics.js).
    const keys = analyticsConfig.load(pipeline.REPO);
    const identity = {installId: sentryOnly ? 'e2e' : telemetryInstallId(storage), version: app.getVersion(), os: os.release()};
    const sentryClient = sentryLib.create({dsn: keys.sentryDsn, release: `job-pilotto@${identity.version}`, installId: identity.installId, os: identity.os,
      ...(sentryOnly ? {environment: 'e2e', tags: sentryLib.e2eTags(), enabled: (kind, fields = {}) => !causedByPlant({kind, source: fields.source, stack: fields.stack, message: fields.message ?? fields.error ?? fields.warning ?? fields.action ?? ''})} : {enabled: telemetry.enabled})});
    if (sentryClient.active) {
      const record = telemetry.record.bind(telemetry);
      trail = sentryClient.note;
      sentryCapture = sentryClient.capture;
      setTrail(trail);
      // Testers only (beta on), and only for one who switched it on (Settings → Technical reports): the scrubbed tail of the run log
      // rides along with a failed or hung run's report to Sentry (never to our own telemetry store).
      const logLines = kind => (['run_failed', 'stuck'].includes(kind) && testerOn() && testerLogsOn()) ? engineLog.tailLines(200) : undefined;
      telemetry.record = (kind, fields) => { record(kind, fields); sentryClient.capture(kind, {...fields, logLines: logLines(kind)}); };
      if (sentryOnly || telemetry.enabled()) sentryLib.startNativeCrashes(crashReporter, {dsn: keys.sentryDsn, release: `job-pilotto@${identity.version}`, installId: identity.installId});
      pipeline.setCrashReports({dsn: keys.sentryDsn, version: identity.version, installId: identity.installId, enabled: sentryOnly ? () => false : telemetry.enabled});   // the engine's own reports carry no environment tag: off in the journey
    }
    analytics = sentryOnly ? null : analyticsLib.create({key: keys.posthogKey, host: keys.posthogHost, installId: identity.installId, version: identity.version, os: identity.os, enabled: telemetry.enabled});
    setAnalytics(analytics);
    track('app_start', {});
    const updated = analyticsLib.updateStep(storage.settings().lastRunVersion, identity.version);   // the first start after an update says so, once
    if (updated) track('update_installed', updated);
    if (storage.settings().lastRunVersion !== identity.version) storage.saveSettings({lastRunVersion: identity.version});
    onSearchDone(info => { void reportSearch(storage, telemetry, info); });   // one report per finished Find jobs run (lib/search-report.js)
    server.setAppliedHook(info => track('applied', info));
    app.on('before-quit', () => { void analytics?.flush(); });
    pipeline.onRunEnd(({args, code, seconds, tail, timedOut, result, errorKind}) => {
      telemetry.countRun(code === 0);  // the health line's runsOk / runsFailed (release check evidence)
      if (args[0] === 'src' && ['daily', 'check'].includes(args[1])) {
        const searched = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : '';
        if (['run', 'scheduled'].includes(searched)) {
          track('search_done', {ok: code === 0, seconds: Math.round(seconds / 10) * 10, mode: searched, timed_out: !!timedOut});
          if (code === 0 && !storage.settings().firstSearchTracked) { storage.saveSettings({firstSearchTracked: true}); track('first_search_done', {seconds: Math.round(seconds / 10) * 10}); }
        }
      }
      const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : /^[a-z_]+$/.test(args[1] || '') ? args[1] : '';
      const job = `${args[0]}${mode ? ` ${mode}` : ''}`;
      if (code === 0) {
        // A run that finished but said something went wrong (the AI not answering, Notion refusing a write, feeds failing) is
        // not a crash and used to be invisible: one event with its first warning, so a user who "got nothing" is not silent.
        const warning = result?.warnings?.[0]?.message;
        if (warning) telemetry.record('run_warning', {job, seconds, warning, count: result.warnings.length});
        return;
      }
      const failure = runFailure({code, timedOut, tail, errorKind});
      if (failure) telemetry.record('run_failed', {job, code, seconds, ...failure, tail: tail.slice(-5)});
    });
    server.setFormIssueHandler(fields => {
      // Claude not answering a form's questions is the AI step failing, not one unfilled field: a warning with its reason.
      if (fields.type === 'ai') { telemetry.record('run_warning', {job: 'extension fill', warning: `The AI did not answer: ${fields.reason}`, site: fields.site}); return; }
      telemetry.record('form_issue', fields);
      // A stale extension is not a filled field: it is the cause of the fields that failed, so the app's own log
      // says it too (once per version pair — the extension reports every field of every form).
      if (fields.type === 'version' && staleWarned !== fields.version) {
        staleWarned = fields.version;
        appLog('extension', fields.reason, {reportedBy: fields.site});
      }
    });
    // A form tab the app opened must be taken by the extension: one "tab" event per tab, taken or the step that failed (lib/tab-expect.js).
    startTracking({record: fields => { telemetry.record('tab', fields); appLog('apply', `form tab: ${fields.outcome}`, {ms: fields.ms}); },
      isBound: id => review.tabOf(id) !== '', extensionSeen: server.extensionSeen,
      isLive: id => { const session = terminals.get(id); return !!session && !session.outcome && !session.endedAt; }});
    setTimeout(() => { healthOnce(); telemetry.flush(); }, 60 * 1000);
    setInterval(() => { healthOnce(); telemetry.flush(); }, 10 * 60 * 1000);
  }
}
