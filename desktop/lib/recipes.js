// The app's side of the shared recipe library (site/src/recipes.js; design in Notion "Self-improving form filling").
// The extension never talks to the site: it asks the app for recipes by fingerprint, the app asks the site, remembers the answer
// (also "none") for a while, and passes on only what extension/recipe-schema.js accepts. It also sends back, in batches, how
// the operators fared (counts), the structure of controls it could not read (no text), the wording of form questions no answer matched
// (the form's own words, never what the user typed) and what happened on each page of an application (counts per board). All of it follows the Technical
// reports switch: off means no fingerprint ever leaves this Mac.
// The ladder's learned counts (lib/ladder/learning.js) go with the same batch as `ladder`: what changed since the last successful send, per page shape, fixed values and integers only
// (rung 0-2: the fast tier's decisions the page confirmed, counted; rung 3+: the kept answers):
//   "ladder": [{"shape": "jobs.example.ch/careers/*|3-7", "rung": 3, "kind": "posting", "outcome": "form", "hits": 2, "misses": 1}, ...]   // at most 40; shape = host + path template + build, no query
//   "ladderOther": [{"shape": "jobs.example.ch/careers/*|3-7", "n": 2}, ...]   // pages the ladder ended on with no usable answer (lib/ladder/other.js), the same delta rule, at most 40
//   "repairs": [{"fp": "k3x9a1", "verb": "retype", "ok": 2, "failed": 0}, ...]   // what the fill ladder's control repairs did per control fingerprint (lib/ladder/repair-feed.js), the same delta rule, at most 40
// The site stores them per source (site/src/ladder-moves.js: 'user' here; the CI pool and the replays send theirs marked 'ci' / 'replay'); serving them (k>=3 installs) is not built.
import * as factAsks from './fact-asks.js';
import {validateAlias} from '../shared/alias-schema.js';
import {validateRecipe, whyWord} from '../shared/recipe-schema.js';
import {installId} from './app-feedback.js';
import {cleanHost} from './host-clean.js';
import {RESULT_STATES} from './application-result.js';
import {addAnswer, mergeAnswers} from './answer-counts.js';
import {log} from './log.js';
import {DEV_BUILD} from './telemetry.js';
import {LEFT_REASONS, cleanLabel} from './question-labels.js';
import {cleanUse} from './proposal-use.js';
import {counts as ladderCounts, ladderStore} from './ladder/learning.js';
import {counts as otherCounts, otherStore} from './ladder/other.js';
import {REPAIRS_SENT, repairDelta} from './ladder/repair-feed.js';
import {forgetToken, installToken} from './install-token.js';

