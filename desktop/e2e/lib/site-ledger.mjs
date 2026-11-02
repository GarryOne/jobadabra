// The per-site daily limit for live visits (owner, 11 Oct 2026: our runs go out from the owner's home network, the one they apply from; SmartRecruiters, Louis Vuitton and H&M
// refused us after dozens of visits). ONE machine-wide ledger of live visits per host and day, shared by every worktree and session (<tmpdir>/jobadabra-site-ledger, as the
// heavy lock's folder), and ONE function every live path calls before it reaches a real site: guardLiveVisit(url). It refuses the 4th visit of a host in a day (JOBADABRA_SITE_LIMIT
// changes 3), and any visit to a host that showed a block page that day (markBlocked: a digest "refused", a bot check, access denied) until the next day, whoever asks.
// The owner's override is an environment flag only: JOBADABRA_SITE_LIMIT_OVERRIDE=<host>[,<host>] lets those hosts through (the count and the block both), and each use is logged to
// <ledger folder>/override.log. Counting starts at the landing (11 Oct 2026): earlier visits are not back-filled. The same process visiting the same host again (the Electron leg's
// apply-live and its tab opener) counts once. Loopback, file and non-https addresses are not real sites and never counted.
// Live paths (the class; test/site-ledger.test.mjs fails when one is missing): lib/live-row.mjs (npm run live, the pool's plain leg, row-to-case captures), lib/apply-live.mjs +
// lib/extension.mjs (the Electron leg, the twin), ladder-capture.mjs (a fixture's live read). Windows/Linux-safe: os.tmpdir, path.join, a mkdir lock.
// Job: keep the scorecard
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_LIMIT = 3;
const LOCK_STALE_MS = 10000;

export class SiteLimitError extends Error {
  constructor(message, details) { super(message); this.name = 'SiteLimitError'; Object.assign(this, details); }
}

/** Folder of the per-site visit ledger: JOBADABRA_SITE_LEDGER_DIR from env, else a fixed folder under the OS temp dir; only builds the path, creates nothing. */
export const ledgerDir = (env = process.env) => env.JOBADABRA_SITE_LEDGER_DIR || path.join(os.tmpdir(), 'jobadabra-site-ledger');
export const dayOf = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

// The site of an address: its host without a leading www.; '' for anything that is not a real https site of the internet.
export function siteOf(url) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return ''; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (parsed.protocol !== 'https:' || !host || host === 'localhost' || /^\[?::1\]?$/.test(host) || /^127\./.test(host) || host.endsWith('.localhost')) return '';
  return host;
}

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Runs fn(ledger) with the ledger file locked (a directory made atomically; a lock older than 10 s belongs to a dead writer) and writes back what fn changed.
function withLedger(env, fn) {
  const dir = ledgerDir(env), lock = path.join(dir, 'lock'), file = path.join(dir, 'ledger.json');
  fs.mkdirSync(dir, {recursive: true});
  for (let tries = 0; ; tries++) {
    try { fs.mkdirSync(lock); break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let age = 0;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; }
      if (age > LOCK_STALE_MS) { fs.rmSync(lock, {recursive: true, force: true}); continue; }
      if (tries > 400) throw new Error(`site ledger: ${lock} stayed locked`);
      sleep(25);
    }
  }
  try {
    let ledger = {};
    try { ledger = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet, or unreadable: counting starts again */ }
    if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) ledger = {};
    const result = fn(ledger);
    fs.writeFileSync(file, JSON.stringify(ledger, null, 1));
    return result;
  } finally { fs.rmSync(lock, {recursive: true, force: true}); }
}

const hostsOf = value => String(value || '').split(',').map(item => item.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean);
const clock = at => new Date(at).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'});

