// Ordered local HTTP routes for launcher, engine and extension requests; tab/event state stays in server.js.
import * as pageRender from './page-render.js';
import {extensionToken, issueTicket, checkTicket} from './server-env.js';
import {me} from './server-contact.js';
import {judgeConfirmation, decidePageKind, decideAccountJudge, decideEscalation, pickUploadSlot, pickChoice, pickPopup} from './server-pages.js';
import {notify, renderer, sessionReporter, openHandler, joinHandler, focusHandler, learnedHandler, recipesHandler, rememberHandler,
  aliasesHandler, controlsHandler, missesHandler, visitMore, visitFilters, visitHandler, sitePasswordHandler, reviewHandler,
  accountCodeHandler, stopAsked} from './server-hooks.js';
import {POST_CORS, tokenRequest, jsonPayload, jsonHeaders, jsonBody} from './server-http.js';

// Pair only a trusted extension Origin with this installation.
async function handlePair(req, res, body, {storage, ownOrigin, PORT}) {
  const ours = !!ownOrigin(req.headers.origin);
  res.writeHead(ours ? 200 : 403, {'Content-Type': 'application/json', ...(ours ? {'Access-Control-Allow-Origin': req.headers.origin} : {})});
  jsonBody(res, ours ? {url: `http://127.0.0.1:${PORT}`, token: extensionToken(storage)} : {error: 'Only the Jobadabra extension can pair'});
}

// Render an engine request only with its local run key.
async function handleRender(req, res, body) {
  // The engine asks for a page after its scripts ran (lib/page-render.js): a local program with this run's key, never a web page (Origin).
  const allowed = req.method === 'POST' && !req.headers.origin && req.headers['x-job-pilotto-render'] === pageRender.TOKEN && renderer;
  const asked = jsonPayload(body);
  const result = allowed ? await renderer(String(asked.url || ''), pageRender.agentOf(asked.user_agent)) : {error: 'Not allowed'};
  jsonHeaders(res, allowed ? 200 : 403);
  jsonBody(res, result);
}

// Issue a hand-off ticket to a local launcher.
async function handleClaudeTicket(req, res, body) {
  // Only local programs: a browser page's request carries an Origin and can't add this header unasked.
  const local = req.method === 'POST' && req.headers['x-job-pilotto'] === 'launcher' && !req.headers.origin;
  const job = (() => { try { return JSON.parse(body?.toString() || '{}').job; } catch { return ''; } })();
  jsonHeaders(res, local && job ? 200 : 403);
  jsonBody(res, local && job ? {ticket: issueTicket(job)} : {error: 'Not allowed'});
}

// Forward a local launcher session report.
async function handleClaudeSession(req, res, body) {
  const local = req.method === 'POST' && req.headers['x-job-pilotto'] === 'launcher' && !req.headers.origin;
  const query = new URL(req.url, 'http://127.0.0.1').searchParams;
  const text = body?.toString() || '';
  const payload = (() => { try { return JSON.parse(text); } catch { return {message: new URLSearchParams(text).get('message') || ''}; } })();
  if (local) sessionReporter(query.get('id') || '', {event: query.get('event') || '', message: String(payload.message || '').slice(0, 300),
    transcript: typeof payload.transcript_path === 'string' ? payload.transcript_path : ''});
  jsonHeaders(res, local ? 200 : 403);
  jsonBody(res, {ok: local});
}

// Show a local launcher notification.
async function handleClaudeNotify(req, res, body) {
  // A Claude session's tools/notify.sh where there's no osascript (Windows): the app shows it. Local only, as above.
  const local = req.method === 'POST' && req.headers['x-job-pilotto'] === 'launcher' && !req.headers.origin;
  const form = new URLSearchParams(body?.toString() || '');
  const message = form.get('message')?.slice(0, 300);
  if (local && message) notify(`Jobadabra · ${form.get('job')?.slice(0, 120) || 'Application'}`, message, {view: 'sessions'}, 'info');
  jsonHeaders(res, local && message ? 200 : 403);
  jsonBody(res, {ok: !!(local && message)});
}

