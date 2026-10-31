// The Chrome extension talks to the app on this computer (127.0.0.1) instead of a Cloudflare Worker.
// Same endpoints and code as the Worker (worker/src/extension.js), with the user's local Profile,
// keys from the Keychain-backed store, and the local job list. Only this computer can connect, and
// every call still needs the extension token. This file is the HTTP routes (start); the pieces it re-exports:
// server-hooks.js (what main.js plugs in), server-env.js (token, tickets, localEnv), server-contact.js (/extension/me),
// server-pages.js (confirmation and page kind). Guarded by desktop/test/local-server.test.js and extension-cors.test.js.
import {isFormOf} from './apply.js';
import http from 'node:http';
import {routeTable} from './server-routes.js';
import {POST_CORS, tokenRequest, jsonHeaders, jsonBody} from './server-http.js';
import {handleExtension} from '../shared/worker/extension.js';
import {log as appLog} from './log.js';
import {timed} from './ext-http-timing.js';
import {listen, portFrom, DEFAULT_PORT} from './server-listen.js';
import * as pipeline from './pipeline.js';
import * as viewCache from './view-cache.js';
import {localEnv, latestExtension, developmentCopy, extensionChangedNote, newestExtensionFile, noteExtensionId} from './server-env.js';
import {extensionBuild} from './build-state.js';
import {packagedBuild} from './build-handlers.js';
import {pageKey, sessionOfJob, markReportedConfirmations} from './server-pages.js';
import {formIssue, jobName, notify, tabsHandler, accountPressedHandler, pageHandler, stuckHandler, takeOverHandler,
  claudeAutoHandler, accountFactHandler, stopAsked, stopHeard, stoppedHandler, startedHandler} from './server-hooks.js';

export {extensionToken, sessionSubmitted, APPLIED, appliedSessions, reconcileAppliedSessions, localEnv, latestExtension, staleExtension, issueTicket, checkTicket} from './server-env.js';
export {kept, contactSaved, me} from './server-contact.js';
export {sessionOfJob, pageKey, markReportedConfirmations, judgeConfirmation, decidePageKind, decideAccountJudge, decideEscalation} from './server-pages.js';
export {setNotifier, setWindowSignal, setAppliedHook, setRenderer, setTabsHandler, setSharedLogger, setProposalReporter, setAnswerReporter, setSessionReporter,
  setSitePasswordHandler, setReviewHandler, setLearnedHandler, setVisitHandler, setVisitRoute, setVisitFilters, setMissesHandler,
  setControlsHandler, setAliasesHandler, setRecipesHandler, setRememberHandler, setJoinHandler, setFocusHandler, setStuckHandler, setClaudeAutoHandler, setAccountFactHandler, setAccountPressedHandler, setPageHandler, setTakeOverHandler,
  setErrorWatcher, setFormIssueHandler, setOpenHandler, setAccountCodeHandler, setStoppedHandler, setStartedHandler, requestStop} from './server-hooks.js';

export {DEFAULT_PORT, portFrom};   // defined in server-listen.js (the demo's card needs the port without this file's imports; the test-app guard reads portFrom)
export const PORT = portFrom();
// The extension's IDs. /extension/pair hands the connection token only to a request from this extension; web pages can't send its Origin.
// The first is the copy loaded from the app's folder (the public "key" in extension/manifest.json); the second the Chrome Web Store item's
// (owner, 26 Oct 2026: nmbnjhmpofifgcdalfefddbiihccogoi). Guard: test/extension-store-id.test.js.
export const EXTENSION_IDS = ['gpffoneapcfceflfmfgedkcfbommgcfk', 'nmbnjhmpofifgcdalfefddbiihccogoi'];   // the second = server-env.js STORE_EXTENSION_ID (an import here runs before it is set)
export const EXTENSION_ID = EXTENSION_IDS[0];
// The request's Origin when it is one of our extensions' (else ''), to echo back in Access-Control-Allow-Origin.
export const ownOrigin = origin => (EXTENSION_IDS.some(id => origin === `chrome-extension://${id}`) ? origin : '');

