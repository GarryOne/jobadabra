// Background modes use the real extension fill/judge/submit watcher in an owned browser; manual handoff is permanent for this application.
import {createBackgroundSession} from './background-session.mjs';
import {parseMark, pageFingerprint, pageKey} from './tab-pages.js';
import {sessionOf} from './tab-identity.js';
import {api, settings} from './flow.js';
import {isStopped, stopGeneration} from './stop-state.js';
import {submissionPage} from './background-submit.js';
import {formNext, forgetJudged} from './form-ready.js';
import {sketchOf} from './judge-sketch.js';
import {onTop} from './on-top.js';

let runner = null, watcher = () => {}, polling = false;
const owned = () => (runner ||= createBackgroundSession({chrome, parseMark}));
globalThis.__jobPilottoBackgroundSessions = {reveal: session => owned().reveal(session), closeSession: session => owned().closeSession(session)};
const request = async (context, payload) => api(await settings(), '/extension/background-apply', {method: 'POST', body: JSON.stringify({owner: context.owner, session: context.session, ...payload})});
const script = (tabId, frameId, func, args = []) => chrome.scripting.executeScript({target: {tabId, frameIds: [frameId ?? 0]}, world: 'MAIN', func, args}).then(rows => rows?.[0]?.result);

/** Attach the existing submit watcher; automatic clicks arm it explicitly and never impersonate a human submit message. */
export function setBackgroundWatcher(fn) { watcher = fn; }
/** Identify only a commanded background tab in the dedicated browser; return null in the person's ordinary extension. */
export async function backgroundContext(tabId) {
  if (!globalThis.chrome?.storage?.local?.get) return null;
  const {backgroundOwner: owner} = await chrome.storage.local.get('backgroundOwner').catch(() => ({}));
  if (!owner) return null;
  const session = await sessionOf(tabId), row = session && await owned().inspect(session);
  return row ? {session, owner, attempt: row.attempt || '', manual: row.manualRequired === true} : null;
}
/** A terminal per-job handoff never resumes through a reload, solved CAPTCHA, or changed mode; ordinary mode 1 keeps its existing behavior. */
export async function backgroundMayFill(tabId) {
  const context = await backgroundContext(tabId);
  if (!context) return !globalThis.chrome?.storage?.local?.get || !(await chrome.storage.local.get('backgroundOwner')).backgroundOwner;
  return owned().mayContinue(context.session);
}
/** Classify a challenge from this application's actual journey, and hand off account pages before credential or form automation. */
export async function backgroundPage(tabId, role, botCheck) {
  const context = await backgroundContext(tabId);
  if (!context) return false;
  const reason = await owned().observe(context.session, role, botCheck);
  return reason ? backgroundChallenge(tabId, reason) : false;
}
/** Persist a job's manual override before yielding; runtime challenges reveal its existing live form, while preflight goes to manual review. */
export async function backgroundChallenge(tabId, reason = 'captcha_runtime') {   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
  const context = await backgroundContext(tabId);
  if (!context) return false;
  await owned().requireManual(context.session, reason);
  await chrome.scripting.executeScript({target: {tabId, allFrames: true}, world: 'MAIN', func: () => { window.__jobPilottoStopped = true; }}).catch(() => {});
  await request(context, {action: 'manual', reason}).catch(() => null);
  const row = await owned().inspect(context.session);
  if (reason !== 'captcha_preflight' && !row.revealedAt) await owned().reveal(context.session);   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
  return true;
}
/** Poll only from the app-owned browser; the server claims one job at a time and all repeated polls reuse the same marked tab. */
export async function pollBackgroundApply(config) {
  if (polling) return;
  const {backgroundOwner: owner} = await chrome.storage.local.get('backgroundOwner').catch(() => ({}));
  if (!owner) return;
  polling = true;
  try {
    const result = await api(config, '/extension/background-apply', {method: 'POST', body: JSON.stringify({action: 'poll', owner})});
    for (const command of result.jobs || []) {
      const launch = await owned().start(command);
      if (!launch.ok) await request({owner, session: command.session}, {action: 'manual', reason: 'browser_session_unavailable'});
    }
    for (const handoff of result.handoffs || []) {
      const row = await owned().inspect(handoff.session);
      if (!row) continue;
      await owned().requireManual(handoff.session, handoff.reason);
      if (handoff.reveal && !row.revealedAt) await owned().reveal(handoff.session);
    }
    for (const check of result.checks || []) {
      const row = await owned().inspect(check.session);
      if (!row || row.manualRequired || row.attempt || isStopped()) continue;
      const tab = await chrome.tabs.get(row.tab).catch(() => null);
      if (!tab) continue;
      forgetJudged(tab.id); await formNext(tab, row.frameId || 0);
    }
  } finally { polling = false; }
}
/** Accept the current server judgment, inspect the real form, then consume at most one persisted Full automation permit. */
export async function backgroundFormReady(tab, frameId, answer, sig) {
  const context = await backgroundContext(tab.id);
  if (!context) return false;
  const row = await owned().inspect(context.session);
  if (row.manualRequired || row.attempt || isStopped()) return true;
  if (answer.botCheck) { await backgroundChallenge(tab.id); return true; }
  if (!answer.background?.proof) { await backgroundChallenge(tab.id, 'judgment_unavailable'); return true; }
  const generation = stopGeneration();
  const inspected = await script(tab.id, frameId, submissionPage, ['inspect', {control: (answer.step === 'middle' ? answer.nextControl : answer.submitControl) || ''}]).catch(() => null);
  if (!inspected) { await backgroundChallenge(tab.id, 'page_unavailable'); return true; }
  await owned().patch(context.session, {frameId: frameId || 0});
  const permit = await request(context, {action: 'ready', proof: answer.background.proof, requiredComplete: inspected.requiredComplete, factsOnly: inspected.factsOnly, safe: inspected.safe});
  if (permit.manual) { await backgroundChallenge(tab.id, permit.reason || 'needs_user'); return true; }
  if (permit.continue) return false; // the existing vetted Next flow runs only after persisting this step's evidence
  if (!permit.submit) { if (permit.review) await owned().patch(context.session, {reviewReady: true}); return true; }
  // Persist locally before the click too: a worker restart/lost reply can never consume this permit a second time.
  await owned().patch(context.session, {attempt: permit.attempt});
  const live = await chrome.tabs.get(tab.id).catch(() => null), current = await sketchOf(tab.id, frameId, 'MAIN');
  if (current) current.onTop = await script(tab.id, frameId, onTop).catch(() => null) || null;
  const fresh = current && JSON.stringify([current.controls, current.buttons, current.texts, current.frames, current.onTop]);
  if (!live || pageKey(live.url) !== pageKey(tab.url) || fresh !== sig || isStopped() || stopGeneration() !== generation || (await owned().inspect(context.session))?.manualRequired === true) {
    await backgroundChallenge(tab.id, 'page_changed_or_stopped'); return true;
  }
  const at = Date.now();
  await chrome.storage.session.set({[`submit:${tab.id}`]: {at, url: pageKey(tab.url), fingerprint: pageFingerprint(inspected.snapshot), calls: 0, automation: true, attempt: permit.attempt}});
  const pressed = await script(tab.id, frameId, submissionPage, ['press', {control: permit.control, seal: inspected.seal}]).catch(() => null);
  if (!pressed?.pressed) { await backgroundChallenge(tab.id, 'submit_not_pressed'); return true; }
  watcher(tab.id);
  return true;
}

/** Stop retires every owned application before a new worker or a human restart can resume an old submit. */
export async function stopBackgroundApply() {
  const {backgroundOwner: owner} = await chrome.storage.local.get('backgroundOwner');
  if (!owner) return;
  for (const row of Object.values(await owned().all())) {
    await owned().requireManual(row.session, 'stopped');
    await request({owner, session: row.session}, {action: 'manual', reason: 'stopped'}).catch(() => null);
  }
}
