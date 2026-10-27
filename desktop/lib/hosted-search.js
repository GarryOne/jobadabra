// Hosted Always on, the app's side (private spec jobadabra-lab:docs/specs/2026-10-16-hosted-always-on.md §2, §4b): "Search for me every day" runs on our servers while the Mac is off.
// The app sets the schedule (with the e-mail), pushes the profile and search settings, pulls the matches that arrived (the inbox) into this Mac's own store, and exports or deletes
// what we hold. The install's own key (the one Free AI uses) is the only credential. Settings: settings.hostedSearch. Guard: test/hosted-search.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FREE_BASE, TRIAL_KEY, isFreeKey} from './ai-free.js';
import {siteOffForUser} from './recipes.js';

const BASE = FREE_BASE.replace(/\/api\/ai$/, '');
const EVERY = 10 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const keyOf = storage => storage.secret(TRIAL_KEY) || (/^JPF1\./.test(storage.secret('ANTHROPIC_API_KEY') || '') ? storage.secret('ANTHROPIC_API_KEY') : '');
export const state = storage => ({on: false, skipped: false, email: '', marketing: false, ...storage.settings().hostedSearch});
const save = (storage, patch) => storage.saveSettings({hostedSearch: {...state(storage), ...patch}});

export const UNAVAILABLE = 'Always on is not available just now.';   // the line when the site gave no reason of its own (lib/ready-site.js tells them apart)
export async function call(storage, route, {method = 'GET', body, fetcher = globalThis.fetch, key: given, headers = {}} = {}) {
  const key = given || keyOf(storage);   // `key`: one minted for an install that runs on its own engine (lib/ready-site.js)
  if (!key || !isFreeKey(key) || siteOffForUser()) return {ok: false, error: 'Always on needs a regular install with its key.'};
  try {
    const response = await fetcher(`${BASE}${route}`, {method, headers: {'x-api-key': key, 'Content-Type': 'application/json', ...headers}, ...(body ? {body: JSON.stringify(body)} : {})});
    const text = await response.text(), json = (() => { try { return JSON.parse(text); } catch { return {}; } })();
    return response.ok ? {ok: true, ...json} : {ok: false, status: response.status, error: json.error || UNAVAILABLE};
  } catch { return {ok: false, error: 'Could not reach Jobadabra just now. Check your connection.'}; }
}

// What the hosted run reads: the search settings and the profile text as they are on this Mac. (The CV file is not sent: the profile is what the search scores against.)
export function config(storage) {
  const read = name => { try { return fs.readFileSync(storage.path(name), 'utf8'); } catch { return ''; } };
  let search = {};
  try { search = JSON.parse(read('config/search.json')); } catch { /* none yet: the wizard saves it before this step */ }
  return {search, profile: read('profile.md'), cv: ''};
}
// A good copy is remembered with its time: the card says when the profile was last copied to our servers (owner, 27 Oct 2026).
export async function pushConfig(storage, options) {
  const done = await call(storage, '/api/hosted/config', {method: 'PUT', body: config(storage), ...options});
  if (done.ok) save(storage, {copiedAt: new Date().toISOString()});
  return done;
}

// Turn on: the schedule (the e-mail makes the trial account), then the config. -> {ok, error?}
export async function turnOn(storage, {email, marketing = false}, options = {}) {
  const address = String(email || '').trim();
  if (!EMAIL.test(address)) return {ok: false, error: 'Enter an email address like you@example.com.'};
  const set = await call(storage, '/api/hosted/schedule', {method: 'PUT', body: {on: true, email: address, marketing: !!marketing}, ...options});
  if (!set.ok) return set;
  save(storage, {on: true, skipped: false, email: address, marketing: !!marketing, after: state(storage).after || 0});
  const pushed = await pushConfig(storage, options);
  return pushed.ok ? {ok: true} : {ok: true, warning: 'On, but your profile was not sent yet; it is sent again at the next start.'};
}

// Turn off: the schedule stops and everything we hold is deleted at once (the person's own words in the wizard: "turn it off anytime and it's deleted").
export async function turnOff(storage, options = {}) {
  if (!state(storage).on) { save(storage, {skipped: true}); return {ok: true, receipt: null}; }   // never turned on here (Skip in the wizard): nothing to delete, no call to the site
  return erase(storage, options);
}

// Delete my data, at any time, also while Always on is off (owner, 27 Oct 2026: "give at any time this option. But also when the user disabled the
// 'Always on'"): our servers are asked even when this Mac thinks nothing is there (an earlier install, a delete that failed). 401 = no account there: nothing held.
// -> {ok, receipt?, nothing?, error?}
export async function deleteData(storage, options = {}) {
  if (!keyOf(storage) && !options.key) return {ok: true, nothing: true};   // no install key: this Mac never sent anything
  return erase(storage, options);
}
async function erase(storage, options) {
  const gone = await call(storage, '/api/hosted/data', {method: 'DELETE', ...options});
  if (!gone.ok && gone.status !== 401) return gone;
  await call(storage, '/api/hosted/schedule', {method: 'PUT', body: {on: false}, ...options});
  save(storage, {on: false, skipped: true, after: 0, copiedAt: '', deletedAt: new Date().toISOString()});
  return {ok: true, receipt: gone.receipt || null};
}

// The server's schedule for this install (state, why it paused, the next run): null when it has none or cannot be reached.
export async function schedule(storage, options = {}) {
  const got = await call(storage, '/api/hosted/schedule', options);
  return got.ok ? got.schedule || null : null;
}

// "Download my hosted data": the JSON we hold, written to `file`.
export async function exportTo(storage, file, options = {}) {
  const got = await call(storage, '/api/hosted/export', options);
  if (!got.ok) return got;
  const data = {...got};
  delete data.ok;
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
  return {ok: true, file};
}

// Pull what arrived while this Mac was off into its own store (the engine adds the rows: src/hosted_run.py --merge). -> {ok, added}
export async function pullInbox(storage, runEngine, options = {}) {
  if (!state(storage).on) return {ok: true, added: 0};
  const got = await call(storage, `/api/hosted/inbox?after=${state(storage).after || 0}`, options);
  if (!got.ok) return got;
  const matches = got.matches || [];
  if (!matches.length) return {ok: true, added: 0};
  const file = path.join(os.tmpdir(), `jp-hosted-inbox-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(matches));
  try {
    const {code, stdout} = await runEngine(['src', 'hosted', '--merge', file]);
    if (code !== 0) return {ok: false, error: 'Could not add the new matches just now.'};
    save(storage, {after: Math.max(...matches.map(match => match.id)), lastPullAt: new Date().toISOString()});
    return {ok: true, added: Number(/(\d+) new matches added/.exec(stdout || '')?.[1] || 0), arrived: matches.length};
  } finally { fs.rmSync(file, {force: true}); }
}

// At start and every few minutes while the app is open (an inbox pull is also the app contact that keeps the 14-day pause away).
export function keepFresh(storage, runEngine, onAdded = () => {}, options) {
  const tick = () => pullInbox(storage, runEngine, options).then(done => { if (done.added) onAdded(done); }).catch(() => {});
  tick();
  setInterval(tick, EVERY).unref();
}