// The one function. Throws SiteLimitError when the visit is refused; otherwise records it and returns {site, count, limit, overridden}. Not a real site: returns null.
export function guardLiveVisit(url, {env = process.env, now = new Date(), who = '', record = true, log = line => process.stderr.write(`${line}\n`)} = {}) {
  const site = siteOf(url);
  if (!site) return null;
  const limit = Number(env.JOBADABRA_SITE_LIMIT) > 0 ? Number(env.JOBADABRA_SITE_LIMIT) : DEFAULT_LIMIT;
  // CI: each visit says its kind (JOBADABRA_VISIT_KIND: hand). A by-hand recording may use all the day's visits (record-once spec, 15 Oct 2026: no PR proof keeps one back any more).
  const kind = String(env.JOBADABRA_VISIT_KIND || '');
  const day = dayOf(now), at = now.getTime(), runId = String(process.pid);
  return withLedger(env, ledger => {
    for (const old of Object.keys(ledger)) if (old !== day) delete ledger[old];   // a new day starts clean
    const entry = ((ledger[day] ||= {})[site] ||= {visits: []});
    const overridden = hostsOf(env.JOBADABRA_SITE_LIMIT_OVERRIDE).includes(site);
    if (entry.visits.some(visit => visit.run === runId)) return {site, count: entry.visits.length, limit, overridden};   // this process was counted already
    const last = entry.visits.at(-1);
    const refuse = (why, extra) => {
      if (overridden) {
        try { fs.appendFileSync(path.join(ledgerDir(env), 'override.log'), `${new Date(at).toISOString()} ${site} ${why} (override JOBADABRA_SITE_LIMIT_OVERRIDE) ${who || 'session ?'}\n`); } catch { /* the log is best effort */ }
        log(`site-ledger: ${site}: ${why}: let through by JOBADABRA_SITE_LIMIT_OVERRIDE`);
        return null;
      }
      throw new SiteLimitError(`site-ledger: ${site} is not visited: ${why}. Counted from the machine-wide ledger (${ledgerDir(env)}); the owner can allow it with JOBADABRA_SITE_LIMIT_OVERRIDE=${site}.`, {site, day, ...extra});
    };
    if (entry.blocked) refuse(`it showed a block page at ${clock(entry.blocked.at)} today (${entry.blocked.why}), so it rests until tomorrow`, {blocked: true});
    else if (entry.visits.length >= limit) refuse(`${entry.visits.length} live visits today (limit ${limit}), the last at ${clock(last.at)}${last.who ? ` by ${last.who}` : ''}`, {count: entry.visits.length, limit});
    if (record) entry.visits.push({at, run: runId, ...(who ? {who} : {}), ...(kind ? {kind} : {})});
    return {site, count: entry.visits.length, limit, overridden};
  });
}

// A site that showed a block or access-denied page (a digest outcome "refused", a bot check): not visited again today, by anyone.
export function markBlocked(url, why = 'block page', {env = process.env, now = new Date()} = {}) {
  const site = siteOf(url);
  if (!site) return null;
  const day = dayOf(now);
  return withLedger(env, ledger => {
    for (const old of Object.keys(ledger)) if (old !== day) delete ledger[old];
    const entry = ((ledger[day] ||= {})[site] ||= {visits: []});
    entry.blocked ||= {at: now.getTime(), why: String(why).slice(0, 80)};
    return site;
  });
}

// What a run's printed lines or the app's log say when the site blocked us: the ladder's digest outcome "refused" (a block page), a code wall, or a bot check.
// The AI's bot-check flag rests the host only when the AI is sure (BOT_CHECK_SURE) or the form did not fill (owner, 12 Oct 2026: on CI the AI flagged Lever's normal
// apply page at 0.6, the form then filled 11 fields, and the host was rested for the day). A flag a filled form contradicts is said, and the host stays open.
// A real bot wall is unchanged: the run stops there, the host rests, nothing is ever solved. -> {signal: 'digest refused' | 'bot check' | '', contradicted: '' | why}
export const BOT_CHECK_SURE = 0.8;
export function blockVerdict(text) {
  const all = String(text || '');
  if (/\bdigest: outcome=refused\b/.test(all)) return {signal: 'digest refused', contradicted: ''};
  if (/account (judgment|result)[^:]*: needs_code|the site blocked us \(bot check\)/.test(all)) return {signal: 'bot check', contradicted: ''};
  const flags = [...all.matchAll(/^.*"botCheck":true.*$/gm)].map(([line]) => Number((line.match(/"confidence":([\d.]+)/) || [])[1] ?? 1));   // no confidence: counted as sure
  if (!flags.length) return {signal: '', contradicted: ''};
  const filled = Math.max(0, ...[...all.matchAll(/^.*fill: fields: (\d+) filled.*$/gm)].filter(([line]) => !/account page/.test(line)).map(found => Number(found[1])));
  const sure = Math.max(...flags);
  if (sure >= BOT_CHECK_SURE || !filled) return {signal: 'bot check', contradicted: ''};
  return {signal: '', contradicted: `possible bot check (contradicted): flagged at confidence ${sure}, then the form filled ${filled} field(s)`};
}
export const blockSignal = text => blockVerdict(text).signal;