export const SITE = 'https://www.jobpilotto.top';
const CACHE = 'recipes-cache.json';
const TTL_MS = 6 * 3600 * 1000;
const FLUSH_MS = 5 * 60 * 1000;
const LADDER_OTHER_SENT = 'data/ladder-other-sent.json';   // the same, for the pages the ladder ended on with no usable answer
const LADDER_SENT = 'data/ladder-sent.json';   // the ladder counts the site already has (a baseline, so only changes are sent)
const QUEUE = 'data/learning-queue.json';   // the waiting batch, so a restart loses nothing
const TERM = /^[a-z][a-z0-9+#.\- ]{1,38}[a-z0-9+#]$/;
const tag = list => { const first = Array.isArray(list) ? String(list[0] || '') : String(list || ''); return /^[a-z_]{2,20}$/.test(first) ? first : ''; };
export const DISMISS_REASONS = ['seniority', 'location', 'tech', 'company', 'role', 'other'];
export const SCORE_BANDS = ['0-39', '40-59', '60-79', '80-100', 'unscored'];
const JOB_STATES = ['new', 'saved', 'dismissed', 'applying', 'applied', 'screening', 'interviewing', 'offer', 'rejected', 'no_response', 'withdrawn'];
const OUTCOME_IDS = ['reply', 'screening', 'offer', 'rejected', 'no_response'];
export const FLOW_STATES = ['filled', 'fill-error', 'account', 'no-form', 'no-form-after-apply', ...RESULT_STATES];   // the last ones: how an application ended (application-result.js)

// One switch for everything that asks the site (recipes, label meanings, install tokens): off when this run is not a real install (the live-test twin,
// CI, smoke tests, a development build, demo: lib/telemetry.js reportingOff, set from lib/telemetry-handlers.js). 9 Oct 2026: such runs asked the
// site for a pack and a token each, 260 throwaway installs a day, half of Cloudflare KV's free writes. They work from the cached pack or the built-in words.
let siteOff = '';
export const setSiteOff = reason => { siteOff = reason || ''; };
export const siteIsOff = () => !!siteOff;
export const siteOffReason = () => siteOff;
// For what a person presses (Free AI, Always on, Ready to send, a report, Pro): refused only when the run is a test, the twin, CI or a smoke run. The owner's app
// run from source (DEV_BUILD) may use them (21 Oct 2026: "I cannot choose Free AI"). The automatic traffic (packs, learning, analytics) keeps `siteIsOff`/`enabled`.
export const siteOffForUser = () => !!siteOff && siteOff !== DEV_BUILD;
// An install that opted into beta (Settings → Beta) also tests canary learning (site/src/canary-reach.js, owner 9 Oct 2026).
export const betaHeader = storage => (storage.settings().betaChannel === true ? {'X-Beta': '1'} : {});
export const enabled = storage => !siteOff && storage.settings().telemetry !== false;
const readCache = storage => { try { return JSON.parse(storage.readText(CACHE) || '{}'); } catch { return {}; } };

export async function token(storage, fetcher, base) {
  if (siteOff) throw new Error(`the site is not asked: ${siteOff}`);
  const id = installId(storage);
  const value = await installToken(storage, id, 'recipes', {base, fetcher});
  if (!value) throw new Error('no token just now');
  return value;
}

// -> {fingerprint: recipe} for the fingerprints that have a running recipe for this install. Never throws: no recipes is a
// normal answer.
export async function lookup(storage, fingerprints, {fetcher = globalThis.fetch, base = SITE, now = Date.now(), onSent = null} = {}) {
  if (!enabled(storage)) return {};
  const wanted = [...new Set((Array.isArray(fingerprints) ? fingerprints : []).map(String).filter(fp => /^[a-z0-9]{6,16}$/.test(fp)))].slice(0, 30);
  const cache = readCache(storage), found = {};
  const ask = wanted.filter(fp => !(cache[fp] && now - cache[fp].at < TTL_MS));
  if (ask.length) {
    try {
      const id = installId(storage);
      let bearer = await token(storage, fetcher, base);
      let response = await fetcher(`${base}/api/recipes/lookup`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`, ...betaHeader(storage)},
        body: JSON.stringify({install: id, fingerprints: ask})});
      if (response.status === 401) {   // a token from before a key change: take a new one once
        forgetToken(storage, 'recipes');
        bearer = await token(storage, fetcher, base);
        response = await fetcher(`${base}/api/recipes/lookup`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`, ...betaHeader(storage)},
          body: JSON.stringify({install: id, fingerprints: ask})});
      }
      if (!response.ok) throw new Error(`lookup ${response.status}`);
      onSent?.('shape lookup → /api/recipes/lookup', {install: id, fingerprints: ask});
      const body = await response.json();
      const given = new Map((Array.isArray(body.recipes) ? body.recipes : []).map(item => [String(item?.fingerprint), validateRecipe(item)]));
      for (const fp of ask) {
        const checked = given.get(fp);
        cache[fp] = {at: now, recipe: checked?.ok ? checked.recipe : null};
      }
      storage.writeText(CACHE, JSON.stringify(cache));
    } catch (error) {
      log('recipes', `not asked: ${error.message}`);   // offline or the site down: the operators use their defaults
    }
  }
  for (const fp of wanted) if (cache[fp]?.recipe) found[fp] = cache[fp].recipe;
  return found;
}

