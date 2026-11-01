// What the extension does on a sign-in or sign-up page in a tab the app opened (owner, 8 Oct 2026; the extension first, docs/flows/applying.md). The AI decides the
// judgments, in any language (it must work on thousands of sites): the page-kind AI says which step this page is and names its register and submit controls; the account
// AI (desktop/lib/account-judge.js) says, BEFORE the button, whether everything the person owes is given (a consent may be a link), and AFTER it what became of it.
// The app says whether THIS email has an account on the host (mode). The code only executes the validated answers and keeps its floors: one register press and one submit
// press per tab (a failed sign-in reloads the page, so the extension remembers), nothing pressed when the AI is absent, unsure, or sees a bot check.
// Scenarios owned: "Sign-up page before the form", "Sign-in page where we have no account". Guards: app-core/test/account-step.test.js, account-fill.test.js, npm run live.
import {apiFor, settings} from './flow.js';
import {decide} from './log.js';
import {askKind, readAgain, sayStep} from './fill-flow.js';
import {deadEnd} from './ladder/dead-end.js';
import {sessionGet} from './tab-memory.js';
import {bindSession, identityOf} from './tab-identity.js';
import {tabArmed} from './tab-pages.js';
import {fillAccountBoxes, fillAccountEmail, fillCodeBox, flagAccount, markAccountStep, passwordWork, pressAccountButton, pressConsent, pressRegister} from './account-fill.js';
import {sketchOf} from './judge-sketch.js';
import {closerLook, unsureTwice} from './ladder/rung4-picture.js';
import {pageStill} from './page-still.js';
import {notePress} from './tabs.js';
import {mayAct} from './stop-state.js';
import {markPage} from './page-mark.js';

// -> 'register' | 'switch' | 'fill-press' | 'fill' | 'leave'. step: the AI's account step ('' when it gave none); mode: the app's 'sign-in' | 'sign-up' | 'confirm'.
export function accountMove({step, mode, hasEmail, registerControl, signinControl}) {
  if (mode === 'confirm') return 'leave';   // an account was just made for this email: the app waits for its confirmation mail, nothing is pressed again
  if (!step || !hasEmail) return 'fill';   // no AI word or no email to use: the password only, as a password manager would
  if (step === 'choose') return mode === 'sign-in' && signinControl ? 'switch' : 'leave';   // "an account exists": sign in to it when it is ours, else the person decides
  if (step === 'sign_in' && mode === 'sign-up') return registerControl ? 'register' : 'leave';   // no account of ours here: never sign in
  if (step === 'sign_up' && mode === 'sign-in') return signinControl ? 'switch' : 'leave';   // we have an account here: not a sign-up; go to the page's way to sign in
  return 'fill-press';
}

// What to do when the account AI says the person must give something and the setting is 'full': accept a consent the AI named (the link, then the dialog's accept button, or a
// checkbox's label), at most three presses per tab; a choice, a code or a field is always the person's. 'assist' leaves everything to the person.
export const MAX_CONSENT_PRESSES = 3;
// What a press the floor refused means (account-fill.js pressAccountButton's reason codes): 'pressed', 'bot' (the person solves it, then presses), 'person'
// (an empty required control, no box of ours, no single button: the page goes to the person with that reason) or 'quiet' (already pressed in this tab).
// applycv e2e, 9 Oct 2026: the AI said ready, the floor found a required box empty, and nothing handed the page to the person.
export const PRESS_REASONS = {'needs-you': 'a required box is still empty', 'not-filled': 'nothing on this page was filled by us', 'no-button': 'no account button was found', 'several-buttons': 'several buttons could be the account button'};
export function pressMove(result) {
  if (result === 'pressed') return 'pressed';
  if (result === 'bot-check') return 'bot';
  if (result === 'already-pressed') return 'quiet';
  return 'person';
}
export function consentMove({automation, needsKind, needs, presses = 0, consentRequired = false}) {   // consentRequired: the AI says the account cannot be made without it (10 Oct 2026)
  return automation === 'full' && needsKind === 'consent' && consentRequired === true && !!needs && presses < MAX_CONSENT_PRESSES ? 'accept' : 'person';
}