// Validate a hand-off ticket for the extension.
async function handleTicket(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  const {ok: authorised} = request;
  const {ticket, job} = request.payload;
  const ok = authorised && checkTicket(ticket, job);
  jsonHeaders(res, ok ? 200 : 403, POST_CORS);
  jsonBody(res, ok ? {ok} : {ok: false, error: authorised ? 'Unknown or expired ticket' : 'Wrong token'});
}

// Open the extension's requested session.
async function handleOpen(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  const {ok} = request;
  const {session} = request.payload;
  jsonHeaders(res, ok ? 200 : 401, POST_CORS);
  jsonBody(res, {ok: ok && !!openHandler(String(session || ''))});
}

// Join tabs or focus the extension's requested session.
async function handleJoinFocus(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  const {ok, payload} = request;
  const answer = !ok ? {ok: false} : req.url === '/extension/join' ? {ok: true, arm: joinHandler(payload.tabs || [])} : focusHandler(payload);
  jsonHeaders(res, ok ? 200 : 401, POST_CORS);
  jsonBody(res, answer);
}

// Acknowledge learned answers before forwarding them.
async function handleLearned(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  const {ok, payload} = request;
  jsonHeaders(res, ok ? 200 : 401, POST_CORS);
  jsonBody(res, {ok});
  if (ok) learnedHandler(payload);
}

// Return the Remember defaults for typed answers.
async function handleRemember(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  const {ok, payload} = request;
  jsonHeaders(res, ok ? 200 : 401, POST_CORS);
  jsonBody(res, ok ? {remember: await rememberHandler(payload)} : {error: 'Wrong token'});
}

// Return recipes for the form's controls.
async function handleRecipes(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  const {ok, payload} = request;
  jsonHeaders(res, ok ? 200 : 401, POST_CORS);
  jsonBody(res, ok ? {recipes: await recipesHandler(payload)} : {error: 'Wrong token'});
}

// Return label aliases for the form.
async function handleAliases(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  const {ok} = request;
  jsonHeaders(res, ok ? 200 : 401, POST_CORS);
  jsonBody(res, ok ? {aliases: await aliasesHandler()} : {error: 'Wrong token'});
}

// Acknowledge control events before forwarding them.
async function handleControls(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  const {ok, payload} = request;
  jsonHeaders(res, ok ? 200 : 401, POST_CORS);
  jsonBody(res, {ok});
  if (ok) controlsHandler(payload);
}

// Acknowledge missed controls before forwarding them.
async function handleMisses(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  const {ok, payload} = request;
  jsonHeaders(res, ok ? 200 : 401, POST_CORS);
  jsonBody(res, {ok});
  if (ok) missesHandler(payload);
}

// Read a visit or dispatch its filters or registered operation.
async function handleVisit(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  const {ok, payload} = request;
  const answer = !ok ? {ok: false, error: 'Wrong token'} : req.url === '/extension/visit-filters' ? await visitFilters(payload) : visitMore[req.url] ? await visitMore[req.url](payload) : await visitHandler(payload);
  jsonHeaders(res, ok ? 200 : 401, POST_CORS);
  jsonBody(res, answer);
}

