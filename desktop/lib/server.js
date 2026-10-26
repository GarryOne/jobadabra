// The Chrome extension talks to the app on this computer (127.0.0.1) instead of a Cloudflare Worker.
// Same endpoints and code as the Worker (worker/src/extension.js), with the user's local Profile,
// keys from the Keychain-backed store, and the local job list. Only this computer can connect, and
// every call still needs the extension token. This file is the HTTP routes (start); the pieces it re-exports:
// server-hooks.js (what main.js plugs in), server-env.js (token, tickets, localEnv), server-contact.js (/extension/me),
// server-pages.js (confirmation and page kind). Guarded by desktop/test/local-server.test.js and extension-cors.test.js.
import * as pageRender from './page-render.js';
import {isFormOf} from './apply.js';
import http from 'node:http';
import {handleExtension} from '../shared/worker/extension.js';
import {log as appLog} from './log.js';
import * as pipeline from './pipeline.js';
import * as viewCache from './view-cache.js';
import {extensionToken, issueTicket, checkTicket, localEnv, latestExtension, developmentCopy, extensionChangedNote, newestExtensionFile, noteExtensionId} from './server-env.js';
import {me} from './server-contact.js';
import {extensionBuild} from './build-state.js';
import {packagedBuild} from './build-handlers.js';
import {pageKey, sessionOfJob, markReportedConfirmations, judgeConfirmation, decidePageKind, decideAccountJudge, decideEscalation, pickUploadSlot, pickChoice, pickPopup} from './server-pages.js';
import {formIssue, jobName, notify, renderer, sessionReporter, tabsHandler, openHandler, joinHandler, focusHandler, learnedHandler, recipesHandler,
  aliasesHandler, controlsHandler, missesHandler, visitMore, visitFilters, visitHandler, sitePasswordHandler, reviewHandler,
  accountPressedHandler, pageHandler, stuckHandler, takeOverHandler, claudeAutoHandler, accountFactHandler, tailorHandler, addJobHandler, accountCodeHandler, stopAsked, stopHeard, stoppedHandler} from './server-hooks.js';

export {extensionToken, sessionSubmitted, APPLIED, appliedSessions, reconcileAppliedSessions, localEnv, latestExtension, staleExtension, issueTicket, checkTicket} from './server-env.js';
export {kept, contactSaved, me} from './server-contact.js';
export {sessionOfJob, pageKey, markReportedConfirmations, judgeConfirmation, decidePageKind, decideAccountJudge, decideEscalation} from './server-pages.js';
export {setNotifier, setWindowSignal, setAppliedHook, setRenderer, setTabsHandler, setSharedLogger, setProposalReporter, setAnswerReporter, setSessionReporter,
  setSitePasswordHandler, setReviewHandler, setLearnedHandler, setVisitHandler, setVisitRoute, setVisitFilters, setMissesHandler,
  setControlsHandler, setAliasesHandler, setRecipesHandler, setJoinHandler, setFocusHandler, setStuckHandler, setClaudeAutoHandler, setAccountFactHandler, setAccountPressedHandler, setPageHandler, setTakeOverHandler,
  setTailorHandler, setAddJobHandler, setErrorWatcher, setFormIssueHandler, setOpenHandler, setAccountCodeHandler, setStoppedHandler, requestStop} from './server-hooks.js';

export const DEFAULT_PORT = 47111;
// The port is fixed because the extension has it built in (extension/flow.js). JOB_PILOTTO_PORT moves it for a test app that runs next to the user's
// own (the end-to-end suites copy the extension with the same port, desktop/e2e/lib/extension.mjs); anything but a whole port number is ignored.
export const portFrom = (env = process.env) => (/^\d+$/.test(env.JOB_PILOTTO_PORT || '') && Number(env.JOB_PILOTTO_PORT) > 0 && Number(env.JOB_PILOTTO_PORT) < 65536 ? Number(env.JOB_PILOTTO_PORT) : DEFAULT_PORT);
export const PORT = portFrom();
// The extension's IDs. /extension/pair hands the connection token only to a request from this extension; web pages can't send its Origin.
// The first is the copy loaded from the app's folder (the public "key" in extension/manifest.json); the second the Chrome Web Store item's
// (owner, 26 Oct 2026: nmbnjhmpofifgcdalfefddbiihccogoi). Guard: test/extension-store-id.test.js.
export const EXTENSION_IDS = ['gpffoneapcfceflfmfgedkcfbommgcfk', 'nmbnjhmpofifgcdalfefddbiihccogoi'];   // the second = server-env.js STORE_EXTENSION_ID (an import here runs before it is set)
export const EXTENSION_ID = EXTENSION_IDS[0];
// The ID whose pages the app opens (wake.html): the copy that last checked in, else the folder's. A store user has no folder copy.
// The request's Origin when it is one of our extensions' (else ''), to echo back in Access-Control-Allow-Origin.
export const ownOrigin = origin => (EXTENSION_IDS.some(id => origin === `chrome-extension://${id}`) ? origin : '');