// What the account AI's answer after the press means for us: 'confirmed' (the account exists and is usable: signed in, or the site moved on), 'pending' (it exists but
// awaits a confirmation mail, or a code the person types), 'exists' (it was there already: the sign-in is tried once), 'flag' (the person must do something: said on the
// page), 'none' (unsure or no AI: nothing is claimed).
// A page that is still at the same address (an in-place step change gives no new address to read it by) is read again when the account is usable (signed in, or the site moved on) OR when the
// AI had no word but the controls on the page are no longer the form that was pressed (structure only: the AI's judgment of what the new page is comes from that read). A page at a new
// address is read by its own navigation (never twice).
export const readsAgain = (action, samePath, formMoved = false) => !!samePath && (action === 'confirmed' || (action === 'none' && !!formMoved));
export function resultAction(answer) {
  if (answer === 'created') return 'confirmed';
  if (answer === 'created_confirm' || answer === 'needs_code') return 'pending';
  if (answer === 'already_exists') return 'exists';
  if (answer === 'refused') return 'flag';
  return 'none';
}

// One look at a time per tab (the panel asks every few seconds: a second look while the first still waits for the AI only repeats it), and an unchanged page is not judged
// again: the AI's answer is kept for the sketch it was given, so it is asked again only when the page changed (a box filled, a consent accepted, an error shown).
const looking = new Set(), judged = new Map(), lastSaid = new Map(), kinds = new Map(), unsureSeen = new Map();
// The hint on the page ("Needs you: …") belongs to the form it was flagged on. Many sites keep one address while the page changes under it (SuccessFactors: sign-up → sign-in), so the hint is
// cleared when the form's outline is no longer the flagged one (twin, 9 Oct 2026: "Solve the check" stayed on a sign-in page).
const lastOutline = new Map(), flaggedOn = new Map();
async function flag(tab, frameId, needs) {
  await run(tab, frameId, flagAccount, [needs]);
  if (needs === null) flaggedOn.delete(tab.id); else flaggedOn.set(tab.id, lastOutline.get(tab.id) || '');
}
// A decision said once per tab and kind while it stays the same (the panel looks again every 2 s: the same line over and over helps nobody).
const saidBefore = new Map();
function sayOnce(tab, kind, text, fields) {
  const mine = saidBefore.get(tab.id) || saidBefore.set(tab.id, new Map()).get(tab.id);
  if (mine.get(kind) === text) return;
  mine.set(kind, text);
  decide('fill', text, fields);
}
// The page kind of this tab's page, kept 20 s (the app remembers it too, but asking and logging it at every look is noise): a new address asks again.
// The memo's key: the address and what the page's password boxes are now (count, empty, press waiting). A single-page app changes in place at one address (sign-in -> the form
// behind it, 16 Oct 2026), and 20 s of "account" was kept for a page that was already the form.
export const kindKey = (url, work) => `${String(url || '').split('#')[0]}|${work?.boxes ?? ''}|${work?.empty ?? ''}|${work?.pending ?? ''}`;
async function askKindOnce(tab, work) {
  const key = kindKey(tab.url, work), kept = kinds.get(tab.id);
  if (kept && kept.key === key && Date.now() - kept.at < 20000) return kept.kind;
  const kind = await askKind(tab);
  kinds.set(tab.id, {key, at: Date.now(), kind});
  return kind;
}
const signature = sketch => JSON.stringify([sketch.controls, sketch.buttons, sketch.texts, sketch.frames]);
// The form's outline (its controls' types and labels, never their values or states): kept at the press, so the result look can say whether the SAME form is back.
// Many sites keep one address for every step (SuccessFactors: /career?career_ns=…), so the address alone told the AI a successful sign-in was the form again (9 Oct 2026, account eval).
export const formOutline = sketch => (sketch?.controls || []).map(item => `${item.type}:${item.label}`).join('|').slice(0, 1500);
const press = (tab, frameId, func, args = []) => { if (!mayAct()) return 'stopped'; notePress(tab.id, tab.url); return run(tab, frameId, func, args); };   // a click of ours: a tab it opens joins the application (tabs.js followOpener)
const run = (tab, frameId, func, args = []) => chrome.scripting.executeScript({target: {tabId: tab.id, frameIds: [frameId ?? 0]}, func, args}).then(rows => rows?.[0]?.result).catch(() => undefined);
const memoKey = tab => `accountForm:${tab.id}`;
// A sign-up or sign-in this extension filled (or the person pressed) whose outcome the account AI has not yet given: for two minutes the page after it is the account's, so the submit watch
// does not ask the app whether it is an application's confirmation (9 Oct 2026, Migros: three paid "did it confirm" calls on the page behind a sign-up).
export const OUTCOME_WAIT_MS = 120000;
export const outcomePending = (memo, now = Date.now()) => !!memo && now - Number(memo.at || 0) < OUTCOME_WAIT_MS;
export async function accountOutcomePending(tabId) { const key = memoKey({id: tabId}); return outcomePending((await sessionGet(key))[key]); }
const triedKey = (tab, action) => `accountPress:${tab.id}:${action}`;
const alreadyTried = async (tab, action) => !!(await sessionGet(triedKey(tab, action)))[triedKey(tab, action)];
// The extension could not finish this account page: said ONCE per tab and reason to the app, which shows what the person must do and OFFERS Claude (never starts it).
// What the person must do at a bot check: it is theirs to solve, and then the account button is theirs to press (a frame in the form stays after the check is solved, so the floor never learns it).
export const botCheckNeed = named => (String(named || '').trim() ? `Solve the check, then press "${String(named).trim().slice(0, 40)}"` : 'Solve the check, then press the account button');
// What the person is told when no password is saved for the site (account step without one: accountStepOnce). Fixed sentences of ours, never the page's.
export const NO_PASSWORD_NEED = {sign_in: 'Sign in with your password for this site', sign_up: 'Choose a password and create the account'};
const stepOf = new Map();   // tab id → the AI's step for the page being worked on (sign_in, sign_up, ...): said to the app so its card can word it
async function giveUp(tab, host, reason, needs = '') {
  const key = `stuck-${reason}-${needs}`.slice(0, 120);
  if (await alreadyTried(tab, key)) return;
  await markTried(tab, key);
  decide('fill', `account step: could not finish (${reason}): handed to the app`, {host});   // the app decides what it offers (Claude only for a Claude engine)
  await deadEnd({job: tab.url.split('#')[0], host, why: 'account', tabId: tab.id, page: tab.url, needs, accountStep: stepOf.get(tab.id) || ''}, {reason, step: stepOf.get(tab.id) || ''}, decide);
}
const markTried = (tab, action) => chrome.storage.session.set({[triedKey(tab, action)]: Date.now()}).catch(() => {});