// Answer a password or account code with extension-only CORS.
async function handleSecret(req, res, body, {storage, ownOrigin, EXTENSION_ID}) {
  // both answer a secret: the extension's origin only
  // Only this extension's origin may read the answer, never a page. Chrome checks CORS for the extension's worker too: without
  // these headers every ask failed its preflight (8 Oct 2026) and no sign-in password was ever filled.
  const cors = {'Access-Control-Allow-Origin': ownOrigin(req.headers.origin) || `chrome-extension://${EXTENSION_ID}`, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type', Vary: 'Origin'};
  const request = tokenRequest(req, res, body, storage, cors);
  if (!request) return;
  const {ok, payload} = request;
  jsonHeaders(res, ok ? 200 : 401, cors);
  jsonBody(res, ok ? await (req.url === '/extension/account-code' ? accountCodeHandler : sitePasswordHandler)(payload) : {error: 'Wrong token'});
}

// Return the form review and any pending Stop.
async function handleReview(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  const {ok, payload} = request;
  jsonHeaders(res, ok ? 200 : 401, POST_CORS);
  jsonBody(res, ok ? {...reviewHandler(payload), ...(stopAsked() ? {stop: stopAsked()} : {})} : {error: 'Wrong token'});
}

// -> the requested judgment promise, retaining the original first-match order.
function judgmentFor(url, storage, payload) {
  if (url === '/extension/pick-choice') return pickChoice(storage, payload);
  if (url === '/extension/dismiss-popup') return pickPopup(storage, payload);
  if (url === '/extension/pick-upload') return pickUploadSlot(storage, payload);
  if (url === '/extension/account-judge') return decideAccountJudge(storage, payload);
  if (url === '/extension/escalate') return decideEscalation(storage, payload);
  return decidePageKind(storage, payload);
}

// Return the requested page or control judgment.
async function handleJudgment(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  if (!request.ok) { jsonHeaders(res, 401, POST_CORS); jsonBody(res, {ok: false, kind: '', error: 'Wrong token'}); return; }
  const payload = request.payload;
  const answer = await judgmentFor(req.url, storage, payload);
  jsonHeaders(res, 200, POST_CORS);
  jsonBody(res, answer);
}

// Return the submission confirmation judgment.
async function handleConfirmation(req, res, body, {storage}) {
  const request = tokenRequest(req, res, body, storage);
  if (!request) return;
  const {ok} = request;
  if (!ok) { jsonHeaders(res, 401, POST_CORS); jsonBody(res, {ok: false, confirmation: false, error: 'Wrong token'}); return; }
  const payload = request.payload;
  const verdict = await judgeConfirmation(storage, payload);
  jsonHeaders(res, 200, POST_CORS);
  jsonBody(res, verdict);
}

// Return contact details for the requested job URL.
async function handleMe(req, res, body, {storage}) {
  const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
  // The browser's preflight (OPTIONS, sent because of the Authorization header) carries no token: answer it.
  const request = tokenRequest(req, res, body, storage, cors);
  if (!request) return;
  const {ok} = request;
  jsonHeaders(res, ok ? 200 : 401, cors);
  jsonBody(res, ok ? await me(storage, new URL(req.url, 'http://x').searchParams.get('url') || '') : {error: 'Wrong token: open the extension settings and Connect again'});
}

// -> whether a launcher session URL includes the required query delimiter.
function isClaudeSession(url) { return url.startsWith('/claude/session?'); }
// -> whether the path shares the join/focus handler.
function isJoinFocus(url) { return url === '/extension/join' || url === '/extension/focus'; }
// -> whether a built-in or dynamically registered visit route currently matches.
function isVisit(url) { return url === '/extension/visit-read' || url === '/extension/visit-filters' || visitMore[url]; }
// -> whether the path answers a secret with extension-only CORS.
function isSecret(url) { return url === '/extension/site-password' || url === '/extension/account-code'; }
// -> whether the path asks for a page judgment.
function isJudgment(url) { return url === '/extension/page-kind' || url === '/extension/pick-choice' || url === '/extension/dismiss-popup' || url === '/extension/pick-upload' || url === '/extension/account-judge' || url === '/extension/escalate'; }
// -> whether the contact route matches, with or without its query.
function isMe(url) { return url === '/extension/me' || url.startsWith('/extension/me?'); }

// -> the first-match route table; dynamic visits must stay before secret, judgment and contact routes.
export function routeTable(tabs, event) {
  return [
    ['/extension/pair', handlePair],
    ['/engine/render', handleRender],
    ['/claude/ticket', handleClaudeTicket],
    [isClaudeSession, handleClaudeSession],
    ['/claude/notify', handleClaudeNotify],
    ['/extension/ticket', handleTicket],
    ['/extension/tabs', tabs],
    ['/extension/open', handleOpen],
    [isJoinFocus, handleJoinFocus],
    ['/extension/learned', handleLearned],
    ['/extension/remember', handleRemember],
    ['/extension/recipes', handleRecipes],
    ['/extension/aliases', handleAliases],
    ['/extension/controls', handleControls],
    ['/extension/misses', handleMisses],
    [isVisit, handleVisit],
    [isSecret, handleSecret],
    ['/extension/review', handleReview],
    ['/extension/event', event],
    [isJudgment, handleJudgment],
    ['/extension/confirmation', handleConfirmation],
    [isMe, handleMe],
  ];
}
