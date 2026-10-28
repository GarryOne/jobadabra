// Bridge canonical background state, the actual extension and its owned browser; every submit command is a persisted one-shot reservation.
import {randomUUID, createHash} from 'node:crypto';
import {createBackgroundApplyStore} from './background-apply-store.js';
import {createBackgroundBrowser} from './background-browser.js';
import {applyOf} from '../renderer/apply-settings-model.js';
import * as terminalsDefault from './terminals.js';
import {sessionTabUrl} from './session-tab.js';
import {extensionToken} from './server-env.js';
import {notify as notifyDefault, stopAsked} from './server-hooks.js';
import {log as appLog} from './log.js';

const instances = new WeakMap();
const HANDOFF = new Set(['manual_submit_required', 'needs_user_handoff']);
const NOTICES = {captcha_preflight: 'This application needs a CAPTCHA check. Open it, solve the check and press Submit yourself.', captcha_runtime: 'This application stopped at a CAPTCHA. The same form is open for you. Solve the check and press Submit yourself.', stopped: 'Background application stopped. Review and submit this form yourself.'};   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
export const MAX_BACKGROUND_SESSIONS = 10;

/** Return this app profile's single serialized controller; settings and store are rechecked for each proposed submit. */
export function backgroundApplyFor(storage) {
  if (!instances.has(storage)) instances.set(storage, createBackgroundApplyController(storage));
  return instances.get(storage);
}
/** Create the controller with injectable store/browser boundaries for deterministic fictional browser proofs; no alternative filler exists here. */
export function createBackgroundApplyController(storage, {store = null, browser = null, terminals = terminalsDefault,
  config = () => applyOf(storage.settings()), now = Date.now, uuid = randomUUID, stop = stopAsked, notify = (...args) => notifyDefault(...args),   // Why (2026-10-28, bot review #2324): main.js sets the notifier after the handlers register; read the live binding at each call
 log = appLog,
  port = Number(process.env.JOB_PILOTTO_PORT || 47111), token = () => extensionToken(storage), fullAutomation = false} = {}) {
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
      dueAt: state.mode === 'auto' && state.readyAt ? state.readyAt + (config().auto?.waitMin ?? 10) * 60000 : 0, manualOverride: !!state.manualOverride};
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
      // Why (2026-10-28, owner): nothing submits until step C ships Full automation's gates, its wait with Stop and the receipt recap; `fullAutomation` is that switch.
      if (mode === 'auto' && !fullAutomation) return {ok: false, error: 'Full automation is not available in this version.'};
      if (!browserOf().ready()) return {ok: false, code: 'BACKGROUND_BROWSER_MISSING', error: "Download Jobadabra's browser first: about 200 MB, only once."};   // before any store write, so nothing waits on a browser that is not there
      const chosen = config();
      if (chosen.mode !== mode || !chosen.chosenAt) return {ok: false, error: 'Confirm the saved Apply mode first.'};
      const held = terminals.list().filter(item => item.background && !item.outcome);
      if (held.length + jobs.filter(job => !terminals.byUrl(job.url)).length > MAX_BACKGROUND_SESSIONS) return {ok: false, error: `At most ${MAX_BACKGROUND_SESSIONS} background forms can stay open. Finish or cancel one first.`};
      const enrolled = [];
      for (const job of jobs) {
        const old = terminals.byUrl(job.url);
        if (old && !old.background) return {ok: false, error: 'This job already has an application session. Continue that session first.'};
        const state = await store.queue(job.url, old?.id || uuid().slice(0, 8), mode, chosen);
        const item = terminals.startForm({id: state.session, url: job.url, title: job.title || '', company: job.company || '', location: job.location || '', workMode: job.workMode || ''});
        cache(item, state); enrolled.push(item.id);
      }
      ({owner} = await browserOf().start({port, token: token()}));
      log('apply', 'queued owned background browser sessions', {mode, sessions: enrolled.length});
      return {ok: true, mode, sessions: enrolled, message: `${enrolled.length} application${enrolled.length === 1 ? '' : 's'} queued in the background. Review filled forms in Sessions.`};
    });
  }
  async function poll(givenOwner) {
    if (!owner) ({owner} = await browserOf().start({port, token: token()}));
    if (!givenOwner || givenOwner !== owner) return {ok: false, jobs: [], checks: []};
    const jobs = [], checks = [], handoffs = [];
    let filling = false;
    for (const item of terminals.list().filter(item => item.background && !item.outcome)) {
      let state = await store.read(item.url);
      if (!state || state.session !== item.id) continue;
      if (!state.manualOverride && (stop() || item.stuck === 'stopped')) state = await markManual(item, 'stopped');
      const current = config();
      if (!state.manualOverride && (current.mode !== state.mode || current.chosenAt !== state.chosenAt)) state = await markManual(item, 'mode_changed');
      if (state.ok === false) continue;   // a handoff that did not save leaves the job as it was; never go on with an error as its state
      if (HANDOFF.has(state.state)) { handoffs.push({session: item.id, reason: state.reason, reveal: state.reason !== 'captcha_preflight'}); cache(item, state); continue; }   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
      if (state.state === 'submitting') continue; // a reserved attempt is never reissued, even after a lost reply/restart
      if (state.state === 'waiting_to_submit' && now() >= state.readyAt + (current.auto?.waitMin ?? 10) * 60000) checks.push({session: item.id});
      if (['queued', 'preflight'].includes(state.state) && !filling) {
        const claim = await store.claim(item.url, item.id, owner);
        if (claim.ok) { filling = true; state = claim.state; jobs.push({session: item.id, url: sessionTabUrl(item.url, item.id), mode: state.mode}); }
      }
      cache(item, state);
    }
    return {ok: true, jobs, checks, handoffs};
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
  return {enqueue, handle, judgment, reveal, outcome, cancel, page};
}