// The account AI on what the page shows now. null when there is no AI, no answer, or the page cannot be read: then nothing is pressed or claimed.
async function judge(tab, frameId, phase, config, fromPath = '', formBefore = '') {
  const sketch = await sketchOf(tab.id, frameId);
  if (!sketch) return null;
  const outline = formOutline(sketch);
  lastOutline.set(tab.id, outline);
  if (flaggedOn.has(tab.id) && flaggedOn.get(tab.id) !== outline) await flag(tab, frameId, null);   // another form now: its hint is not this page's
  if (fromPath) sketch.fromPath = fromPath;   // where the sign-up form was: the AI sees whether the page moved on
  if (formBefore) sketch.sameForm = formOutline(sketch) === formBefore ? 'yes' : 'no';   // a fact of structure; what it means is the AI's word
  const key = `${tab.id} ${phase}`, sig = signature(sketch);
  if (judged.get(key)?.sig === sig) return judged.get(key).answer;   // the page is as it was: the same answer, no new call
  const askedAt = Date.now();
  const answer = await apiFor(tab.id, config, '/extension/account-judge', {method: 'POST', body: JSON.stringify({phase, sketch})}).catch(() => null);
  const kept = answer?.answer ? answer : null;
  decide('fill', `account judge ${phase}: ${kept?.answer || 'no answer'}`, {ms: Date.now() - askedAt});
  if (kept) judged.set(key, {sig, answer: kept});
  return kept;
}

