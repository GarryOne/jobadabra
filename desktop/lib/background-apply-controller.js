// Bridge canonical background state, the actual extension and its owned browser; every submit command is a persisted one-shot reservation.
import {randomUUID, createHash} from 'node:crypto';
import {createBackgroundApplyStore} from './background-apply-store.js';
import {createBackgroundBrowser} from './background-browser.js';
import {createTriageReader} from './triage-reader.js';
import {applyOf, AUTO_DEFAULTS} from '../renderer/apply-settings-model.js';
import * as terminalsDefault from './terminals.js';
import {sessionTabUrl} from './session-tab.js';
import {extensionToken} from './server-env.js';
import {notify as notifyDefault, stopAsked} from './server-hooks.js';
import {log as appLog} from './log.js';

const instances = new WeakMap();
const HANDOFF = new Set(['manual_submit_required', 'needs_user_handoff']);
const NOTICES = {captcha_preflight: 'This application needs a CAPTCHA check. Open it, solve the check and press Submit yourself.', captcha_runtime: 'This application stopped at a CAPTCHA. The same form is open for you. Solve the check and press Submit yourself.', stopped: 'Background application stopped. Review and submit this form yourself.',   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
  submission_outcome_unknown: 'No confirmation of this application came back. Check whether it went through, and do not send it again until you know.',
  app_closed: 'The app was closed while it held this application, so nothing was sent. Open it, check the form and submit it yourself.'};   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
export const MAX_BACKGROUND_SESSIONS = 10;

/**
 * Runs `sweep` every `every` ms (default 30 s) and logs a failure instead of throwing; returns the function that stops it. `set` and `clear` are injectable so a test never waits for a clock.
 * Why (2026-10-29, owner): the stall sweep is the app's own timer; with the extension closed nothing else asks.
 */