// ---- what goes back: operator outcomes (counts per fingerprint and recipe) and new control structures ----
export function createReporter(storage, {fetcher = globalThis.fetch, base = SITE, setTimer = setTimeout, onSent = null} = {}) {
  let outcomes = new Map(), samples = [], fills = new Map(), questions = new Map(), flows = new Map(), aliasUse = new Map(), applications = new Map(), proposals = new Map(), proposalUses = new Map(), unfilled = new Map(), answers = new Map(), intel = emptyIntel(), timer = null, requiredBy = new Map(), starredBy = new Map(), cards = [], submits = new Map();
  // The waiting batch is kept on disk too (data/learning-queue.json), so a restart (an update, the twin's refresh) before the 5-minute send loses
  // nothing (9 Oct 2026: a twin fill's record vanished when the app restarted 44 s after it). Counts and fixed words only, as sent.
  const MAPS = {outcomes: () => outcomes, fills: () => fills, questions: () => questions, flows: () => flows, aliasUse: () => aliasUse, applications: () => applications,
    proposals: () => proposals, proposalUses: () => proposalUses, unfilled: () => unfilled, answers: () => answers, requiredBy: () => requiredBy, starredBy: () => starredBy, submits: () => submits};
  const save = () => { try { storage.writeText(QUEUE, JSON.stringify({...Object.fromEntries(Object.entries(MAPS).map(([name, get]) => [name, [...get()]])), samples, cards})); } catch { /* best effort */ } };
  const schedule = () => { save(); if (!timer) { timer = setTimer(() => { timer = null; flush().catch(() => {}); }, FLUSH_MS); timer.unref?.(); } };
  try {
    const kept = JSON.parse(storage.readText(QUEUE) || 'null');
    if (kept && enabled(storage)) {
      ({outcomes, fills, questions, flows, aliasUse, applications, proposals, proposalUses, unfilled, answers, requiredBy, starredBy, submits} = Object.fromEntries(Object.keys(MAPS).map(name => [name, new Map(Array.isArray(kept[name]) ? kept[name] : [])])));
      samples = Array.isArray(kept.samples) ? kept.samples : []; cards = Array.isArray(kept.cards) ? kept.cards : [];
      if ([...Object.values(MAPS)].some(get => get().size) || samples.length || cards.length) schedule();
    }
  } catch { /* an unreadable queue starts empty */ }
  return {
    // items [{fp, ok, recipe, why}] from the operators (a control left empty with no answer matched comes with ok false).
    outcome(items) {
      if (!enabled(storage)) return;
      for (const item of Array.isArray(items) ? items.slice(0, 20) : []) {
        if (!/^[a-z0-9]{6,16}$/.test(String(item?.fp || ''))) continue;
        const key = `${item.fp}|${Number(item.recipe) || 0}`;
        const entry = outcomes.get(key) || {fp: item.fp, recipe: Number(item.recipe) || 0, ok: 0, failed: 0};
        if (item.ok) entry.ok++; else { entry.failed++; entry.why = whyWord(item.why); }   // a fixed word, never the operator's own message
        outcomes.set(key, entry);
      }
      schedule();
    },
    // One form filled on this board (lib/control-events.js boardName): how often users meet each board.
    // `required`: how many required questions it had, the denominator of the real-use rates on /admin/form-filling/real-users.
    fill(board, required = 0, starred = 0) {
      if (!enabled(storage) || !/^(h:[0-9a-f]{10}|[a-z0-9.-]{2,40})$/.test(String(board || ''))) return;
      fills.set(board, (fills.get(board) || 0) + 1);
      const asked = Math.max(0, Math.min(200, Math.round(Number(required)) || 0));
      if (asked) requiredBy.set(board, (requiredBy.get(board) || 0) + asked);
      const marked = Math.max(0, Math.min(200, Math.round(Number(starred)) || 0));   // labels the page marks with a "*", counted without the required rule: the cross-check
      if (marked) starredBy.set(board, (starredBy.get(board) || 0) + marked);
      schedule();
    },
    // Questions of one fill that no answer matched (lib/question-labels.js unplaced): the form's own wording, counted per board.
    question(items, board) {
      if (!enabled(storage) || !/^(h:[0-9a-f]{10}|[a-z0-9.-]{2,40})$/.test(String(board || ''))) return;
      for (const item of Array.isArray(items) ? items.slice(0, 20) : []) {
        const label = cleanLabel(item?.label);
        if (label) questions.set(`${board}|${label}`, {label, kind: String(item.kind || '').slice(0, 20), board});
      }
      schedule();
    },
    // Label meanings that placed a question: [{phrase, ok}] counts, the canary's evidence for the service's aliases (never the answer).
    alias(items) {
      if (!enabled(storage)) return;
      for (const item of Array.isArray(items) ? items.slice(0, 20) : []) {
        const phrase = String(item?.phrase || '').slice(0, 60);
        if (!/^[\p{L}\p{M} '’/&()-]{3,60}$/u.test(phrase)) continue;
        const entry = aliasUse.get(phrase) || {phrase, ok: 0, failed: 0};
        if (item.ok) entry.ok++; else entry.failed++;
        aliasUse.set(phrase, entry);
      }
      schedule();
    },
    // One anonymous record per fill (extension/fill-card.js) with its board and, as a plain host name, where it ended: the learning digest's raw material.
    card(board, card, host) {
      if (!enabled(storage) || !/^(h:[0-9a-f]{10}|[a-z0-9.-]{2,40})$/.test(String(board || '')) || !card || typeof card !== 'object') return;
      if (!/^[\w-]{8,40}$/.test(String(card.id || '')) || JSON.stringify(card).length > 2000) return;
      const end = cleanHost(host);   // where the application ended: a plain host only, else not sent (the site counts it once >= 3 installs used it)
      cards.push({...card, board, ...(end ? {host: end} : {})});
      cards = cards.slice(-40);
      schedule();
    },
    // At Submit, for a fill's record: submitted, and how many questions you answered yourself (left / never read) or the page flagged.
    submit(id, counts) {
      if (!enabled(storage) || !/^[\w-]{8,40}$/.test(String(id || ''))) return;
      const entry = submits.get(id) || {id, submitted: false, by_you: 0, by_you_unread: 0, page_error: 0};
      entry.submitted ||= !!counts.submitted;
      for (const key of ['by_you', 'by_you_unread', 'page_error']) entry[key] = Math.max(entry[key], Math.min(100, Number(counts[key]) || 0));
      submits.set(id, entry);
      schedule();
    },
    // Fields of one fill that stayed empty, counted by board and a fixed reason word (lib/question-labels.js leftCounts): which reason costs the most forms.
    unfilled(board, counts) {
      if (!enabled(storage) || !/^(h:[0-9a-f]{10}|[a-z0-9.-]{2,40})$/.test(String(board || ''))) return;
      for (const item of Array.isArray(counts) ? counts.slice(0, 8) : []) {
        if (!LEFT_REASONS.includes(item?.reason) || !(Number(item.n) > 0)) continue;
        const key = `${board}|${item.reason}`;
        unfilled.set(key, {board, reason: item.reason, n: (unfilled.get(key)?.n || 0) + Math.min(100, Math.round(Number(item.n)))});
      }
      schedule();
    },
    // One AI answer call for a form (lib/answer-counts.js): summed per engine, counts only, for the site's per-AI-family metrics.
    answer(trace) {
      if (enabled(storage) && addAnswer(answers, trace)) schedule();
    },
    // What a fill or a contact lookup says about a label's wording (lib/contact-keys.js, lib/server-pages.js): [{key, phrase}], the wording and the fixed profile field it stands for.
    // The site only counts it; it becomes a candidate meaning once 3+ installs sent the same pair, and the owner's canary decides the rest.
    proposal(items) {
      if (!enabled(storage)) return;
      for (const item of Array.isArray(items) ? items.slice(0, 10) : []) {
        const checked = validateAlias(item);
        if (checked.ok) proposals.set(`${checked.alias.key}|${checked.alias.phrase}`, checked.alias);
      }
      schedule();
    },
    // What the person did with a proposed answer (lib/proposal-use.js cleanUse): counted by board, source, act and version.
    proposalUse(item) {
      const use = enabled(storage) && cleanUse(item);
      if (!use) return;
      const key = `${use.board}|${use.source}|${use.act}|${use.v}`;
      proposalUses.set(key, {...use, n: (proposalUses.get(key)?.n || 0) + 1});
      schedule();
    },
    // How an application went (lib/outcomes.js anonymous): counted by board, outcome and coarse days. No company, no role, no address.
    application(item) {
      if (!enabled(storage) || !item || !/^(h:[0-9a-f]{10}|[a-z0-9.-]{2,40})$/.test(String(item.board || ''))
        || !OUTCOME_IDS.includes(item.outcome) || !['', '0-3', '4-7', '8-14', '15-30', '31+'].includes(item.days || '')) return;
      const key = `${item.board}|${item.outcome}|${item.days || ''}`;
      applications.set(key, {board: item.board, outcome: item.outcome, days: item.days || '', n: (applications.get(key)?.n || 0) + 1});
      schedule();
    },
    // What the installs teach about the job search itself (site/src/intelligence.js): counts by coarse fixed-list tags, never a title or a company.
    // A role word the user chose from the "too narrow" card, with the coarse role and region of their search.
    termAccepted(term, roles, regions) {
      const word = String(term || '').toLowerCase().trim();
      if (!enabled(storage) || !TERM.test(word) || intel.terms.length >= 5) return;
      intel.terms.push({term: word, role: tag(roles) || 'other', region: tag(regions) || 'none'});
      schedule();
    },
    // One crawl's coverage (data/coverage.json): postings in the wanted places, how many the keywords caught, which fixed role words they missed.
    coverage(summary) {
      if (!enabled(storage) || !summary || !(Number(summary.in_places) > 0)) return;
      intel.coverage = {role: tag(summary.roles) || 'other', region: tag(summary.regions) || 'none', in_places: Number(summary.in_places) || 0,
        matched: Math.min(Number(summary.matched) || 0, Number(summary.in_places) || 0),
        missed: (Array.isArray(summary.suggestions) ? summary.suggestions : []).filter(item => TERM.test(String(item?.term || ''))).slice(0, 21)
          .map(item => ({term: String(item.term), count: Number(item.count) || 0}))};
      schedule();
    },
    // The one-tap "why?" after Dismiss: the reason (fixed list) and the job's score band.
    dismissal(reason, bucket) {
      if (!enabled(storage) || !DISMISS_REASONS.includes(reason) || !SCORE_BANDS.includes(bucket)) return;
      const key = `${reason}|${bucket}`;
      intel.dismissals.set(key, {reason, bucket, n: (intel.dismissals.get(key)?.n || 0) + 1});
      schedule();
    },
    // A daily snapshot of score band vs state (renderer/intel.js snapshot): the latest replaces the earlier one.
    snapshot(list) {
      if (!enabled(storage) || !Array.isArray(list)) return;
      intel.snapshot = list.filter(item => SCORE_BANDS.includes(item?.bucket) && JOB_STATES.includes(item?.state) && Number(item.n) > 0).slice(0, 60)
        .map(item => ({bucket: item.bucket, state: item.state, n: Math.min(5000, Math.round(Number(item.n)))}));
      schedule();
    },
    // An outcome the user marked, with the job's fit-score band: does a higher score get more replies? (no board, no company)
    reply(bucket, outcome) {
      if (!enabled(storage) || !SCORE_BANDS.includes(bucket) || !OUTCOME_IDS.includes(outcome)) return;
      const key = `${bucket}|${outcome}`;
      intel.replies.set(key, {bucket, outcome, n: (intel.replies.get(key)?.n || 0) + 1});
      schedule();
    },
    // Daily, per job-board kind (a known ATS name; any other site is "other"): jobs seen, acted on, dismissed, heard back. Which sources give useful jobs.
    sources(list) {
      if (!enabled(storage) || !Array.isArray(list)) return;
      intel.sources = list.filter(item => /^[a-z]{3,20}$/.test(String(item?.board || ''))).slice(0, 12)
        .map(item => ({board: item.board, seen: Math.min(5000, Math.round(Number(item.seen)) || 0), acted: Math.min(5000, Math.round(Number(item.acted)) || 0),
          dismissed: Math.min(5000, Math.round(Number(item.dismissed)) || 0), heard: Math.min(5000, Math.round(Number(item.heard)) || 0),
          good: Math.min(5000, Math.round(Number(item.good)) || 0),
          hours: Number.isFinite(Number(item.hours)) && item.hours !== null ? Math.min(2880, Math.max(0, Math.round(Number(item.hours) * 10) / 10)) : null}))
        .filter(item => item.seen > 0);
      schedule();
    },
    // Form questions the filler answered (filled) and the ones the person then changed by hand (corrected): the form's own wording only, never a value.
    fillQuality(filled, corrected) {
      if (!enabled(storage)) return;
      const bump = (labels, field) => {
        for (const raw of Array.isArray(labels) ? labels.slice(0, 40) : []) {
          const label = cleanLabel(raw);
          if (!label || (!intel.fixes.has(label) && intel.fixes.size >= 40)) continue;
          const entry = intel.fixes.get(label) || {label, filled: 0, corrected: 0};
          entry[field]++;
          intel.fixes.set(label, entry);
        }
      };
      bump(filled, 'filled'); bump(corrected, 'corrected');
      schedule();
    },
    // What happened on one page of an application (lib/question-labels.js flowState), counted per board.
    flow(board, state) {
      if (!enabled(storage) || !/^(h:[0-9a-f]{10}|[a-z0-9.-]{2,40})$/.test(String(board || '')) || !FLOW_STATES.includes(state)) return;
      const key = `${board}|${state}`;
      flows.set(key, {board, state, n: (flows.get(key)?.n || 0) + 1});
      schedule();
    },
    // items [{fingerprint, kind, skeleton, question}] new to this Mac (lib/misses.js).
    sample(items) {
      if (!enabled(storage)) return;
      for (const item of Array.isArray(items) ? items.slice(0, 10) : []) {
        if (item?.fingerprint && item.skeleton) samples.push({fingerprint: item.fingerprint, kind: item.kind, skeleton: item.skeleton, question: item.question || ''});
      }
      samples = samples.slice(-20);
      schedule();
    },
    async flush() { return flush(); },
  };
  function emptyIntel() { return {terms: [], coverage: null, dismissals: new Map(), snapshot: null, replies: new Map(), sources: null, fixes: new Map()}; }
  function hasIntel() { return !!(factAsks.pending(storage).length || intel.terms.length || intel.coverage || intel.dismissals.size || intel.snapshot || intel.replies.size || intel.sources || intel.fixes.size); }   // a function declaration: used above the return
  function takeIntel() {
    const out = {terms: intel.terms, coverage: intel.coverage, dismissals: [...intel.dismissals.values()], snapshot: intel.snapshot || [], replies: [...intel.replies.values()], sources: intel.sources || [],
      fixes: [...intel.fixes.values()].slice(0, 40), facts: factAsks.due(storage)};
    intel = emptyIntel();
    return out;
  }
  function putBackIntel(sent) {   // the send failed: keep what was not replaced meanwhile
    intel.terms = [...sent.terms, ...intel.terms].slice(0, 5);
    intel.coverage = intel.coverage || sent.coverage;
    for (const item of sent.dismissals) { const key = `${item.reason}|${item.bucket}`; intel.dismissals.set(key, {...item, n: item.n + (intel.dismissals.get(key)?.n || 0)}); }
    intel.snapshot = intel.snapshot || (sent.snapshot.length ? sent.snapshot : null);
    intel.sources = intel.sources || (sent.sources.length ? sent.sources : null);
    for (const item of sent.replies) { const key = `${item.bucket}|${item.outcome}`; intel.replies.set(key, {...item, n: item.n + (intel.replies.get(key)?.n || 0)}); }
    for (const item of sent.fixes) { const again = intel.fixes.get(item.label) || {label: item.label, filled: 0, corrected: 0}; again.filled += item.filled; again.corrected += item.corrected; intel.fixes.set(item.label, again); }
  }
  // The ladder's counts since the last successful send (the store holds running totals; the baseline of what the site already has is data/ladder-sent.json).
  function ladderDelta() {
    if (typeof storage.path !== 'function') return {rows: [], totals: {}};
    let sentBefore = {}; try { sentBefore = JSON.parse(storage.readText(LADDER_SENT) || '{}') || {}; } catch { /* none yet */ }
    const totals = {}, rows = [];
    for (const row of ladderCounts(ladderStore(storage.path('ladder-learning.json')))) {
      totals[row.shape] = {rung: row.rung, kind: row.kind, outcome: row.outcome, hits: row.hits, misses: row.misses};
      const before = sentBefore[row.shape], was = before?.rung === row.rung && before?.outcome === row.outcome && (before?.kind ?? row.kind) === row.kind ? before : null;   // a baseline from before `kind` was sent: the same decision
      const hits = row.hits - (was?.hits || 0), misses = row.misses - (was?.misses || 0);
      if (!was || hits > 0 || misses > 0) rows.push({shape: row.shape, rung: row.rung, kind: row.kind, outcome: row.outcome, hits: Math.max(0, hits), misses: Math.max(0, misses)});
    }
    return {rows: rows.slice(0, 40), totals};
  }
  function otherDelta() {
    if (typeof storage.path !== 'function') return {rows: [], totals: {}};
    let sentBefore = {}; try { sentBefore = JSON.parse(storage.readText(LADDER_OTHER_SENT) || '{}') || {}; } catch { /* none yet */ }
    const totals = {}, rows = [];
    for (const row of otherCounts(otherStore(storage.path('ladder-other.json')))) {
      totals[row.shape] = row.n;
      const n = row.n - (Number.isInteger(sentBefore[row.shape]) ? sentBefore[row.shape] : 0);
      if (n > 0) rows.push({shape: row.shape, n});
    }
    return {rows: rows.slice(0, 40), totals};
  }
  async function flush() {
    const ladder = enabled(storage) ? ladderDelta() : {rows: [], totals: {}};
    const other = enabled(storage) ? otherDelta() : {rows: [], totals: {}};
    const fixes = enabled(storage) ? repairDelta(storage) : {rows: [], totals: {}};   // what the control repairs did since the last send (ladder/repair-feed.js)
    if (!enabled(storage) || (!ladder.rows.length && !other.rows.length && !fixes.rows.length && !outcomes.size && !samples.length && !fills.size && !questions.size && !flows.size && !aliasUse.size && !applications.size && !proposals.size && !proposalUses.size && !unfilled.size && !answers.size && !cards.length && !submits.size && !hasIntel())) return {sent: 0};
    const body = {install: installId(storage), samples: samples.slice(0, 10), outcomes: [...outcomes.values()].slice(0, 40), exposure: [...fills].slice(0, 20).map(([board, n]) => ({board, n, ...(requiredBy.get(board) ? {required: requiredBy.get(board)} : {}), ...(starredBy.get(board) ? {starred: starredBy.get(board)} : {})})),
      questions: [...questions.values()].slice(0, 40), flows: [...flows.values()].slice(0, 20), aliasUse: [...aliasUse.values()].slice(0, 20),
      applications: [...applications.values()].slice(0, 20), proposals: [...proposals.values()].slice(0, 10), proposalUses: [...proposalUses.values()].slice(0, 40), unfilled: [...unfilled.values()].slice(0, 20), answers: [...answers.values()], cards: cards.slice(0, 20), submits: [...submits.values()].slice(0, 20), ...(ladder.rows.length ? {ladder: ladder.rows} : {}), ...(other.rows.length ? {ladderOther: other.rows} : {}), ...(fixes.rows.length ? {repairs: fixes.rows} : {}), ...(hasIntel() ? {intel: takeIntel()} : {})};
    const taken = {cards: cards.slice(0, 20), submits, samples: samples.slice(0, 10), outcomes, fills, requiredBy, starredBy, questions, flows, aliasUse, applications, proposals, proposalUses, unfilled, answers, intel: body.intel};
    samples = samples.slice(10);
    outcomes = new Map();
    fills = new Map();
    requiredBy = new Map();
    starredBy = new Map();
    questions = new Map();
    flows = new Map();
    aliasUse = new Map();
    applications = new Map();
    proposals = new Map();
    proposalUses = new Map();
    unfilled = new Map();
    answers = new Map();
    cards = cards.slice(20);
    submits = new Map();
    try {
      const response = await fetcher(`${base}/api/controls`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      if (!response.ok) throw new Error(`controls ${response.status}`);
      save();   // what is left (anything added during the send)
      if (ladder.rows.length) { try { storage.writeText(LADDER_SENT, JSON.stringify(ladder.totals)); } catch { /* sent again next time */ } }
      if (other.rows.length) { try { storage.writeText(LADDER_OTHER_SENT, JSON.stringify(other.totals)); } catch { /* sent again next time */ } }
      if (fixes.rows.length) { try { storage.writeText(REPAIRS_SENT, JSON.stringify(fixes.totals)); } catch { /* sent again next time */ } }
      onSent?.('shared counts → /api/controls', body);
      return {sent: body.samples.length + body.outcomes.length + body.exposure.length + body.questions.length + body.flows.length + body.aliasUse.length + body.applications.length + body.proposals.length + body.proposalUses.length + body.unfilled.length + body.answers.length + body.cards.length + body.submits.length + (body.ladder?.length || 0) + (body.ladderOther?.length || 0) + (body.intel ? 1 : 0)};
    } catch (error) {
      log('recipes', `outcomes not sent: ${error.message}`);
      samples = [...taken.samples, ...samples].slice(-20);   // kept for the next try
      for (const [key, entry] of taken.outcomes) {
        const again = outcomes.get(key) || {...entry, ok: 0, failed: 0};
        again.ok += entry.ok; again.failed += entry.failed;
        outcomes.set(key, again);
      }
      for (const [board, n] of taken.fills) fills.set(board, (fills.get(board) || 0) + n);
      for (const [board, n] of taken.requiredBy) requiredBy.set(board, (requiredBy.get(board) || 0) + n);
      for (const [board, n] of taken.starredBy) starredBy.set(board, (starredBy.get(board) || 0) + n);
      for (const [key, entry] of taken.questions) questions.set(key, entry);
      for (const [key, entry] of taken.flows) flows.set(key, {...entry, n: entry.n + (flows.get(key)?.n || 0)});
      if (taken.intel) putBackIntel(taken.intel);
      for (const [key, entry] of taken.applications) applications.set(key, {...entry, n: entry.n + (applications.get(key)?.n || 0)});
      for (const [key, entry] of taken.proposals) proposals.set(key, entry);
      cards = [...taken.cards, ...cards].slice(-40);
      for (const [key, entry] of taken.submits) if (!submits.has(key)) submits.set(key, entry);
      for (const [key, entry] of taken.proposalUses) proposalUses.set(key, {...entry, n: entry.n + (proposalUses.get(key)?.n || 0)});
      mergeAnswers(answers, taken.answers);
      for (const [key, entry] of taken.unfilled) unfilled.set(key, {...entry, n: entry.n + (unfilled.get(key)?.n || 0)});
      for (const [key, entry] of taken.aliasUse) { const again = aliasUse.get(key) || {phrase: key, ok: 0, failed: 0}; again.ok += entry.ok; again.failed += entry.failed; aliasUse.set(key, again); }
      save();   // put back above: kept on disk for the next try
      return {sent: 0};
    }
  }
}