// After a press by us or by the person (a sign-up form was open in this tab): what became of it. Said to the app, or on the page.
const outcomeBusy = new Set();
export async function accountOutcome(tab, frameId = 0) {
  const memo = (await sessionGet(memoKey(tab)))[memoKey(tab)];
  if (!memo || Date.now() - memo.at > 30 * 60 * 1000 || outcomeBusy.has(tab.id)) return;
  let path = ''; try { path = new URL(tab.url).pathname.slice(0, 120); } catch { /* no address */ }
  if (!memo.pressed && path === memo.path) return;   // nothing was pressed and the page is the same form: nothing has become of anything yet
  outcomeBusy.add(tab.id);
  try { await outcomeOnce(tab, frameId, memo); } finally { outcomeBusy.delete(tab.id); }
}
async function outcomeOnce(tab, frameId, memo) {
  const config = await settings(), host = memo.host;
  const result = await judge(tab, frameId, 'result', config, memo.path || '', memo.form || '');
  const action = resultAction(result?.answer);
  decide('fill', `account result: ${result?.answer || 'no AI'}`, {host, action});
  if (action === 'flag' && memo.signin) {   // a sign-in the site refused (any language: the account AI's word): no account for this email here. Said to the app, which answers sign-up the next look (once per tab: a rejected sign-in is never retried)
    await chrome.storage.session.remove(memoKey(tab)).catch(() => {});
    const id = await identityOf(tab);
    decide('fill', 'sign-in refused: sign-up next', {host});
    apiFor(tab.id, config, '/extension/event', {method: 'POST', body: JSON.stringify({type: 'account-pressed', host, url: id.url, job: id.job, state: 'refused', session: id.session, boot: id.boot})}).catch(() => {});
    return;
  }
  if (action === 'flag') { await flag(tab, frameId, result.needs || ''); await giveUp(tab, host, 'the site did not accept it', result.needs || ''); return; }   // the form stays: the person finishes it, and the memo stays for the next look
  let here = ''; try { here = new URL(tab.url).pathname.slice(0, 120); } catch { /* no address */ }
  const inPlace = here === memo.path;
  if (action === 'none') {
    if (readsAgain(action, inPlace, !!memo.form && lastOutline.get(tab.id) !== memo.form)) { await chrome.storage.session.remove(memoKey(tab)).catch(() => {}); readAgain(tab, (await identityOf(tab)).job).catch(() => {}); }   // the form we pressed is gone: the new page is read (once: the memo goes)
    return;
  }
  await chrome.storage.session.remove(memoKey(tab)).catch(() => {});
  const id = await identityOf(tab);
  apiFor(tab.id, config, '/extension/event', {method: 'POST', body: JSON.stringify({type: 'account-pressed', host, url: id.url, job: id.job, state: action, session: id.session, boot: id.boot})}).catch(() => {});
  if (readsAgain(action, inPlace)) readAgain(tab, id.job).catch(() => {});   // the account is usable: the page it brought (often the same address) is read and filled as any other
  // The page asks for the code the site mailed (owner, 10 Oct 2026): in "Do it for me" the app reads it from Gmail (the AI picks it) and this types it into the box
  // the account AI named, then presses the form's button once (pressAccountButton's floors). The code is never logged; "Let me check each step": the person types it.
  if (result?.answer === 'needs_code') {
    const got = await apiFor(tab.id, config, '/extension/account-code', {method: 'POST', body: JSON.stringify({host, needs: result.needs || '', ...id})}).catch(() => null);
    if (!got?.code) { decide('fill', `account code: left to the person (${got?.why || 'no answer'})`, {host}); return; }
    const filled = await run(tab, frameId, fillCodeBox, [result.needs || '', got.code]);
    decide('fill', filled ? 'account code: typed from the mail' : 'account code: no box to type it in', {host});
    if (filled) { tellFact(config, tab, host, 'code'); decide('fill', `account code: button ${await press(tab, frameId, pressAccountButton, [''])}`, {host}); }   // the record says a code came from the mail, never the code
  }
}

// What the extension did on the account page, for the session card's record (lib/application-journey.js invariant 6): a consent accepted (its wording) or a code typed (never its value).
function tellFact(config, tab, host, fact, text = '') {
  identityOf(tab).then(id => apiFor(tab.id, config, '/extension/event', {method: 'POST', body: JSON.stringify({type: 'account-fact', fact, text: String(text).slice(0, 80), host, url: id.url, job: id.job, session: id.session, boot: id.boot})})).catch(() => {});
}

export async function accountStep(tab, frameId) {
  if (looking.has(tab.id)) return {filled: 0};   // a look at this tab is still running
  looking.add(tab.id);
  try { return await accountStepOnce(tab, frameId); } finally { looking.delete(tab.id); }
}