// Job pages open in Chrome right now, as reported by the extension (POST /extension/tabs), without #hash.
// Kept per browser (the report's `browser`, else its run `boot`): a second browser with the extension adds its tabs, it never replaces this one's.
// A run silent for 90 s has ended. 8 Oct 2026: a test browser's empty reports made the owner's open forms look closed.
const tabRuns = new Map();   // browser (else boot) → {urls: Set, at}
// Why (#2536): versions, IDs and reload notices belong to a browser, just like its tabs; the hidden copy's base version must never describe Chrome.
const seenByBrowser = new Map();   // browser (else boot/worker) → {seen: {at, version, id}, devCopy}
let personBrowser = null;
let heard = null;
/** Latest check-in from any browser, including the owned browser: liveness for pooled tab knowledge, without a Chrome version or ID. */
export const extensionHeard = () => heard;
/** Last check-in from the person's browser, never the app-owned hidden browser; null until that copy reports. */
export const extensionSeen = () => seenByBrowser.get(personBrowser)?.seen || null;
/** The person's extension page ID (wake.html), falling back to the folder copy before its first report. */
export const extensionIdNow = () => extensionSeen()?.id || EXTENSION_ID;
export const openTabs = (now = Date.now()) => {
  for (const [boot, run] of tabRuns) if (now - run.at > 90 * 1000) tabRuns.delete(boot);
  return [...new Set([...tabRuns.values()].flatMap(run => [...run.urls]))];
};


// -> why this check-in should be logged, or an empty string.
function checkInReason(seen, at, version) {
  // The first check-in since the app started, one after a silence, or a new version: "when did the extension
  // last reach the app?" is answerable from the log (the every-30-s ones in between are not written).
  return !seen ? 'first since the app started' : seen.version !== version ? `version ${seen.version || '?'} → ${version}`
    : at - seen.at > 90 * 1000 ? `after ${Math.round((at - seen.at) / 1000)} s of silence` : '';
}

// Update the development-copy reload notice state for this report.
function noteDevelopmentCopy(report, version, at, devCopy) {
  if (developmentCopy()) {
    const changed = extensionChangedNote({boot: String(report.boot || report.worker || ''), version, at}, devCopy, {latest: latestExtension(), newest: newestExtensionFile});
    if (changed.note) appLog('extension', changed.note, {version});
    return changed.state;
  }
  return devCopy;
}

// Record a browser report and return tabs that need reading again.
function recordTabs(req, report) {
  const run = String(report.browser || report.boot || report.worker || '');   // one entry per browser; an older extension: per run
  if (!tabRuns.has(run) && tabRuns.size) appLog('extension', 'another browser run reports its tabs', {runs: tabRuns.size + 1, tabs: (report.urls || []).length});
  tabRuns.set(run, {urls: new Set((report.urls || []).map(pageKey)), at: Date.now()});
  const at = Date.now(), version = report.version || '', previous = seenByBrowser.get(run), owned = report.owned === true;
  heard = {at};   // Why (#2536): any reporter proves the pooled tab knowledge is alive; Chrome version identity remains separate.
  const why = checkInReason(previous?.seen, at, version);
  if (why) appLog('extension', `checked in: ${why}`, {browser: run, owned, version, tabs: (report.urls || []).length});
  seenByBrowser.set(run, {seen: {at, version, id: ownOrigin(req.headers.origin).slice('chrome-extension://'.length) || previous?.seen.id || ''},
    devCopy: owned ? null : noteDevelopmentCopy(report, version, at, previous?.devCopy)});
  if (!owned) {
    personBrowser = run;
    noteExtensionId(extensionSeen().id);   // only the person's store/folder copy controls the older-copy wording
  }
  const reread = tabsHandler({ids: report.ids, boot: report.boot, browser: report.browser, worker: report.worker, reading: report.reading, sessions: report.sessions}) || [];   // reading: Find jobs using your browser' tabs by ticket (lib/visits.js noteTabs)
  return {reread, version};
}

