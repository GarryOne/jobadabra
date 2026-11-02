// Ready to send, the app's calls to the site (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md): is this install the owner's, send tonight's batch, start it now, read the morning's rows, mark a job Done.
// The install's own key (the one Free AI uses) is the only credential; the site answers 404 or 401 to anyone but the owner, so the card is shown only when `owner` says yes. Guard: test/ready-site.test.js.
import {FREE_BASE} from './ai-free.js';
import {UNAVAILABLE, call as callWith, keyOf} from './hosted-search.js';
import {siteOffForUser, siteOffReason} from './recipes.js';
import {read as keychainRead} from './keychain.js';
import {installId} from './pool-share.js';
import {installToken} from './install-token.js';

// The install's key for the site. An install on its own engine (Claude Code, its own key) has no JPF1 key, so its token is asked for from the install id (as Free AI does) through lib/install-token.js, kept in settings:
// it is not saved as the Anthropic key, so the engine does not change. The owner is told by the site's READY_OWNER match (the install id), nothing else.
async function keyFor(storage, {fetcher = globalThis.fetch} = {}) {
  const own = keyOf(storage);
  if (own) return own;
  const install = installId(storage);
  if (!install) return '';
  const token = await installToken(storage, install, 'ai', {base: FREE_BASE.replace(/\/api\/ai$/, ''), fetcher});   // kept once asked; no new ask after a refusal until tomorrow
  return token ? `JPF1.${install}.${token}` : '';
}
// Every call carries the owner secret too, never the install id: the app's own store, else this Mac's Keychain item jobadabra.ready.owner_secret (read through lib/keychain.js, so a test or twin never reaches it).
// Without it the site opens no owner route and the card stays closed. Tests replace the reader.
let readKeychain = service => keychainRead(service, {account: 'jobadabra'});
export const useKeychainReader = fn => { readKeychain = fn; };
/** The owner secret for the Ready site: the stored READY_OWNER_SECRET, else the Keychain item jobadabra.ready.owner_secret, else "" (never throws). */
export const ownerSecret = storage => String(storage.secret('READY_OWNER_SECRET') || readKeychain('jobadabra.ready.owner_secret') || '');
const call = async (storage, route, options = {}) => callWith(storage, route, {...options, key: await keyFor(storage, options), headers: {'x-ready-owner': ownerSecret(storage)}});

// The server no longer holds the form (a deploy or the container's sleep dropped the held tabs, or the night ended): its 410 "gone", or a 404 that says "held".
export const GONE_LINE = 'The server no longer holds this filled form (it restarted or the night ended). Press Fill now to fill it again.';
const reasonOf = result => (result.error === UNAVAILABLE ? '' : String(result.error || ''));   // the site's own words, '' when it gave none
const isGone = result => result.status === 410 || (result.status === 404 && /\bheld\b/.test(reasonOf(result)));
// Only a refused owner reads "not on": a 401, or a 404 without a reason of Ready to send's own (the route is off). The site's reasons are said in plain words.
export const NOT_ON = 'Ready to send is not on for this install.';
const REASONS = {'no queued night to run': 'Nothing was sent for tonight yet: press Fill now to send and start it.', 'already started': 'Filling has already started on the server.', 'the queue refused the night': 'The server could not hand the night to its filler just now. Press Fill now again in a minute.',
  'capped: this night reached its spending limit': 'This night reached its spending limit, so it is not filled again.', 'nothing is filling': 'Nothing is filling on the server now.',
  'already filling': 'This form is already being filled, or waits its turn.'};
const refusedOwner = result => result.status === 401 || (result.status === 404 && !reasonOf(result));
const words = result => (result.ok ? result : {ok: false, status: result.status, error: isGone(result) ? GONE_LINE : refusedOwner(result) ? NOT_ON : REASONS[reasonOf(result)] || result.error});

