// Background modes use the real extension fill/judge/submit watcher in an owned browser; manual handoff is permanent for this application.
import {createBackgroundSession} from './background-session.mjs';
import {parseMark, pageFingerprint, pageKey} from './tab-pages.js';
import {sessionOf} from './tab-identity.js';
import {api, settings} from './flow.js';
import {isStopped, stopGeneration} from './stop-state.js';
import {submissionPage} from './background-submit.js';
import {formNext, forgetJudged} from './form-ready.js';

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
  return row ? {session, owner, mode: row.mode || '', attempt: row.attempt || '', manual: row.manualRequired === true} : null;
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
  if (!context || context.mode === 'read') return false;   // a triage read reports what it sees (backgroundRead); it never hands a page to the person
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
/** Tell the app what a triage read saw, then close its tab: the page is never typed into and never shown to the person. */
async function reportRead(context, found) {
  await request(context, {action: 'triage-read', ...found}).catch(() => null);
  await owned().closeSession(context.session).catch(() => false);
}
/**
 * A triage read's stop before the fill: a bot check is reported at once; a page that is neither a form nor an account page is reported as unreadable; a form or an account page goes to the
 * judge, whose answer comes back through backgroundFormReady. Takes the tab and the flow's step; returns true when this tab is a read (the flow ends here), false for every other tab.
 */
export async function backgroundRead(tab, step) {
  const context = await backgroundContext(tab.id);
  if (context?.mode !== 'read') return false;
  if (step.kind?.botCheck === true) await reportRead(context, {botCheck: true});
  else if (step.role !== 'form' && step.role !== 'account') await reportRead(context, {unreadable: true});
  else { forgetJudged(tab.id); await formNext(tab, 0); }
  return true;
}
/** Opens one job the app handed over; a session that could not open goes back to the person, and a read that could not open is reported unreadable. */
async function startCommand(owner, command) {
  const read = command.mode === 'read';
  // Why (2026-10-30, triage read C2a): an earlier read that timed out leaves its tab open; the next read closes it before its own starts.
  if (read) for (const row of Object.values(await owned().all())) if (row.mode === 'read' && row.session !== command.session) await owned().closeSession(row.session).catch(() => false);
  const launch = await owned().start(command);
  if (!launch.ok) await request({owner, session: command.session}, read ? {action: 'triage-read', unreadable: true} : {action: 'manual', reason: 'browser_session_unavailable'});
}
/** Poll only from the app-owned browser; the server claims one job at a time and all repeated polls reuse the same marked tab. */
export async function pollBackgroundApply(config) {
  if (polling) return;
  const {backgroundOwner: owner} = await chrome.storage.local.get('backgroundOwner').catch(() => ({}));
  if (!owner) return;
  polling = true;
  try {
    const result = await api(config, '/extension/background-apply', {method: 'POST', body: JSON.stringify({action: 'poll', owner})});
    for (const command of result.jobs || []) await startCommand(owner, command);
    for (const end of result.closes || []) await owned().closeSession(end.session).catch(() => false);   // a read the app ended without a report (Cancel, a timeout, #2624)
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
/** Why the press must not go now, as the hand-off reason id, or '' when it may: the tab is gone, a stop was asked, the tab moved to another address, or a manual override was set. */
async function pressRefusal(tab, session, generation) {
  const live = await chrome.tabs.get(tab.id).catch(() => null);
  if (!live) return 'page_unavailable';
  if (isStopped() || stopGeneration() !== generation) return 'stopped';
  if (pageKey(live.url) !== pageKey(tab.url)) return 'page_moved';
  return (await owned().inspect(session))?.manualRequired === true ? 'needs_user' : '';
}
/** Accept the current server judgment, inspect the real form, then consume at most one persisted Full automation permit. */
export async function backgroundFormReady(tab, frameId, answer) {
  const context = await backgroundContext(tab.id);
  if (!context) return false;
  if (context.mode === 'read') { await reportRead(context, {botCheck: answer.botCheck, loginWall: answer.loginWall, accountCreation: answer.accountCreation}); return true; }   // words-ok: the judge's own flag names
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
  return pressOnce(tab, frameId, context, inspected, permit, generation);
}

/** The one automatic press for a granted permit: saved before the click, refused when the tab moved or a stop was asked, pressed once, then watched for the receipt. Always true: the page is ours either way. */
async function pressOnce(tab, frameId, context, inspected, permit, generation) {
  // Persist locally before the click too: a worker restart/lost reply can never consume this permit a second time.
  await owned().patch(context.session, {attempt: permit.attempt});
  // Why (2026-10-28, owner chose "compare what the click depends on" after the Full automation e2e: the AI sketch's field labels and required marks drift after a fill, and refused every press): the page must still
  // be the tab's own address and nobody asked to stop; the press itself (background-submit.js) then re-checks the value seal, the visible enabled Submit on top, the required fields and Stop. The sketch is no longer compared.
  const refusal = await pressRefusal(tab, context.session, generation);
  if (refusal) { await backgroundChallenge(tab.id, refusal); return true; }
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