// Handle an event after acknowledgment, looking up its job only when needed.
async function reportEvent(storage, event) {
  if (event.type === 'stopped') { stopHeard(); stoppedHandler(event); return; }
  if (event.type === 'started') { startedHandler(event); return; }   // the person started it again on one tab: its session leaves "Stopped" (lib/stop-all.js startForm)
  if (event.type === 'page') { pageHandler(event); return; }   // the page's step, as it happens (extension/page-mark.js)   // the extension stopped: no job lookup, nothing else to do (the person's Stop)
  // The page the panel reports may be the posting's form (Ashby /application, Lever /apply), not the posting itself.
  const find = jobs => jobs.find(j => pageKey(j.url) === pageKey(event.url)) || jobs.find(j => j.url && isFormOf(event.url, j.url));
  // The Jobs screen's last list first: a fresh read takes 10-15 s, and Take over waited on it (9 Oct 2026). A job not in it: the fresh read.
  const job = find(viewCache.recall(storage, 'jobs')?.result?.jobs || []) || find((await pipeline.jobs(storage).catch(() => ({jobs: []}))).jobs || []);
  dispatchEvent(event, job);
  notifyFill(event, job);
}

// Forward a nonterminal event to its current app handler.
function dispatchEvent(event, job) {
  if (event.type === 'stuck') stuckHandler(event);
  if (event.type === 'account-pressed') accountPressedHandler(event);
  if (event.type === 'take-over') takeOverHandler({...event, job});
  if (event.type === 'claude-auto') claudeAutoHandler(event);
  if (event.type === 'account-fact') accountFactHandler(event);
  if (event.type === 'ai-failed') formIssue({type: 'ai', site: String(event.host || '').slice(0, 80), reason: String(event.why || '').slice(0, 160)});
}

// Show the fill notification with its application session target.
function notifyFill(event, job) {
  // A click opens this application's session (the newest one open on this job), not just the list.
  const target = {view: 'sessions', ...(sessionOfJob(event.url) ? {session: sessionOfJob(event.url)} : {})};
  if (event.type === 'fill-started') notify('Filling the application…', `${jobName(job)}. Check every field before you submit.`, target, 'info');
  if (event.type === 'fill-done') {
    notify(event.left ? 'Form filled: a few things left for you' : 'Form filled ✓',
      `${jobName(job)}: ${event.filled} field(s) filled${event.left ? `, ${event.left} left (listed on the page)` : ''}. Review, then submit.`, target, event.left ? 'warn' : 'good');
  }
}

// Acknowledge the browser report after updating its tab and extension state.
async function handleTabs(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  const {ok} = request;
  let reread = [];   // read tabs to hand back to an extension that restarted mid-read (lib/visits.js noteTabs)
  let version = '';   // this reply describes the reporting copy, independently of the person's Chrome check-in
  if (ok) {
    try {
      const report = JSON.parse(body?.toString() || '{}');
      ({reread, version} = recordTabs(req, report));
      void markReportedConfirmations(storage, report.urls || []).catch(error => appLog('extension', `confirmation check failed: ${error.message}`));
    } catch {}
  }
  jsonHeaders(res, ok ? 200 : 401, POST_CORS);
  jsonBody(res, ok ? {ok, latest: latestExtension(), build: extensionBuild({repo: pipeline.REPO, version, latest: latestExtension(), packaged: developmentCopy() ? null : packagedBuild()}), ...(reread.length ? {reread} : {}), ...(stopAsked() ? {stop: stopAsked()} : {})} : {ok});
}

// Acknowledge an extension event before processing its callbacks.
async function handleEvent(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  const {ok} = request;
  jsonHeaders(res, ok ? 200 : 401, POST_CORS);
  jsonBody(res, {ok});
  if (ok) {
    await reportEvent(storage, request.payload);
  }
}

// -> a loopback HTTP server; routes share this storage and report listener errors to onError.
export function start(storage, onError = () => {}) {
  const routes = routeTable(handleTabs, handleEvent);
  const context = {storage, ownOrigin, EXTENSION_ID, PORT};
  const server = http.createServer((req, res) => timed(req, res, async () => {   // timed: a slow request names where its time went (ext-http-timing.js)
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const route = routes.find(([matches]) => typeof matches === 'string' ? req.url === matches : matches(req.url));
      if (route) { await route[1](req, res, body, context); return; }
      const request = new Request(`http://127.0.0.1:${PORT}${req.url}`, {
        method: req.method, headers: req.headers, ...(body && !['GET', 'HEAD'].includes(req.method) ? {body} : {}),
      });
      const response = await handleExtension(request, localEnv(storage));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: error.message}));
    }
  }, {log: appLog}));
  listen(server, PORT, {onError});   // lib/server-listen.js: a busy port is said and retried, a test app without its own port stays off
  return server;
}