export const owner = async (storage, options) => (await call(storage, '/api/ready/state', options)).ok === true;
const clock = at => new Date(at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
// The morning's rows, or why the card cannot work right now, in plain words (the card is always shown and says this; owner, 18 Oct 2026: "show the card always... an error message/status and disabled buttons").
// -> {ok: true, batch, jobs} or {ok: false, why}.
export async function status(storage, {now = Date.now, ...options} = {}) {
  if (siteOffForUser()) return {ok: false, why: `Not in ${siteOffReason()}: it never reaches our server.`};
  if (!ownerSecret(storage)) return {ok: false, why: 'Only on the owner\'s install while it is tested.'};
  const key = await keyFor(storage, options);
  if (!key) {
    const wait = storage.settings().siteTokenWait?.ai || 0;
    return {ok: false, why: wait > now() ? `Our site gave this install no token today (its daily limit); asked again at ${clock(wait)}.` : 'Could not get this install\'s token from our site. Check the connection.'};
  }
  const result = await callWith(storage, '/api/ready/state', {...options, key, headers: {'x-ready-owner': ownerSecret(storage)}});
  if (result.ok) return result;
  return {ok: false, why: result.status === 401 || result.status === 404 ? 'Our site does not know this install as the owner\'s.' : `Our server did not answer${result.status ? ` (${result.status})` : ''}: ${result.error}`};
}
export const rows = async (storage, options) => words(await call(storage, '/api/ready/state', options));   // -> {ok, batch: {night, state, costUsd, expiresAt}, jobs: [...]}
export const send = async (storage, batch, options) => words(await call(storage, '/api/ready/batch', {method: 'POST', body: batch, ...options}));
export const again = async (storage, job, options) => words(await call(storage, '/api/ready/again', {method: 'POST', body: {job}, ...options}));   // a row's Fill again, from the night's own copy
export const stop = async (storage, job, options) => words(await call(storage, '/api/ready/stop', {method: 'POST', body: job ? {job} : {}, ...options}));   // -> {ok, stopped}
export const runNow = async (storage, options) => words(await call(storage, '/api/ready/run', {method: 'POST', body: {}, ...options}));
export const done = async (storage, job, options) => words(await call(storage, '/api/ready/done', {method: 'POST', body: {job}, ...options}));
export const deleteAll = async (storage, options) => words(await call(storage, '/api/ready/data', {method: 'DELETE', ...options}));
export const handoff = async (storage, job, options) => words(await call(storage, `/api/ready/handoff?job=${encodeURIComponent(job)}`, options));   // -> {ok, url, storage, sessionStorage, snapshot}: Open in my browser
// Watch the fill: the night's video of one form, as bytes (the site keeps it sealed, deleted with the form's data). -> {ok, bytes} or {ok: false, error}.
export async function video(storage, job, {fetcher = globalThis.fetch, ...options} = {}) {
  if (siteOffForUser()) return {ok: false, error: `Not in ${siteOffReason()}: it never reaches our server.`};
  const key = await keyFor(storage, {fetcher, ...options});
  if (!key) return {ok: false, error: 'Ready to send is not on for this install.'};
  try {
    const response = await fetcher(`${FREE_BASE.replace(/\/api\/ai$/, '')}/api/ready/video?job=${encodeURIComponent(job)}`, {headers: {'x-api-key': key, 'x-ready-owner': ownerSecret(storage)}});
    if (!response.ok) return {ok: false, error: response.status === 404 ? 'No video was kept for this form.' : `Our server did not answer (${response.status}).`};
    return {ok: true, bytes: new Uint8Array(await response.arrayBuffer())};
  } catch { return {ok: false, error: 'Could not reach Jobadabra just now. Check your connection.'}; }
}
export const link = async (storage, job, options) => words(await call(storage, '/api/ready/link', {method: 'POST', body: {job}, ...options}));   // -> {ok, url, expiresAt}: the 10-minute live-view link for one form