async function accountStepOnce(tab, frameId) {
  const armedKey = `armed:${tab.id}`;
  if (!mayAct()) return {filled: 0};   // stopped by the person (stop.js)
  if (!tabArmed({url: tab.url, armed: (await sessionGet(armedKey))[armedKey]})) return {filled: 0};
  const host = new URL(tab.url).hostname, config = await settings();
  if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {filled: 0};   // your own Worker: no Keychain
  // Cheap first, in the page: nothing to fill and no press waiting means nothing to ask the app (an account + application page was looked at every 2 s for nothing, 8 Oct 2026).
  const work = await run(tab, frameId, passwordWork);
  if (work && work.boxes > 0 && !work.empty && !work.pending) return {filled: 0};   // every password box has its value and no press waits (a page with no password box, e.g. an "account exists" notice, is still looked at)
  const kind = await askKindOnce(tab, work);
  const step = kind?.kind === 'account' ? kind.accountStep || '' : '';
  await run(tab, frameId, markAccountStep, [step]);
  stepOf.set(tab.id, step);
  if (work && !step && !work.empty) return {filled: 0};   // no step the AI knows: the password only, and every box already has one
  const id = await identityOf(tab);
  const answer = await apiFor(tab.id, config, '/extension/site-password', {method: 'POST', body: JSON.stringify({host, session: id.session, job: id.job, url: id.url, boot: id.boot})});
  await bindSession(tab.id, answer?.session, id.session);   // the app resolved which application this tab is (by its job): kept for the next report
  if (!answer?.ok || !answer.password) {
    // No password saved for this site: the person signs in, or chooses one to create the account. The run names that need once, never a silent stop (the outcome contract's
    // 'handed', spec docs/superpowers/specs/2026-10-12-one-next-move.md phase 1a; recorded case sign-in-then-form-1). Only the need, never a password value; an account just made
    // waits for its mail ('confirm'): nothing to name. An app that answered "no" (ok false: nothing saved or readable) leaves the same need, and an email-first page (the password box comes only after the email:
    // no box at all yet, work.boxes 0) names it too: never a silent stop (13 Oct pool: 6 of 11 silent stops; recorded case email-first-no-password-1). Once the person has signed in, the next page is judged and filled as any other.
    if (answer && answer.mode !== 'confirm' && NO_PASSWORD_NEED[step] && (work?.empty > 0 || work?.boxes === 0)) await giveUp(tab, host, 'no saved password', NO_PASSWORD_NEED[step]);
    return {filled: 0};
  }
  const move = accountMove({step, mode: answer.mode, hasEmail: !!answer.email, registerControl: kind?.registerControl, signinControl: kind?.signinControl});
  const said = `${move} ${step} ${answer.mode}`;
  if (lastSaid.get(tab.id) !== said) { lastSaid.set(tab.id, said); decide('fill', `account page: ${move}`, {host, step, mode: answer.mode || ''}); }   // said when it changes, not at every look
  if (move === 'leave') {
    if (answer.mode !== 'confirm' && step) await giveUp(tab, host, 'no way forward on this page');   // 'confirm' waits for its mail; anything else the extension cannot continue
    return {filled: 0};
  }
  if (move === 'register' || move === 'switch') {   // the page's own way to the other form: to create an account (no account of ours here), or to sign in (we have one)
    if (!(await alreadyTried(tab, move))) {
      const result = await press(tab, frameId, pressRegister, [move === 'register' ? kind.registerControl : kind.signinControl]);
      if (result === 'pressed') await markTried(tab, move);
      sayOnce(tab, 'control', `${move} control: ${result}`, {host});
      if (result === 'not-found') await closerLook(tab, frameId, `the ${move} control the AI named was not found`);   // opt-in (lib/ladder/rung4-picture.js)
    }
    return {filled: 0};
  }
  if (step === 'sign_in' && answer.mode === 'sign-in' && answer.email && await run(tab, frameId, fillAccountEmail, [answer.email])) sayOnce(tab, 'email', 'sign-in page: email filled', {host});   // the normal fill does not run again on a same-address page
  const filled = await run(tab, frameId, fillAccountBoxes, [answer.password]) || 0;
  if ((step === 'sign_up' && answer.mode === 'sign-up') || (step === 'sign_in' && answer.mode === 'sign-in')) await chrome.storage.session.set({[memoKey(tab)]: {host, at: Date.now(), path: new URL(tab.url).pathname.slice(0, 120), signin: step === 'sign_in'}}).catch(() => {});   // a sign-up (or a sign-in we expect to work) form is open in this tab: what becomes of it is the account AI's word
  if (filled) decide('fill', 'password filled from the Keychain', {host, boxes: filled});
  const submitKey = `submit-${step}`;   // one press per tab and STEP: a sign-up pressed here must not block the sign-in that follows in the same tab
  if (move === 'fill-press' && !(await alreadyTried(tab, submitKey))) {
    const ready = await judge(tab, frameId, 'ready', config);   // also when nothing new was filled: a page the person finished since is pressed
    if (ready?.answer === 'unsure' && unsureTwice(unsureSeen, tab.id, JSON.stringify([ready.needs, step, answer.mode]))) await closerLook(tab, frameId, 'the AI was unsure twice about this page');   // opt-in (lib/ladder/rung4-picture.js)
    if (!ready || ready.answer !== 'ready' || ready.botCheck) {
      const key = `accountConsent:${tab.id}`, presses = Number((await sessionGet(key))[key]) || 0;
      const accept = ready && !ready.botCheck && ready.answer === 'needs_person' && consentMove({automation: answer.automation, needsKind: ready.needsKind, consentRequired: ready.consentRequired, needs: ready.needs, presses}) === 'accept';
      if (accept) {   // the owner's setting: the extension accepts the account's consent itself (link, dialog, checkbox), then looks again
        await chrome.storage.session.set({[key]: presses + 1}).catch(() => {});
        const pressed = await press(tab, frameId, pressConsent, [ready.needs]);
        decide('fill', `consent accepted: ${pressed}`, {host, press: presses + 1});
        if (pressed === 'pressed') tellFact(config, tab, host, 'terms', ready.needs);   // the session card's record: which terms were accepted, in the page's own words
      } else {
        sayOnce(tab, 'button', `account button: not pressed (${ready ? (ready.botCheck ? 'a bot check' : ready.answer) : 'no AI'})`, {host, automation: answer.automation || ''});
        if (ready && (ready.botCheck || ready.answer === 'needs_person')) await flag(tab, frameId, ready.botCheck ? botCheckNeed(kind?.accountButton) : ready.needs || '');
        await giveUp(tab, host, !ready ? 'no AI answer' : ready.botCheck ? 'a bot check' : 'something only the person can give', ready?.botCheck ? botCheckNeed(kind?.accountButton) : ready?.needs || '');
      }
    } else {
      await flag(tab, frameId, null);   // nothing is owed any more: the panel stops saying so
      sayStep(tab.id, 'Creating your account…');
      const form = formOutline(await sketchOf(tab.id, frameId));   // the form as it is pressed
      await pageStill(tab.id, {maxMs: 800});   // the form settles after its fill (page-still.js), at most the old 0.8 s
      const result = await press(tab, frameId, pressAccountButton, [kind?.accountButton || '']);
      sayOnce(tab, 'button', `account button: ${result || 'not run'}`, {host});
      if (result === 'bot-check') { const need = botCheckNeed(kind?.accountButton); await flag(tab, frameId, need); await giveUp(tab, host, 'a bot check', need); }   // the floor's word: the person solves it and presses the button
      else if (pressMove(result) === 'person') { await flag(tab, frameId, kind?.accountButton || ''); await giveUp(tab, host, PRESS_REASONS[result] || 'the account button was not pressed', kind?.accountButton || ''); }   // the floor refused: the page is the person's, with why
      if (result === 'pressed') {
        markPage(tab.id, 'signing', false, {accountStep: step});   // "Logging in…" on the panel and the desktop (page-mark.js)
        await markTried(tab, submitKey);   // pressed once; what became of it is the account AI's word, a moment later (here, or on the next page)
        await chrome.storage.session.set({[memoKey(tab)]: {host, at: Date.now(), path: new URL(tab.url).pathname.slice(0, 120), pressed: true, form, signin: step === 'sign_in'}}).catch(() => {});
        sayStep(tab.id, 'Waiting for the site to accept it…');
        await pageStill(tab.id, {maxMs: 4000, afterChange: true});   // the site's answer: once the page changed and went still, at most the old 4 s
        await accountOutcome(await chrome.tabs.get(tab.id).catch(() => tab));
      }
      sayStep(tab.id, '');   // the step is over, pressed or not: no "Creating your account…" left spinning on a page where nothing happens (owner's screenshot, 9 Oct 2026)
    }
  }
  return {filled};
}