// Job pages open in Chrome right now, as reported by the extension (POST /extension/tabs), without #hash.
// Kept per browser (the report's `browser`, else its run `boot`): a second browser with the extension adds its tabs, it never replaces this one's.
// A run silent for 90 s has ended. 8 Oct 2026: a test browser's empty reports made the owner's open forms look closed.
const tabRuns = new Map();   // browser (else boot) → {urls: Set, at}
// When the extension last checked in (its tab reports come every 30 s), and its version.
let seen = null;
let devCopy = null;   // a development copy: when the extension started, and whether "reload it" was said (server-env.js extensionChangedNote)
export const extensionSeen = () => seen;
export const extensionIdNow = () => seen?.id || EXTENSION_ID;
export const openTabs = (now = Date.now()) => {
  for (const [boot, run] of tabRuns) if (now - run.at > 90 * 1000) tabRuns.delete(boot);
  return [...new Set([...tabRuns.values()].flatMap(run => [...run.urls]))];
};


export function start(storage, onError = () => {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      if (req.url === '/extension/pair') {
        const ours = !!ownOrigin(req.headers.origin);
        res.writeHead(ours ? 200 : 403, {'Content-Type': 'application/json', ...(ours ? {'Access-Control-Allow-Origin': req.headers.origin} : {})});
        res.end(JSON.stringify(ours ? {url: `http://127.0.0.1:${PORT}`, token: extensionToken(storage)} : {error: 'Only the Jobadabra extension can pair'}));
        return;
      }
      if (req.url === '/engine/render') {
        // The engine asks for a page after its scripts ran (lib/page-render.js): a local program with this run's key, never a web page (Origin).
        const allowed = req.method === 'POST' && !req.headers.origin && req.headers['x-job-pilotto-render'] === pageRender.TOKEN && renderer;
        const asked = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        const result = allowed ? await renderer(String(asked.url || ''), pageRender.agentOf(asked.user_agent)) : {error: 'Not allowed'};
        res.writeHead(allowed ? 200 : 403, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(result));
        return;
      }
      if (req.url === '/claude/ticket') {
        // Only local programs: a browser page's request carries an Origin and can't add this header unasked.
        const local = req.method === 'POST' && req.headers['x-job-pilotto'] === 'launcher' && !req.headers.origin;
        const job = (() => { try { return JSON.parse(body?.toString() || '{}').job; } catch { return ''; } })();
        res.writeHead(local && job ? 200 : 403, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(local && job ? {ticket: issueTicket(job)} : {error: 'Not allowed'}));
        return;
      }
      if (req.url.startsWith('/claude/session?')) {
        const local = req.method === 'POST' && req.headers['x-job-pilotto'] === 'launcher' && !req.headers.origin;
        const query = new URL(req.url, 'http://127.0.0.1').searchParams;
        const text = body?.toString() || '';
        const payload = (() => { try { return JSON.parse(text); } catch { return {message: new URLSearchParams(text).get('message') || ''}; } })();
        if (local) sessionReporter(query.get('id') || '', {event: query.get('event') || '', message: String(payload.message || '').slice(0, 300),
          transcript: typeof payload.transcript_path === 'string' ? payload.transcript_path : ''});
        res.writeHead(local ? 200 : 403, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: local}));
        return;
      }
      if (req.url === '/claude/notify') {
        // A Claude session's tools/notify.sh where there's no osascript (Windows): the app shows it. Local only, as above.
        const local = req.method === 'POST' && req.headers['x-job-pilotto'] === 'launcher' && !req.headers.origin;
        const form = new URLSearchParams(body?.toString() || '');
        const message = form.get('message')?.slice(0, 300);
        if (local && message) notify(`Jobadabra · ${form.get('job')?.slice(0, 120) || 'Application'}`, message, {view: 'sessions'});
        res.writeHead(local && message ? 200 : 403, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: !!(local && message)}));
        return;
      }
      if (req.url === '/extension/ticket') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const authorised = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const {ticket, job} = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        const ok = authorised && checkTicket(ticket, job);
        res.writeHead(ok ? 200 : 403, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? {ok} : {ok: false, error: authorised ? 'Unknown or expired ticket' : 'Wrong token'}));
        return;
      }
      if (req.url === '/extension/tabs') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        let reread = [];   // read tabs to hand back to an extension that restarted mid-read (lib/visits.js noteTabs)
        if (ok) {
          try {
            const report = JSON.parse(body?.toString() || '{}');
            const run = String(report.browser || report.boot || report.worker || '');   // one entry per browser; an older extension: per run
            if (!tabRuns.has(run) && tabRuns.size) appLog('extension', 'another browser run reports its tabs', {runs: tabRuns.size + 1, tabs: (report.urls || []).length});
            tabRuns.set(run, {urls: new Set((report.urls || []).map(pageKey)), at: Date.now()});
            const at = Date.now(), version = report.version || '';
            // The first check-in since the app started, one after a silence, or a new version: "when did the extension
            // last reach the app?" is answerable from the log (the every-30-s ones in between are not written).
            const why = !seen ? 'first since the app started' : seen.version !== version ? `version ${seen.version || '?'} → ${version}`
              : at - seen.at > 90 * 1000 ? `after ${Math.round((at - seen.at) / 1000)} s of silence` : '';
            if (why) appLog('extension', `checked in: ${why}`, {version, tabs: (report.urls || []).length});
            seen = {at, version, id: ownOrigin(req.headers.origin).slice('chrome-extension://'.length) || seen?.id || ''};
            noteExtensionId(seen.id);   // the "older copy" note words a store copy apart (server-env.js staleExtension)
            if (developmentCopy()) {
              const changed = extensionChangedNote({boot: String(report.boot || report.worker || ''), version, at}, devCopy, {latest: latestExtension(), newest: newestExtensionFile});
              devCopy = changed.state;
              if (changed.note) appLog('extension', changed.note, {version});
            }
            reread = tabsHandler({ids: report.ids, boot: report.boot, browser: report.browser, worker: report.worker, reading: report.reading, sessions: report.sessions}) || [];   // reading: Find jobs using your browser' tabs by ticket (lib/visits.js noteTabs)
            void markReportedConfirmations(storage, report.urls || []).catch(error => appLog('extension', `confirmation check failed: ${error.message}`));
          } catch {}
        }
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? {ok, latest: latestExtension(), build: extensionBuild({repo: pipeline.REPO, version: seen?.version || '', latest: latestExtension(), packaged: developmentCopy() ? null : packagedBuild()}), ...(reread.length ? {reread} : {}), ...(stopAsked() ? {stop: stopAsked()} : {})} : {ok}));
        return;
      }
      if (req.url === '/extension/open') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const {session} = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify({ok: ok && !!openHandler(String(session || ''))}));
        return;
      }
      if (req.url === '/extension/join' || req.url === '/extension/focus') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        const answer = !ok ? {ok: false} : req.url === '/extension/join' ? {ok: true, arm: joinHandler(payload.tabs || [])} : focusHandler(payload);
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(answer));
        return;
      }
      if (req.url === '/extension/learned') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify({ok}));
        if (ok) learnedHandler(payload);
        return;
      }
      if (req.url === '/extension/recipes') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? {recipes: await recipesHandler(payload)} : {error: 'Wrong token'}));
        return;
      }
      if (req.url === '/extension/aliases') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? {aliases: await aliasesHandler()} : {error: 'Wrong token'}));
        return;
      }
      if (req.url === '/extension/controls') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify({ok}));
        if (ok) controlsHandler(payload);
        return;
      }
      if (req.url === '/extension/misses') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify({ok}));
        if (ok) missesHandler(payload);
        return;
      }
      if (req.url === '/extension/visit-read' || req.url === '/extension/visit-filters' || visitMore[req.url]) {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        const answer = !ok ? {ok: false, error: 'Wrong token'} : req.url === '/extension/visit-filters' ? await visitFilters(payload) : visitMore[req.url] ? await visitMore[req.url](payload) : await visitHandler(payload);
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(answer));
        return;
      }
      if (req.url === '/extension/site-password' || req.url === '/extension/account-code') {   // both answer a secret: the extension's origin only
        // Only this extension's origin may read the answer, never a page. Chrome checks CORS for the extension's worker too: without
        // these headers every ask failed its preflight (8 Oct 2026) and no sign-in password was ever filled.
        const cors = {'Access-Control-Allow-Origin': ownOrigin(req.headers.origin) || `chrome-extension://${EXTENSION_ID}`, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type', Vary: 'Origin'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? await (req.url === '/extension/account-code' ? accountCodeHandler : sitePasswordHandler)(payload) : {error: 'Wrong token'}));
        return;
      }
      if (req.url === '/extension/review') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? {...reviewHandler(payload), ...(stopAsked() ? {stop: stopAsked()} : {})} : {error: 'Wrong token'}));
        return;
      }
      if (req.url === '/extension/event') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify({ok}));
        if (ok) {
          const event = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
          if (event.type === 'stopped') { stopHeard(); stoppedHandler(event); return; }
          if (event.type === 'page') { pageHandler(event); return; }   // the page's step, as it happens (extension/page-mark.js)   // the extension stopped: no job lookup, nothing else to do (the person's Stop)
          // The page the panel reports may be the posting's form (Ashby /application, Lever /apply), not the posting itself.
          const find = jobs => jobs.find(j => pageKey(j.url) === pageKey(event.url)) || jobs.find(j => j.url && isFormOf(event.url, j.url));
          // The Jobs screen's last list first: a fresh read takes 10-15 s, and Take over waited on it (9 Oct 2026). A job not in it: the fresh read.
          const job = find(viewCache.recall(storage, 'jobs')?.result?.jobs || []) || find((await pipeline.jobs(storage).catch(() => ({jobs: []}))).jobs || []);
          if (event.type === 'stuck') stuckHandler(event);
          if (event.type === 'account-pressed') accountPressedHandler(event);
          if (event.type === 'take-over') takeOverHandler({...event, job});
          if (event.type === 'claude-auto') claudeAutoHandler(event);
          if (event.type === 'account-fact') accountFactHandler(event);
          if (event.type === 'tailor-cv') tailorHandler({...event, job});
          if (event.type === 'add-job') addJobHandler({...event, job});
          if (event.type === 'ai-failed') formIssue({type: 'ai', site: String(event.host || '').slice(0, 80), reason: String(event.why || '').slice(0, 160)});
          // A click opens this application's session (the newest one open on this job), not just the list.
          const target = {view: 'sessions', ...(sessionOfJob(event.url) ? {session: sessionOfJob(event.url)} : {})};
          if (event.type === 'fill-started') notify('Filling the application…', `${jobName(job)}. Check every field before you submit.`, target);
          if (event.type === 'fill-done') {
            notify(event.left ? 'Form filled: a few things left for you' : 'Form filled ✓',
              `${jobName(job)}: ${event.filled} field(s) filled${event.left ? `, ${event.left} left (listed on the page)` : ''}. Review, then submit.`, target);
          }
        }
        return;
      }
      if (req.url === '/extension/page-kind' || req.url === '/extension/pick-choice' || req.url === '/extension/dismiss-popup' || req.url === '/extension/pick-upload' || req.url === '/extension/account-judge' || req.url === '/extension/escalate') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        if (req.headers.authorization !== `Bearer ${extensionToken(storage)}`) { res.writeHead(401, {'Content-Type': 'application/json', ...cors}); res.end(JSON.stringify({ok: false, kind: '', error: 'Wrong token'})); return; }
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        const answer = req.url === '/extension/pick-choice' ? await pickChoice(storage, payload) : req.url === '/extension/dismiss-popup' ? await pickPopup(storage, payload) : req.url === '/extension/pick-upload' ? await pickUploadSlot(storage, payload) : req.url === '/extension/account-judge' ? await decideAccountJudge(storage, payload) : req.url === '/extension/escalate' ? await decideEscalation(storage, payload) : await decidePageKind(storage, payload);
        res.writeHead(200, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(answer));
        return;
      }
      if (req.url === '/extension/confirmation') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        if (!ok) { res.writeHead(401, {'Content-Type': 'application/json', ...cors}); res.end(JSON.stringify({ok: false, confirmation: false, error: 'Wrong token'})); return; }
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        const verdict = await judgeConfirmation(storage, payload);
        res.writeHead(200, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(verdict));
        return;
      }
      if (req.url === '/extension/me' || req.url.startsWith('/extension/me?')) {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        // The browser's preflight (OPTIONS, sent because of the Authorization header) carries no token: answer it.
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? await me(storage, new URL(req.url, 'http://x').searchParams.get('url') || '') : {error: 'Wrong token: open the extension settings and Connect again'}));
        return;
      }
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
  });
  server.on('error', onError);
  server.listen(PORT, '127.0.0.1');
  return server;
}