export function watchStalled(sweep, {every = 30000, set = setInterval, clear = clearInterval, onError = () => {}} = {}) {
  const timer = set(() => { Promise.resolve().then(sweep).catch(onError); }, every);
  return () => clear(timer);
}
/** Return this app profile's single serialized controller; settings and store are rechecked for each proposed submit. */
const APP_STARTED = Date.now() - process.uptime() * 1000;   // when this run of the app began
const STALL_MS = 3 * 60000;   // a press with no receipt this long after it was sent is handed to the person (sweepStalled)
export function backgroundApplyFor(storage) {
  if (!instances.has(storage)) instances.set(storage, createBackgroundApplyController(storage));
  return instances.get(storage);
}
/** Create the controller with injectable store/browser boundaries for deterministic fictional browser proofs; no alternative filler exists here. */
export function createBackgroundApplyController(storage, {store = null, browser = null, terminals = terminalsDefault,
  config = () => applyOf(storage.settings()), now = Date.now, uuid = randomUUID, stop = stopAsked, notify = (...args) => notifyDefault(...args),   // Why (2026-10-28, bot review #2324): main.js sets the notifier after the handlers register; read the live binding at each call
 log = appLog, reader = createTriageReader(), started = APP_STARTED,   // `started`: when this run of the app began; a job held before it was cut off by a quit
  port = Number(process.env.JOB_PILOTTO_PORT || 47111), token = () => extensionToken(storage)} = {}) {
  store ||= createBackgroundApplyStore(storage, {stopped: stop});
  // Why (2026-10-28, CI #2324): the controller is created when the apply handlers register, before any background job exists; the browser reads storage.path, so it is built on first use.
  const browserOf = () => (browser ||= createBackgroundBrowser(storage));
  const judgments = new Map();
  let owner = '', pending = Promise.resolve();
  const serial = work => { const value = pending.then(work); pending = value.catch(() => {}); return value; };
  const cache = (item, state) => {
    const record = terminals.record(item.id);
    if (!record || !state) return;
    record.background = {mode: state.mode, state: state.state, reason: state.reason || '', readyAt: state.readyAt || 0,
      dueAt: state.mode === 'auto' && state.readyAt ? state.readyAt + (config().auto?.waitMin ?? AUTO_DEFAULTS.waitMin) * 60000 : 0, manualOverride: !!state.manualOverride};
    const words = state.state === 'ready_for_review' ? 'Form filled — review the same background form and Submit' : state.state === 'waiting_to_submit' ? 'Filled — waiting before automatic submission; Stop is available' : state.state === 'submitting' ? 'Submission attempted — waiting for the site receipt' : HANDOFF.has(state.state) ? NOTICES[state.reason] || 'This application needs you. Review and submit the same form yourself.' : 'Filling in the background';
    terminals.report(item.id, {event: 'note', message: words});
  };
  const itemFor = session => { const item = terminals.record(String(session || '')); return item?.background ? item : null; };
  async function markManual(item, reason) {
    const state = await store.handoff(item.url, item.id, owner, reason);
    if (state.ok === false) return state;
    cache(item, state);
    log('apply', 'background application handed to the person', {session: item.id, mode: state.mode, reason});
    notify('Application needs you', NOTICES[reason] || 'Review and submit this application yourself.', {view: 'sessions', session: item.id}, 'warn');
    return state;
  }
  async function enqueue(jobs, mode) {
    return serial(async () => {
      // Why (2026-10-29, owner: "go ahead" with the switch): Full automation runs only after the person confirmed it in Settings → Apply; the window's pick is not enough.
      if (mode === 'auto' && !config().autoConfirmedAt) return {ok: false, error: 'Full automation is off until you confirm it in Settings → Apply.'};
      if (!browserOf().ready()) return {ok: false, code: 'BACKGROUND_BROWSER_MISSING', error: "Download Jobadabra's browser first: about 200 MB, only once."};   // before any store write, so nothing waits on a browser that is not there
      const chosen = config();
      if (chosen.mode !== mode || !chosen.chosenAt) return {ok: false, error: 'Confirm the saved Apply mode first.'};
      const held = terminals.list().filter(item => item.background && !item.outcome);
      if (held.length + jobs.filter(job => !terminals.byUrl(job.url)).length > MAX_BACKGROUND_SESSIONS) return {ok: false, error: `At most ${MAX_BACKGROUND_SESSIONS} background forms can stay open. Finish or cancel one first.`};
      const enrolled = [];
      let skipped = 0;
      for (const job of jobs) {
        const old = terminals.byUrl(job.url);
        if (old && !old.background) return {ok: false, error: 'This job already has an application session. Continue that session first.'};
        // Why (2026-10-28, owner screenshot): a job the store refuses as not eligible (its stage moved on since the list was read) is skipped and said, not a thrown error that reaches the window
        // as an IPC string; the other jobs still start. Any other failure (a write, a wrong mode) stops the batch with its own words.
        let state;
        try { state = await store.queue(job.url, old?.id || uuid().slice(0, 8), mode, chosen); } catch (error) {
          if (error?.code !== 'NOT_ELIGIBLE') return {ok: false, error: String(error?.message || error)};
          skipped++; continue;
        }
        const item = terminals.startForm({id: state.session, url: job.url, title: job.title || '', company: job.company || '', location: job.location || '', workMode: job.workMode || ''});
        cache(item, state); enrolled.push(item.id);
      }
      if (!enrolled.length) return {ok: false, error: `${skipped === 1 ? 'This job is' : 'These jobs are'} not eligible to start another application. Pick another job in Jobs and try again.`};   // nothing queued: no browser starts
      ({owner} = await browserOf().start({port, token: token()}));
      log('apply', 'queued owned background browser sessions', {mode, sessions: enrolled.length, skipped});
      const skippedNote = skipped ? ` ${skipped} job${skipped === 1 ? ' was' : 's were'} skipped: not eligible to start another application.` : '';
      return {ok: true, mode, sessions: enrolled, message: `${enrolled.length} application${enrolled.length === 1 ? '' : 's'} queued in the background. Review filled forms in Sessions.${skippedNote}`};
    });
  }
  async function poll(givenOwner) {
    if (!owner) ({owner} = await browserOf().start({port, token: token()}));
    if (!givenOwner || givenOwner !== owner) return {ok: false, jobs: [], checks: []};
    const jobs = [], checks = [], handoffs = [];
    let filling = false;
    const open = terminals.list().filter(item => item.background && !item.outcome);
    for (const item of open) {
      let state = await store.read(item.url);
      if (!state || state.session !== item.id) continue;
      if (!state.manualOverride && (stop() || item.stuck === 'stopped')) state = await markManual(item, 'stopped');
      if (!state.manualOverride && heldBefore(item)) state = await handOverInterrupted(item, {quit: true}) || state;   // a poll before the start-up sweep never continues it (owner, 30 Oct 2026: "A quit is a Stop")
      const current = config();
      if (!state.manualOverride && (current.mode !== state.mode || current.chosenAt !== state.chosenAt)) state = await markManual(item, 'mode_changed');
      if (state.ok === false) continue;   // a handoff that did not save leaves the job as it was; never go on with an error as its state
      if (HANDOFF.has(state.state)) { handoffs.push({session: item.id, reason: state.reason, reveal: state.reason !== 'captcha_preflight'}); cache(item, state); continue; }   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
      if (state.state === 'submitting') continue; // a reserved attempt is never reissued, even after a lost reply/restart
      if (state.state === 'waiting_to_submit' && now() >= state.readyAt + (current.auto?.waitMin ?? AUTO_DEFAULTS.waitMin) * 60000) checks.push({session: item.id});
      if (['queued', 'preflight'].includes(state.state) && !filling && !reader.busy()) {
        const claim = await store.claim(item.url, item.id, owner);
        if (claim.ok) { filling = true; state = claim.state; jobs.push({session: item.id, url: sessionTabUrl(item.url, item.id), mode: state.mode}); }
      }
      cache(item, state);
    }
    // Why (2026-10-30, owner: triage read, PR C2a): a form read and an application never share the hidden browser: a read waits for open applications, and an application waits (at most the read's timeout) for a read that is queued or out (Gitar, #2602).
    jobs.push(...readCommands({filling, open}));
    return {ok: true, jobs, checks, handoffs};
  }
  const readCommands = ({filling, open}) => {
    const next = filling || open.length ? null : reader.take();
    return next ? [{session: next.id, url: sessionTabUrl(next.url, next.id), mode: 'read'}] : [];
  };
  /** Reads one job's application form in the hidden browser without filling or pressing anything; resolves with the mode table's flags, or null when nothing could be read (no browser, an application open, a timeout). Takes the job ({url}). */
  async function triageRead(job) {
    if (!browserOf().ready() || terminals.list().some(item => item.background && !item.outcome)) return null;
    if (!owner) ({owner} = await browserOf().start({port, token: token()}));
    return reader.read(job?.url);
  }
  // Hands one background job to the person through the store's interrupted check (`options`: afterMs, quit) with its own words; -> the saved state, or null when it was not handed over.
  async function handOverInterrupted(item, options) {
    const state = await store.interrupted(item.url, item.id, options).catch(() => null);
    if (!state) return null;
    cache(item, state);
    notify('Application needs you', NOTICES[state.reason] || NOTICES.submission_outcome_unknown, {view: 'sessions', session: item.id}, 'warn');
    log('apply', 'background application cut off handed to the person', {session: item.id, mode: state.mode, reason: state.reason, afterMs: options.afterMs || 0});
    return state;
  }
  // Hands to the person every background job of `fits` the interrupted check accepts; returns their session ids.
  async function handOverAll(fits, options) {
    const handed = [];
    for (const item of terminals.list().filter(entry => entry.background && !entry.outcome && fits(entry))) if (await handOverInterrupted(item, options)) handed.push(item.id);
    return handed;
  }
  const heldBefore = (item, startedBefore = started) => Date.parse(item.startedAt) < startedBefore;   // a job an earlier run of the app held: its quit cut it off
  /**
   * At start: every background job an earlier run held is handed to the person and never pressed: mid-press as "check whether it went through", before the press as `app_closed`.
   * Why (2026-10-29, owner: "Yes, go" to the crash rule): the hidden browser dies with the app (lib/browser-reaper.js), so no watcher will ever read the site's reply; without this the card said
   * "Submission attempted" for ever. Why (2026-10-29, Gitar on the PR): the sweep waits for the start-up moves, so a press this run started meanwhile is still in flight; only sessions older than this run were cut off by a quit.
   * Why (30 Oct 2026, owner: "A quit is a Stop"): a job before its press was continued after a restart, and Full automation pressed on the wait the quit cut off (#2598).
   * Returns the session ids it handed over.
   */
  async function sweepInterrupted(startedBefore = started) {
    return handOverAll(entry => heldBefore(entry, startedBefore), {quit: true});
  }
  /**
   * While the app runs: a press with no receipt `afterMs` after it was sent is handed to the person too, because a reply that never arrives (the extension closed, the tab gone) has no other reader.
   * Why (2026-10-29, owner: "Hand-off PR first, then the switch"): the extension's watcher hands off after its own two reads, but with the extension closed nothing runs; this is the app's own timer. 3 minutes
   * is far past the watcher's own 20 seconds of reading (submit-watch.js SUBMIT_WAIT_MS), so a reply it is still reading is never taken from it, and short enough that a lost reply is on your list the same session.
   * Returns the session ids it handed over.
   */
  async function sweepStalled(afterMs = STALL_MS) {
    return handOverAll(entry => entry.background?.state === 'submitting', {afterMs});   // the cached state (set by every store move) spares the store a subprocess per idle session every 30 s (Gitar on #2451)
  }
  async function judgment(body, answer) {
    const context = body?.background, item = itemFor(context?.session);
    if (item && context?.owner && !owner) ({owner} = await browserOf().start({port, token: token()}));
    if (!item || !owner || context.owner !== owner) return null;
    const state = await store.read(item.url);
    if (!state || state.owner !== owner || state.session !== item.id || state.manualOverride) return null;
    const proof = uuid(), signature = createHash('sha256').update(JSON.stringify(body.sketch || {})).digest('hex');
    judgments.set(proof, {session: item.id, answer, signature, at: now()});
    for (const [key, value] of judgments) if (now() - value.at > 120000) judgments.delete(key);
    return {proof, signature};
  }
  async function handle(payload = {}) {
    return serial(async () => {
      if (payload.action === 'poll') return poll(payload.owner);
      if (!owner && payload.owner) ({owner} = await browserOf().start({port, token: token()}));
      if (!owner || payload.owner !== owner) return {ok: false};
      if (payload.action === 'triage-read') return {ok: reader.report(String(payload.session || ''), payload)};   // a form read's answer: no application item behind it
      const item = itemFor(payload.session);
      if (!item) return {ok: false};
      if (payload.action === 'manual') {
        const state = await markManual(item, String(payload.reason || 'needs_user').slice(0, 80));
        return {ok: state.ok !== false, manual: true, reason: state.reason, reveal: state.reason !== 'captcha_preflight'};   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
      }
      if (payload.action !== 'ready') return {ok: false};
      const judgment = judgments.get(payload.proof);
      if (!judgment || judgment.session !== item.id || now() - judgment.at > 120000) return {ok: false, recheck: true};
      judgments.delete(payload.proof);
      if (stop() || item.stuck === 'stopped') return {ok: true, manual: true, state: await markManual(item, 'stopped')};
      const proof = {...judgment.answer, signature: judgment.signature, requiredComplete: payload.requiredComplete === true,
        factsOnly: payload.factsOnly === true, safe: payload.safe === true && judgment.answer.confidence >= 0.9};
      if (proof.botCheck) return {ok: true, manual: true, reason: 'captcha_runtime', state: await markManual(item, 'captcha_runtime')};   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
      if (proof.step === 'middle') {
        const state = await store.checkpoint(item.url, item.id, owner, proof); cache(item, state);
        return {ok: state.ok !== false, continue: state.state === 'filling', manual: HANDOFF.has(state.state), reason: state.reason};
      }
      const state = await store.ready(item.url, item.id, owner, proof); cache(item, state);
      if (state.mode === 'fill' && state.state === 'ready_for_review') {
        notify('Application ready for review', 'Open the filled form in Sessions, review it and press Submit yourself.', {view: 'sessions', session: item.id}, 'good');
        return {ok: true, review: true};
      }
      if (HANDOFF.has(state.state)) return {ok: true, manual: true, reason: state.reason};
      const permit = await store.reserve(item.url, item.id, owner, proof, config());
      cache(item, await store.read(item.url));
      if (permit.submit) log('apply', 'one-shot automatic submit authorized', {session: item.id, attempt: permit.attempt, signature: judgment.signature});
      return {ok: true, ...permit, manual: HANDOFF.has(permit.state)};
    });
  }
  async function reveal(id) {
    return serial(async () => {
      if (!owner) ({owner} = await browserOf().start({port, token: token()}));
      const item = itemFor(id); if (!item) return {ok: false};
      await markManual(item, 'review_requested');
      return {ok: await browserOf().reveal(id), taken: true, went: 'tab', found: null};
    });
  }
  async function outcome(context, confirmed) {
    const item = itemFor(context?.session);
    if (item && context?.owner && !owner) ({owner} = await browserOf().start({port, token: token()}));
    if (!item || context.owner !== owner) return {ok: false};
    const state = !context.attempt && confirmed === true ? await store.humanReceipt(item.url, item.id, owner, context.humanAt) : await store.receipt(item.url, item.id, context.attempt, confirmed);
    if (state.ok === false) return state;
    cache(item, state);
    return {ok: true};
  }
  async function cancel(id) {
    return serial(async () => {
      if (!owner) ({owner} = await browserOf().start({port, token: token()}));
      const item = itemFor(id); if (!item) return {ok: false};
      await markManual(item, 'cancelled');
      return {ok: true, closed: await browserOf().closeSession(id)};
    });
  }
  // The held tab's CDP address for the live view, only for a hidden-browser session, never another tab.
  async function page(id) { return itemFor(id) ? browserOf().pageSocket(id) : null; }
  // The page's own sending button for the app's Submit (the person's press): only while the form judge's ready stands, never after a hand-off.
  async function submitControl(id) {
    const item = itemFor(id); if (!item) return '';
    const state = await store.read(item.url);
    return state?.session === item.id && state.state === 'ready_for_review' && !state.manualOverride && typeof state.submitControl === 'string' ? state.submitControl : '';
  }
  // "Open in my browser": the held tab's hand-off (read(address) -> live.mjs handoffOf) is taken first, then the job is the person's and the hidden tab closes.
  async function handOver(id, read) {
    return serial(async () => {
      if (!owner) ({owner} = await browserOf().start({port, token: token()}));
      const item = itemFor(id); if (!item) return {ok: false};
      const address = await browserOf().pageSocket(id).catch(() => null);
      const handoff = address ? await read(address).catch(() => null) : null;
      await markManual(item, 'opened_in_browser');
      await browserOf().closeSession(id).catch(() => false);
      log('apply', 'background application opened in the person\'s browser', {session: item.id, handoff: !!handoff});
      return {ok: true, handoff};
    });
  }
  return {enqueue, handle, judgment, reveal, outcome, cancel, page, submitControl, handOver, sweepInterrupted, sweepStalled, triageRead, cancelTriage: () => reader.cancelAll()};
}
