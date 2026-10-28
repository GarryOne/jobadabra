// Canonical per-application background state through the existing store interface; reserve a submit once before any browser click.
import {call as engineCall} from './store/engine.js';
import {KIT_SECTION, kitOf} from './store/kit-section.js';
import {randomUUID} from 'node:crypto';
import {STARTABLE_STAGES} from './apply-eligibility.js';

export const BACKGROUND_SECTION = 'Background Apply';
const RESERVED = 'Background submit reserved';
const TERMINAL = new Set(['manual_submit_required', 'needs_user_handoff', 'receipt_confirmed', 'submitting']);
const employer = value => String(value || '').trim().normalize('NFKC').toLowerCase();
const dayOf = time => { const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const readState = text => { try { const state = JSON.parse(text || '{}'); return state?.version === 1 ? state : null; } catch { return null; } };

/** Build a serialized controller over Applications sections/events; failed store writes reject before any launch or submit is authorized. */
export function createBackgroundApplyStore(storage, {call = engineCall, now = Date.now, uuid = randomUUID, stopped = () => false} = {}) {
  let tail = Promise.resolve();
  const serial = work => { const result = tail.then(work); tail = result.catch(() => {}); return result; };
  const ask = (entity, method, args = {}) => call(storage, entity, method, args);
  const appOf = async url => { const app = await ask('applications', 'get', {url}); if (!app) throw new Error('This job has no Application record. Prepare its kit first.'); return app; };
  const load = async app => readState(await ask('applications', 'section', {app_id: app.id, name: BACKGROUND_SECTION}));
  const save = async (app, state) => { await ask('applications', 'set_section', {app_id: app.id, name: BACKGROUND_SECTION, markdown: JSON.stringify(state)}); return state; };
  const own = (state, session, owner) => !!state && state.session === session && state.owner === owner;
  const manual = (app, state, reason) => save(app, {...state, state: reason.startsWith('captcha_') ? 'manual_submit_required' : 'needs_user_handoff', manualOverride: true, reason, handoffAt: now()});   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
  const proofOk = proof => proof?.answer === 'ready' && proof.step === 'final' && proof.requiredComplete === true && proof.safe === true &&
    typeof proof.submitControl === 'string' && proof.submitControl.trim() && typeof proof.signature === 'string' && !!proof.signature;

  async function read(url) { return load(await appOf(url)); }
  async function queue(url, session, mode, config) {
    return serial(async () => {
      if (!['fill', 'auto'].includes(mode)) throw new Error('Unknown background Apply mode');
      const app = await appOf(url), old = await load(app);
      // Why (2026-10-27, owner): reapplying or changing modes must never reset a job's CAPTCHA or unknown-submit handoff.
      if (old) return old;
      if (!STARTABLE_STAGES.includes(app.stage)) throw new Error('This job is not eligible to start another application.');   // the picker's rule too (lib/apply-eligibility.js)
      if (!config?.chosenAt || config.mode !== mode) throw new Error('Confirm this Apply mode in Settings first.');
      return save(app, {version: 1, session, mode, chosenAt: config.chosenAt, state: 'queued', owner: '', manualOverride: false, queuedAt: now()});
    });
  }
  async function claim(url, session, owner) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      if (!owner || !state || state.session !== session || state.manualOverride || (state.owner && state.owner !== owner)) return {ok: false};
      if (state.state !== 'queued') return {ok: own(state, session, owner), state};
      const next = await save(app, {...state, owner, state: 'preflight', launchedAt: now()});
      return {ok: true, state: next};
    });
  }
  async function handoff(url, session, owner, reason = 'needs_user') {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      // Why (2026-10-28, bot review #2324): a queued job has no owner yet; Stop or a mode change must still hand it over, or a later poll fills what the person stopped.
      if (!state || state.session !== session || (state.owner && state.owner !== owner) || state.state === 'receipt_confirmed') return {ok: false};
      return state.manualOverride ? state : manual(app, state, String(reason).slice(0, 80));
    });
  }
  async function ready(url, session, owner, proof) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      if (!own(state, session, owner)) return {ok: false};
      if (TERMINAL.has(state.state)) return state;
      if (!proofOk(proof)) return manual(app, state, proof?.botCheck ? 'captcha_runtime' : 'incomplete_or_uncertain');   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
      const changed = state.signature !== proof.signature;
      return save(app, {...state, state: state.mode === 'fill' ? 'ready_for_review' : 'waiting_to_submit', signature: proof.signature, submitControl: proof.submitControl,
        readyAt: changed || !state.readyAt ? now() : state.readyAt, factsOnly: proof.factsOnly === true && state.factsUnknown !== true});
    });
  }
  async function checkpoint(url, session, owner, proof) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      if (!own(state, session, owner)) return {ok: false};
      if (TERMINAL.has(state.state)) return state;
      if (proof?.answer !== 'ready' || proof.step !== 'middle' || proof.requiredComplete !== true || proof.safe !== true) return manual(app, state, 'incomplete_or_uncertain');
      return save(app, {...state, state: 'filling', factsUnknown: state.factsUnknown === true || proof.factsOnly !== true});
    });
  }
  async function reserve(url, session, owner, proof, config) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      const deny = reason => ({submit: false, reason, state: state?.state || ''});
      if (!own(state, session, owner) || state.mode !== 'auto' || state.manualOverride || TERMINAL.has(state.state)) return deny('manual_or_already_attempted');
      const stop = async reason => { const next = await manual(app, state, reason); return {submit: false, reason, state: next.state}; };
      if (config?.mode !== 'auto' || !config.chosenAt || config.chosenAt !== state.chosenAt) return stop('mode_changed_or_not_opted_in');
      if (!proofOk(proof) || proof.signature !== state.signature) return stop('page_changed_or_incomplete');
      const checks = config.auto || {};
      if ((checks.factsOnly !== false || config.answers !== 'ai') && (proof.factsOnly !== true || state.factsOnly !== true)) return stop('facts_unknown');
      const kit = kitOf(await ask('applications', 'section', {app_id: app.id, name: KIT_SECTION}));
      const match = typeof app.fit === 'number' ? app : await ask('matches', 'get', {url});
      if (!STARTABLE_STAGES.includes(app.stage) || kit?.eligible !== true || !Number.isFinite(match?.fit) || match.fit < (checks.minFit ?? 80)) return stop('not_eligible');
      const waitMs = Math.max(0, Number(checks.waitMin ?? 10)) * 60000;
      if (!state.readyAt || now() < state.readyAt + waitMs) return {...deny('waiting'), dueAt: state.readyAt + waitMs};
      const rows = await ask('applications', 'list'), reservations = await ask('events', 'list', {kind: RESERVED});
      const today = dayOf(now()), company = employer(app.company);
      if (!company) return stop('employer_unknown');
      const todayIds = new Set(rows.filter(row => row.applied_on === today).map(row => row.id));
      const employerIds = new Set(rows.filter(row => row.applied_on === today && employer(row.company) === company).map(row => row.id));
      for (const event of reservations) {
        if (event.changes?.day === today) todayIds.add(event.app_id);
        if (event.changes?.day === today && event.changes?.employer === company) employerIds.add(event.app_id);
      }
      if (reservations.some(event => event.app_id === app.id)) return stop('attempt_already_reserved');
      if (todayIds.size >= (checks.perDay ?? 20) || employerIds.size >= (checks.perEmployer ?? 1)) return stop('limit_reached');
      if (stopped()) return stop('stopped');
      const attempt = uuid();
      // Why (2026-10-27, owner): reserve limits before the click; a crash or lost reply consumes the attempt and never creates a retry.
      await ask('events', 'add', {app_id: app.id, kind: RESERVED, at: new Date(now()).toISOString(), source: 'Full automation', source_id: `background:${session}:${attempt}`, changes: {employer: company, day: today, session, attempt}});
      const next = await save(app, {...state, state: 'submitting', attempt, submittedAt: now()});
      if (stopped()) return stop('stopped');
      return {submit: true, attempt, state: next.state, control: proof.submitControl, signature: proof.signature};
    });
  }
  async function receipt(url, session, attempt, confirmed) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      if (!state || state.session !== session || !attempt || state.attempt !== attempt || !state.submittedAt) return {ok: false};
      if (confirmed !== true) return manual(app, state, 'submission_outcome_unknown');
      return save(app, {...state, state: 'receipt_confirmed', receiptAt: now()});
    });
  }
  async function humanReceipt(url, session, owner, pressedAt) {
    return serial(async () => {
      const app = await appOf(url), state = await load(app);
      if (!own(state, session, owner) || !Number.isFinite(pressedAt) || pressedAt < state.queuedAt || now() - pressedAt > 15 * 60000) return {ok: false};
      return save(app, {...state, state: 'receipt_confirmed', humanSubmittedAt: pressedAt, receiptAt: now()});
    });
  }
  return {queue, claim, handoff, ready, checkpoint, reserve, receipt, humanReceipt, read};
}
