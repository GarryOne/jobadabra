// The fill flow (moved out of background.js, 8 Oct 2026): what one page of an application's journey is (the AI's kind, the structure rule
// without AI), and what the extension does there: press a posting's Apply, fill the form, or report it can't reach one ("account",
// "no-form"). Scenarios owned: "Direct application form", "Posting → Apply", "What kind of page", "Sign-up page before the form"
// (docs/flows/applying.md). Guards: extension-tab-pages.test.js, extension-same-tab.test.js, page-kind.test.js and the e2e rows (npm run flows).
// background.js hands over what lives on with the worker (initFillFlow): the tabs a fill started on, the fill itself, its report, onPage.
// Invariants (flow core: read before editing; changing one is the owner's call, said in the commit; each names the test that guards it):
//  1. Apply is pressed once per tab and page; only a reload or the person's "Apply on this page" clears that, never a press itself (dede94a, 6065c87; desktop/e2e/test/real-extension.test.mjs).
//  2. A popup is closed before the page is read, and a link that leaves the page is never pressed (fdd9638; worker/test/visit-consent.test.js, worker/test/popup-page.test.js).
//  3. A fill that put nothing in climbs the closer-look ladder, then reports 'incomplete', kept until something is filled (c1a2fcc; desktop/test/session-flow.test.js).
//  4. After a fill the AI is asked what the page needs next; a middle step's Next is pressed under the Submit floors, Submit never (worker/test/form-ready.test.js).
import {backgroundMayFill, backgroundPage} from './background-apply.js';
import {PAGE_FILES, apiFor, askEarly, clickCombos, forgetGivenUp, settings} from './flow.js';
import {decide} from './log.js';
import {laterLookIsForm} from './later-look.js';
import {retireFill} from './one-fill.js';
import {handoffKey} from './ready-handoff.js';
import {noteRole} from './account.js';
import {expandSections} from './sections.js';
import {closeConsentEverywhere} from './consent.js';
import {sweepConsent} from './consent-sweep.js';
import {closerLook, lastLook} from './ladder/rung4-picture.js';
import {formNext, handGivenUpToPerson} from './form-ready.js';
import {accountOutcome, accountStep} from './account-step.js';
import {applyPressed, moveTab} from './tabs.js';
import {noJobPage} from './page-kind-final.js';
import {markPage} from './page-mark.js';
import {isStopped} from './stop-state.js';
import {pageStill} from './page-still.js';
import {STILL_MS, readWhileDrawing} from './ladder/still-drawing.js';
import {bindSession, identityOf, sessionOf} from './tab-identity.js';
import {formCame, pageKey, pageRole} from './tab-pages.js';
import {restoreLostQuery} from './restore-query.js';
import {restartFromPosting} from './restart-from-posting.js';
import {applyPhrases, pressApply, wouldPress} from './apply-press.js';
import {forgetNoEffect, noEffectOf, noteNoEffect} from './no-effect.js';
import {clickTrace, modalTrace} from './ladder/press-why.js';
import {forgetRouteTries, startRoute} from './start-route.js';
import {emailReport, mailsOf} from './ladder/outcomes.js';
import {brokenOf, closedReport, onBrokenPage} from './ladder/site-broken.js';
import {deadEnd, useFallback, useReporter} from './ladder/dead-end.js';
import {notePage, noteProgress, useProgressLog} from './ladder/progress.js';
import {onTop} from './on-top.js';
import {labelReaderIn, pageShape, pageSketchOf} from './page-reads.js';
import {setApply} from './apply-state.js';
import {dropIfLate, openRead} from './read-gen.js';
import {blindOn, blindOr, candidatesOf, claimFrame, climbOnStall, confirmedBody, digestAsked, frameBecameCandidate, climbOnUnsure, controlsOf, forgetClimb, frameSketch, frameSrcOf, framesOf, noteFrames, notePressed, noteSignal, otherReport, takePressed, toldReport, verifiedBody} from './ladder/climb.js';

let started = new Set(), fillOpenedTab = async () => null, reportFlow = async () => {}, onPage = async () => true, fillsNow = new Set(), arm = async () => {}, progress = async () => {};
export function initFillFlow(shared) {
  ({started, fillOpenedTab, reportFlow, onPage, fillsNow = new Set(), arm = async () => {}, progress = async () => {}} = shared);
  chrome.runtime.onMessage.addListener(onFillOne);
}

// "Use" on the app's Needs your attention row, passed on by the form's panel (review.js stays read only): that one field is filled
// in the page by the extension's own fill (page/propose.js), the page scripts loaded first if a reload took them. Logged without the value.
function onFillOne(message, sender, reply) {
  if (message?.type !== 'panelFillOne' || !sender.tab) return false;
  const tabId = sender.tab.id, label = String(message.label || '').slice(0, 120), value = String(message.value || '').slice(0, 200);
  const run = () => chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', args: [label, value],
    func: (l, v) => (window.__jobPilottoFillOne ? window.__jobPilottoFillOne(l, v) : {ok: false, missing: true})}).then(([frame]) => frame?.result || {ok: false});
  // Never while this tab's fill is still running: its last pass arms and clicks the menus again and overrode the app's pick (8 Oct 2026, the
  // live twin: "Suisse" picked at 20:13:35, "Allemagne" after the fill's last pass at 20:13:42). Waits for it, at most 90 s.
  const fillDone = async () => { for (let waited = 0; fillsNow.has(tabId) && waited < 90000; waited += 300) await new Promise(resolve => setTimeout(resolve, 300)); };
  fillDone().then(run).then(async result => {
    if (result.missing) {
      await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func: () => { window.__jobPilottoNoGuard = true; }});
      await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', files: PAGE_FILES});
      result = await run();
    }
    // A menu armed with the app's choice (the one that means the same: "Suisse" for "+41") is picked at once when "Fill drop-down menus too" is
    // on, as during the fill; it used to wait for your click every time (owner, 8 Oct 2026: "why are we always stopped at this field?").
    if (!result.ok && result.armed && (await settings()).clickDropdowns !== false) {
      const combos = await clickCombos(tabId).catch(() => []);
      const same = text => String(text || '').replace(/^[\s*]+|[\s*:]+$/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      const mine = combos.find(combo => combo.picked && same(combo.label) === same(label));
      if (mine) result = {...result, ok: mine.matched !== false, armed: false, picked: true, matched: mine.matched};
    }
    decide('fill', result.picked ? (result.matched === false ? 'a menu click selected another choice than asked, asked from the app' : 'a menu picked for you, asked from the app') : result.ok ? 'filled one field asked from the app' : result.armed ? 'a menu armed for your click, asked from the app' : 'could not fill one field asked from the app',
      {field: label.slice(0, 60), translated: !!result.translated, ...(result.picked ? {matched: result.matched !== false} : {})});
    reply({ok: !!result.ok, armed: !!result.armed});
  }).catch(error => reply({ok: false, error: String(error?.message || error)}));
  return true;
}

// Counts only, in the page: no labels and no values. Passwords and file inputs are counted apart from the rest.
// The page's kind from the app (the AI's answer, kept per site and page shape), or null: then the structure rule decides alone.
// The kept kind was wrong for this page: the app drops it (desktop/lib/page-kind.js forgetPageKind) and the next visit asks again.
async function forgetKind(tab, kind, reason) {
  await labelReaderIn(tab.id);
  const sketch = await pageSketchOf(tab.id);
  decide('fill', `page kind corrected: ${reason}`, {was: kind?.kind || '', by: kind?.by || ''});
  try {
    const config = await settings();
    if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return;
    await apiFor(tab.id, config, '/extension/page-kind', {method: 'POST', body: JSON.stringify({forget: true, reason, kind: kind?.kind || '', url: tab.url.split('#')[0], ...(sketch || {})})});
  } catch { /* the app is closed: asked again once it is back */ }
}
// What the person sees while the app waits for the AI (the panel's step line; nothing is drawn when the tab has no panel yet). Never throws.
export const sayStep = (tabId, text) => progress(tabId, text).catch(() => {});
export async function askKind(tab, {fresh = false, digest = false, shadow = false} = {}) {   // fresh: the page changed after a press, a kept answer for its shape does not apply (start-route.js); shadow: the dead-end question (ladder/fallback.js)
  const askedAt = Date.now();   // the three ways this returns null with no word from the app are logged below (Hornbach 0.9.176: null after 2.1 s, nothing said which)
  await labelReaderIn(tab.id);
  const sketch = await pageSketchOf(tab.id);
  if (!sketch) { decide('fill', 'page kind not asked: the page could not be sketched', {ms: Date.now() - askedAt, digest}); return null; }
  if (fresh || digest) decide('fill', 'page sketched for a second look', {fresh, digest, buttons: sketch.buttons?.length ?? 0, ...(await modalTrace(tab.id) || {})});   // the dialogs the page shows now (counts)
  const frameList = await framesOf(tab.id); noteFrames(tab.id, frameList); sketch.frameCandidates = frameSketch(frameList);   // the addresses stay in the extension (ladder/climb.js)
  sketch.mails = await mailsOf(tab.id);   // the sentences and mailto links that carry an address (ladder/outcomes.js)
  sketch.onTop = await chrome.scripting.executeScript({target: {tabId: tab.id, frameIds: [0]}, func: onTop}).then(rows => rows?.[0]?.result ?? null).catch(() => null);   // a dialog or overlay drawn over the page, by structure (on-top.js): the AI is told
  try {
    const config = await settings();
    if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return null;   // your own Worker: no app to ask
    const answer = await Promise.race([apiFor(tab.id, config, '/extension/page-kind', {method: 'POST', body: JSON.stringify({url: tab.url.split('#')[0], ...(fresh ? {fresh: true} : {}), ...(noEffectOf(fillKey(tab.id, tab.url)).length ? {noEffect: noEffectOf(fillKey(tab.id, tab.url))} : {}), ...(digest ? {digest: true, candidates: await candidatesOf(tab.id)} : {}), ...sketch})}),
      new Promise(resolve => setTimeout(() => resolve(null), 40000))]);   // a first visit asks the AI cold (the app's AI is the `claude` command: 5-25 s); the structure rule decides only after this, and a wrong rule costs more than the wait
    if (answer == null) decide('fill', 'page kind: the app gave no answer in time', {ms: Date.now() - askedAt, digest});   // an answer WITH an error is the app's own line (server-pages.js)
    if (shadow) return answer;   // the dead-end question in shadow: no climb signal, any answer (an unsure or failed one too) goes to its log
    noteSignal(tab.id, answer, sketch.controls);   // which rung answered and with what signal: an unsure one climbs (ladder/climb.js)
    return answer?.role ? answer : null;
  } catch (error) { decide('fill', 'page kind: the app could not be asked', {class: String(error?.name || 'Error').slice(0, 40), ms: Date.now() - askedAt, digest}); return null; }   // the class only: a message can carry page text
}
// Claude reads this on <html data-jobpilotto-fill>. States: running, done, error, no-form, account. A fill's end goes only into the page it started on (its token, kept in this script world; 13 Oct 2026: a sign-up page's "done" landed on the form after it). Guard: worker/test/fill-mark-own-page.test.js. Only JSON states go here; the fill's card id has its own <html data-jobpilotto-fill-id> (fill-card.js markCardId).
export function writeState(tabId, value, token = '') {
  return chrome.scripting.executeScript({target: {tabId}, args: [JSON.stringify(value), token, value.state],
    func: (text, token, now) => { if (now === 'running') window.__jobPilottoFillToken = token; else if (token && window.__jobPilottoFillToken !== token) return false; if (document.documentElement) document.documentElement.dataset.jobpilottoFill = text; return true; }})
    // Why (#2221 "the fill writing its end frees the page at once", kept 2026-10-27 under the one state owner): the fill's end on its own page is the worker's verdict, said at once, not after the bookkeeping that follows (reports, notes, dialogs):
    // the person's first click after "done" is theirs (the apply suite's Next and Submit were held). `account` hands the page over. A write the token refused (another page's end) says nothing; a later step brings `working` back (background.js progress).
    .then(rows => { if (rows?.[0]?.result && !['running', 'received'].includes(value.state)) setApply(tabId, value.state === 'account' ? 'your-turn' : 'done'); }, () => {});
}
// A page with no form control of any kind (fill-flow consider waits for it to stop growing before its kind is asked).
export const BOT_CHECK_NEED = "This site wants a quick check: solve it, then I'll continue";   // said in the panel and the session (owner, 20 Oct 2026: the person solves a real captcha, we never do; the form fills after it) (desktop/lib/terminals.js noteStuck)
export const emptyShape = counts => !counts.fields && !counts.passwords && !counts.files && !counts.anyFiles && !counts.textareas && !counts.choices;
// After the press: the form shows up on this page (a single-page site), or the tab goes to another page (its own load runs the
// whole decision again). null when neither happens in time.
async function formAfterPress(tabId, url, ms = 8000, before = null) {   // before: the page's shape before the press (tab-pages.js formCame)
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await pageStill(tabId, {maxMs: 1000});   // the press's result as soon as the page stops changing (page-still.js), at most the old second
    const live = await chrome.tabs.get(tabId).catch(() => null);
    if (!live) return 'navigated';   // closed: Apply's new tab is the application now (same-tab.js), not a page with "no form"
    if (pageKey(live.url) !== pageKey(url)) return 'navigated';
    const counts = await pageShape(tabId);
    if (counts && formCame(before, counts, live.url)) return counts;   // not the controls the page already had (a search or alert form beside Apply)
  }
  return null;
}
// The app is told the extension can't get to this form (its session offers "Apply with Claude"): why, and the site.
// `page`: the page this is about. A tab that has moved on (the account made, the form loaded) sends nothing: a late "account" moved a
// session back from the form to the account step (8 Oct 2026, the matrix's sign-up row). The app checks it too (lib/session-flow.js).
export async function stuck(job, host, why, tabId = null, page = '', needs = '', accountStep = '') {
  if (tabId != null && page && !(await onPage(tabId, page))) { decide('fill', 'the page moved on: no "can\'t reach" report for it', {host, why}); return; }
  if (tabId != null) await sweepConsent(tabId, 'reporting the form as out of reach');   // a hold or error never leaves a cookie layer open
  const session = await sessionOf(tabId);
  try { await apiFor(tabId, await settings(), '/extension/event', {method: 'POST', body: JSON.stringify({type: 'stuck', url: job, host, why, needs: String(needs || '').slice(0, 80), accountStep: String(accountStep || '').slice(0, 16), tab: tabId, session, page: String(page || '').split('#')[0]})}); } catch { /* the app is closed */ }
}
useReporter(stuck);   // the only way to it: every give-up goes through ladder/dead-end.js deadEnd (worker/test/dead-end.test.js)
// In the CI pool only (the harness's ladderAct switch), the move the one rule lets act is pressed through the live Apply press and its effect checked: a form on the page, or a new page with fields.
const actOnMove = async (tab, move) => {
  if (!(await backgroundMayFill(tab.id))) return;
  const key = fillKey(tab.id, tab.url);
  applyPressed.set(tab.id, {at: Date.now(), url: tab.url});
  const before = await pageShape(tab.id);   // the controls the page had before this press: not a form the press brought
  const attempt = await pressApply(tab.id, [{key: 'apply_button', phrase: move.named}], move.named, '', noEffectOf(key));
  if (!attempt.pressed) { applyPressed.delete(tab.id); return {}; }
  const after = await formAfterPress(tab.id, tab.url, 8000, before);
  if (after === 'navigated') { const live = await chrome.tabs.get(tab.id).catch(() => null); const counts = live ? await pageShape(tab.id) : null; return {navigated: true, fields: (counts?.fields || 0) + (counts?.textareas || 0)}; }
  return after ? {form: true} : {};
};
useFallback({ask: askKind, floor: wouldPress, asked: digestAsked, log: decide, acts: async () => (await settings().catch(() => null))?.ladderAct === true, act: actOnMove, look: (tab, why) => closerLook(tab, 0, `dead end (${why}): the digest was asked, no way on found`, {kind: 'page', picture: true})});   // the one question at each dead end, in shadow; acting only in the CI pool (ladder/fallback.js)
useProgressLog(decide);   // the run's progress, in shadow (ladder/progress.js): the silent dead-end rule's T is measured from these lines
// A give-up on this page: the one door (ladder/dead-end.js), with what led here as fixed values.
const deadEndHere = (tab, jobUrl, host, why, needs, evidence) => deadEnd({job: String(jobUrl || tab.url).split('#')[0], host, why, tabId: tab.id, page: tab.url, needs}, evidence, decide);
const triedApply = new Set();
// A refresh the person pressed is a new document: its Apply may be pressed again (Deloitte, 10 Oct 2026: after ⌘R nothing happened). Not after every press: a posting whose Apply opened the form in another tab must not press it a second time (beta e2e applycv, Windows).
export const forgetApplyTries = tabId => { forgetNoEffect(tabId); forgetRouteTries(tabId); forgetClimb(tabId); for (const key of [...triedApply]) if (key.startsWith(`${tabId} `)) triedApply.delete(key); };
// A page loaded again at the person's word (their refresh, "Apply on this page", the app's reload command): the tab's pages are looked at again and the fill running on the old document is retired. The one place that forgets, whichever way the reload reached the worker (never a press-induced navigation: Invariant 1).
export const tabReloaded = tabId => {
  retireFill(tabId);
  forgetApplyTries(tabId);
  chrome.storage.session.remove(handoffKey(tabId)).catch(() => {});   // the night's hand-off is asked for again by the new document (ready-handoff.js)
  for (const key of [...started]) if (key === tabId || (typeof key === 'string' && key.startsWith(`${tabId} `))) started.delete(key);
};
export const fillKey = (tabId, url) => `${tabId} ${pageKey(url)}`;
// A page judged "no form" while it had no field at all may still be drawing its form (a spinner first, or a sign-in that redirects to it:
// SuccessFactors, 9 Oct 2026, where the form came after the judgment and neither the fill nor the panel ever came back). For 20 s it is read
// again; once it has fields the panel is put back (a page that replaced its document lost it) and the page is judged again (a new shape for
// the page-kind AI), then filled. Once per tab and page. Guard: desktop/test/extension-look-again.test.js.
const lookedAgain = new Set();
async function watchForFields(tab, jobUrl, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), looks = 10, seenHosts = null, onEnd = null) {   // onEnd: the verdict, said once the watch ends with no form
  const key = fillKey(tab.id, tab.url);
  if (lookedAgain.has(key)) { if (onEnd) await onEnd(); return false; }   // looked at once already: the verdict stands
  // The frame hosts the judgment saw (its page shape); one that shows up since, even before this watch started, makes the page be judged again (twin, 9 Oct 2026:
  // the check's frame was there at the judgment with no address yet, so the sketch read nothing and the frame count never changed).
  const hadHosts = seenHosts === null ? (await pageShape(tab.id))?.frameHosts || [] : seenHosts, hadFrames = hadHosts.length > 0;
  const hostOf = url => { try { return new URL(url).hostname; } catch { return ''; } };
  decide('fill', 'watching a page judged without a form', {host: hostOf(tab.url), looks, frames: hadFrames});   // why a late form or check was (not) seen: twin, 9 Oct 2026
  for (let i = 0; i < looks; i++) {
    await wait(2000);
    const live = await chrome.tabs.get(tab.id).catch(() => null);
    // The same page when only its query string changed (a bot-check service appends its own parameter after the load: SmartRecruiters, 9 Oct 2026).
    const samePage = url => { try { const a = new URL(url), b = new URL(tab.url); return a.origin === b.origin && a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, ''); } catch { return false; } };
    if (!live || !samePage(live.url)) { decide('fill', 'watch ended: the tab moved on', {host: hostOf(tab.url), after: (i + 1) * 2, closed: !live, sameHost: !!live && hostOf(live.url) === hostOf(tab.url)}); return false; }   // the next page decides for itself
    await sweepConsent(tab.id, 'watching a page without a form');   // a banner that drew itself after the first look (consent-sweep.js)
    const shape = await pageShape(tab.id);
    // Fields came (the form drew late), or a frame did on a page that had none (a bot check injected seconds after the load: SmartRecruiters,
    // 9 Oct 2026): the page is judged again, now with what it shows (page-kind AI: bot_check).
    const newHost = (shape?.frameHosts || []).some(host => !hadHosts.includes(host));
    // ...or a frame that was there but became a form-frame candidate since (Datadog, 11 Oct 2026: the embed is born 150 px high and grows): by address (ladder/climb.js frameGrew).
    const framed = newHost || (!!shape && await frameBecameCandidate(tab.id));
    if (!shape || (shape.fields + shape.textareas + shape.files < 2 && !framed)) continue;
    lookedAgain.add(key);
    started.delete(key);
    if (framed) await forgetKind(tab, null, newHost ? 'a frame appeared' : 'a frame became a form-frame candidate');   // a kept answer for this page shape never saw the frame (Datadog: it grew; Ocado: the Apply press opened it)
    let host = ''; try { host = new URL(live.url).hostname; } catch { /* no address */ }
    decide('fill', framed ? 'a frame appeared on a page judged without a form: looking again' : 'fields appeared on a page judged without a form: looking again', {host, fields: shape.fields + shape.textareas + shape.files, frames: shape.frames || 0, after: (i + 1) * 2});
    noteProgress(tab.id, 'new_controls', {fields: shape.fields + shape.textareas + shape.files, frames: shape.frames || 0});
    await arm(tab.id, 'fields appeared');
    setApply(tab.id, 'working');   // Why (2026-10-27, review bot on #2281): the page changed under the watch, so the run is on again: its steps and dim were dropped after the hand-over
    await consider(live, jobUrl);
    return true;
  }
  decide('fill', 'watch ended: no form and no new frame', {host: hostOf(tab.url), after: looks * 2});
  if (onEnd) await onEnd();
  await sweepConsent(tab.id, 'the watch ended');   // the run ends here: no cookie layer is left open
  return false;
}
// A broken page (ladder/site-broken.js), with the flow's own parts: a load again forgets this page's start first (its load considers it anew), the report is the 'site_broken' dead end.
function brokenPage(tab, jobUrl, key, counts) {
  let host = ''; try { host = new URL(tab.url).hostname; } catch { /* no address */ }
  return onBrokenPage(brokenOf(counts), {key, tabId: tab.id, status: counts?.status, host, decide, wait: ms => new Promise(resolve => setTimeout(resolve, ms)), say: text => sayStep(tab.id, text),
    reload: async () => { started.delete(key); await chrome.tabs.reload(tab.id).catch(() => {}); }, report: async need => (await restartFromPosting(tab, jobUrl, {decide})) || deadEndHere(tab, jobUrl, host, 'site_broken', need, {kind: brokenOf(counts) || '', status: counts?.status || 0})});
}
// One page of an armed tab. A form is filled. A password page and a page with no form are left for Claude,
// and the page says which, so Claude does not wait for a fill that will not come.
// An answer that arrives after a newer read of the tab began is about a page this tab has moved past: dropped and logged, the newer read decides (read-gen.js).
// A read dropped as late gives its page's key back (17 Oct 2026, SuccessFactors journey: the form's answer was dropped, the tab came back to that page, `started` still held it and nothing read it again).
const late = (tab, gen, what) => { if (!dropIfLate(tab.id, gen, fillKey(tab.id, tab.url), started)) return false; decide('fill', 'late answer dropped: a newer read of this tab answered', {what, host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })()}); return true; };
// What the picture's look said about a blind page (the digest: the way on is not in its list): confirmed when the control it named led to a form, which the list lacked (the CI pool's daily rate:
// e2e/lib/picture-asks.mjs). Kept out of consider(): a verdict is a log line, not a decision (tools/decision-branches.mjs).
const blindVerdict = (blindLook, look, led) => { if (blindLook) decide('fill', led ? "blind spot confirmed: the picture's control led to a form" : 'blind spot not confirmed: the picture found no way on', {look}); };
// The page moved on IN PLACE after a press of ours that was not a fill (an accepted sign-in: the next step keeps the address, so its read key is the one already read): the key is
// forgotten and the page is read once more, as after the closer look's press below (Richemont Workday, 16 Oct 2026: signed in, then "Logging in…" for good, My Information never read).
export async function readAgain(tab, jobUrl) {
  started.delete(fillKey(tab.id, tab.url));
  await pageStill(tab.id, {maxMs: 1500});
  return consider(tab, jobUrl);
}
export async function consider(tab, jobUrl) {
  if (isStopped()) return;   // stopped by the person: nothing is read, pressed or filled until they press Apply again (stop.js)
  if (!(await backgroundMayFill(tab.id))) return;
  const key = fillKey(tab.id, tab.url);
  if (started.has(key)) return;
  started.add(key);
  notePage(tab.id, key, {job: jobUrl || tab.url, page: tab.url});   // a new page in the tab is progress, for this application (ladder/progress.js)
  if (await restoreLostQuery(tab, jobUrl, {decide})) return;   // Why (27 Oct 2026, fair round form 264402): a redirect dropped the posting's ?job id, the embed showed its list; only the tab's first look may reopen it, before anything is read (restore-query.js)
  await pageStill(tab.id, {maxMs: 1500});   // the form renders after the load event: read once the page has been still 0.5 s, at most the old 1.5 s (page-still.js)
  const live = await chrome.tabs.get(tab.id).catch(() => null);
  const gen = openRead(tab.id, key, started, !live || pageKey(live.url) !== pageKey(tab.url));
  if (!gen) return;   // only a read that goes on makes older ones late: one that found the tab moved on (above) must not kill the read of the page the tab is on now
  // A popup over the page (a cookie banner: Deloitte, 9 Oct 2026; any other, in any flow) is closed the way a person would, before the page is read (consent.js).
  const banner = await closeConsentEverywhere(tab.id, {cookiesOnly: true}).catch(() => '');
  if (banner) { decide('fill', 'closed a popup', {label: banner.slice(0, 40), tab: tab.id}); sayStep(tab.id, `Closed a popup ("${banner.slice(0, 30)}")`); await pageStill(tab.id, {maxMs: 800}); }
  await expandSections(live);   // a form drawn with collapsed sections (SuccessFactors) is read open, or it looks empty and is judged "no form" (sections.js)
  // The page can refuse a read right after its load (still swapping documents, the worker just woke): look again before giving up,
  // or the tab is left with no fill and no state at all, for Claude and the app to wait on.
  let counts = await pageShape(tab.id);
  for (let again = 0; !counts && again < 8; again++) {   // every 0.5 s, up to the same 4 s
    await new Promise(resolve => setTimeout(resolve, 500));
    counts = await pageShape(tab.id);
  }
  // No control at all while the page is still growing (a form rendered by script after its load, "Chargement en cours…"): read it again
  // before anyone judges it, or a loading form is called a posting and its Submit pressed as Apply (9 Oct 2026, SuccessFactors). A static page: one still half second.
  for (let wait = 0; counts && emptyShape(counts) && wait < 4; wait++) {
    await pageStill(tab.id, {maxMs: 1000});
    const next = await pageShape(tab.id);
    if (!next) break;
    const growing = next.nodes !== counts.nodes;
    counts = next;
    if (!growing) break;
  }
  if (!counts) {
    started.delete(key);
    decide('fill', 'the page could not be read', {host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })()});
    await brokenPage(tab, jobUrl, key, null);   // loaded again, then reported plainly: never a silent stop (ladder/site-broken.js)
    return;
  }
  // The server answered with an error (a posting gone, the site down) and the page shows no form: loaded again, then reported plainly; never judged as a page.
  if (brokenOf(counts)) { await brokenPage(tab, jobUrl, key, counts); return; }
  // A sign-up form was open in this tab (we filled it) and the page changed: what became of it is the account AI's word (account-step.js accountOutcome).
  // The two AI looks do not depend on each other (the outcome of a sign-up, the kind of this page): asked together, the wait is the longer one, not the sum (9 Oct 2026, Migros: 13 s then 9 s, one after the other).
  // A page that already shows a form (2+ fields, no password): its questions go to the AI now, beside the page-kind ask; the fill takes the answer only if
  // this page is filled as a form (flow.js askEarly, early-answers.js). A count of controls only starts a question early: it never decides what the page is.
  if (counts.fields + counts.textareas >= 2 && !counts.passwords) askEarly(live, await settings(), jobUrl).catch(() => {});
  const lookedAt = Date.now();
  sayStep(tab.id, 'Reading this page…'); markPage(tab.id, 'reading');   // the panel and the desktop say so at once (page-mark.js)
  const kindAsk = askKind(tab), outcomeLook = accountOutcome(tab).catch(() => {});
  const firstAsked = (await kindAsk) || await climbOnUnsure(tab, askKind);   // unsure: the numbered digest (rung 3), not the structure rule
  if (late(tab, gen, 'page kind')) return;
  // The AI says the page is still being drawn (a placeholder, a cover over an empty shell): read it again once it is still, never plan a fill from it (ladder/still-drawing.js).
  const asked = await readWhileDrawing(firstAsked, {again: () => askKind(tab, {fresh: true}), still: () => pageStill(tab.id, STILL_MS), unanswered: async () => { const now = await pageShape(tab.id); return !!now && emptyShape(now); }, log: decide, host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })()});
  if (late(tab, gen, 'page kind, read again')) return;
  if (await backgroundPage(tab.id, asked?.role || pageRole(counts, tab.url), asked?.botCheck === true)) return;
  // The application form: fill it now; what became of the sign-up before it is the account AI's word a moment later, for the card only (owner, 9 Oct 2026: the fill
  // waited 40 s on it on Migros while the page was already the form). Any other page (an account page, a posting, nothing known) waits for it, as the sign-in →
  // sign-up switch and the account step go by it. Guard: worker/test/account-step.test.js.
  if (asked?.role !== 'form') await outcomeLook;
  if (late(tab, gen, 'account outcome')) return;
  const outcomeMs = Date.now() - lookedAt;   // what the fill waited before it could go on
  // What kind of page this is: the AI's word for this site and page shape (asked once, kept), in any language; the structure rule when
  // there is none (no AI, unsure). Every flow below goes by the role either one gives (docs/flows/applying.md).
  const ruled = pageRole(counts, tab.url);
  let kind = asked;
  let role = kind?.role || ruled, noted = '';   // noted: what the page is called to the app and the learning, when the fill below treats it as something else
  // Self-correction: a "form" with nothing to fill is not one. The kept answer goes; the structure rule decides this visit.
  const controls = (Number(counts.fields) || 0) + (Number(counts.files) || 0) + (Number(counts.textareas) || 0) + (Number(counts.passwords) || 0) + (Number(counts.choices) || 0);
  if (kind && role === 'form' && controls === 0) {
    await forgetKind(tab, kind, 'a form with no fields'); role = ruled;
    if (role === 'no-form') { noteSignal(tab.id, {rung: kind.rung ?? 2, signal: 'contradicted'}, controlsOf(tab.id)); kind = (await climbOnUnsure(tab, askKind)) || kind; if (late(tab, gen, 'contradicted page')) return; role = kind?.role === 'no-form' ? 'no-form' : role; }   // the page contradicts the kept answer: a signal, so the ladder climbs (ladder/climb.js)
  }
  // Every account page gets the normal fill: its fields are judged by meaning (any language) and your details go in, whatever step the AI named or did not
  // (owner, 12 Oct 2026: "we see an email, the AI judges, we fill"; a remembered answer with no step left the page to Claude and the email box empty).
  // Filling presses nothing: which way to go (register, sign in, leave), the passwords and the account button stay account-step.js's (accountMove, dffa024).
  if (role === 'account') {
    const host0 = (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })();
    const id = await identityOf(tab);
    const peek = await apiFor(tab.id, await settings(), '/extension/site-password', {method: 'POST', body: JSON.stringify({host: host0, peek: true, session: id.session, job: id.job, url: id.url})}).catch(() => null);
    await bindSession(tab.id, peek?.session, id.session);
    if (peek?.mode !== 'confirm') { role = 'form'; noted = 'account'; decide('fill', `account page${kind?.accountStep ? ` (${kind.accountStep})` : ''}: filled with your details`, {host: host0}); }   // 'confirm': waiting for its mail, nothing typed again
  }
  if (late(tab, gen, 'account details')) return;   // the peek waits on the app: the person may have pressed on meanwhile (beta run 38383983490: a sign-up's read filled the form after it)
  decide('fill', `page kind: ${kind?.kind || ruled}`, {by: kind ? kind.by : 'structure rule', confidence: kind?.confidence ?? null, ms: Date.now() - lookedAt, outcomeMs,
    ...(kind && kind.role !== ruled ? {rule: ruled} : {}), host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })()});
  await markPage(tab.id, role, false, kind, {working: true});   // a page with no form says so to the panel: never Ready, never counts (page-mark.js); no verdict yet: the read goes on (working-mark.js)
  const carried = takePressed(tab.id);   // the Apply press that brought the tab here: confirmed below only if this page takes the fill (ladder/climb.js)
  await noteRole(tab.id, tab.url, noted || role);   // a sign-up page filled like a form is still an account page: no application learning, no "application form" stage (Migros, 8 Oct 2026)
  // Event-driven: an account page is looked at the moment its kind is known, not at the panel's next tick. One filled with your details is looked at AFTER
  // that fill: its "ready?" judgment must see the email in (jobs.ch, 9 Oct 2026: judged 0.3 s before the fill typed it, "Email address" missing, nothing pressed).
  const accountPage = kind?.role === 'account' || ruled === 'account', accountAfterFill = accountPage && noted === 'account';
  if (accountPage && !accountAfterFill) accountStep(tab, 0).catch(() => {});
  let host = '';
  try { host = new URL(tab.url).hostname; } catch { /* not a url */ }
  // Tier 2: the posting before its form. Press its "Apply" button once (by rule), then wait for the form.
  let pressed = false, buttonsSeen = [], lookAfterPress = null;   // lookAfterPress: the fresh page-kind answer asked after an Apply that brought no form (the frame it lists may have come with the press)
  if (role === 'no-form' && !triedApply.has(key)) {
    triedApply.add(key);
    // The shared phrases, and the button the page-kind AI named on this page (any language; already checked against the page and the schema).
    const phrases = [...await applyPhrases(), ...(kind?.applyButton ? [{key: 'apply_button', phrase: kind.applyButton}] : [])];
    applyPressed.set(tab.id, {at: Date.now(), url: tab.url});   // before the click: the site opens its new tab during it (same-tab.js)
    notePressed(tab.id, confirmedBody(kind, tab.url, controlsOf(tab.id), 'pressed'));   // before the click too: the page it opens can be judged before this press's own wait ends (ladder/climb.js)
    const attempt = await pressApply(tab.id, phrases, '', kind?.applyButton || '', noEffectOf(key));
    if (!attempt.pressed) { applyPressed.delete(tab.id); notePressed(tab.id, null); }
    const label = attempt.pressed;
    buttonsSeen = attempt.buttons;
    if (!label) decide('fill', 'no Apply button to press', {host, listed: attempt.buttons?.length ?? 0, named: !!kind?.applyButton, ...(attempt.why || {})});   // why nothing was pressed (Hornbach, 10 Oct 2026: no line said); the named control's flags: found, visible, enabled, submits, href kinds, pickable
    if (label) {
      pressed = true;
      decide('fill', 'pressed the Apply button', {host, label, tag: attempt.tag, aimed: attempt.aimed, sameTab: attempt.same});   // sameTab: a link/form aimed at a new tab, pointed at this one
      const after = await formAfterPress(tab.id, tab.url, 8000, counts);
      decide('fill', `after the press: ${after === 'navigated' ? 'the page moved' : after ? 'a form came' : 'no form came'}`, {host, label, ...(after ? {} : await clickTrace(tab.id))});   // what the press did (Aldi, 10 Oct 2026: no line said)
      if (attempt.via) reportFlow(tab, null, {aliasUse: [{phrase: attempt.via, ok: after !== null}]});   // did a phrase from the service open the form?
      if (after === 'navigated') { started.delete(key); return; }   // the next page decides for itself (onUpdated); if it takes the fill, this press is confirmed (notePressed above)
      notePressed(tab.id, null);   // no other page: a form here is confirmed just below, no form is nothing
      if (after) { role = 'form'; await noteRole(tab.id, tab.url, role); const proof = verifiedBody(kind, tab.url, controlsOf(tab.id)) || confirmedBody(kind, tab.url, controlsOf(tab.id), 'pressed'); if (proof) apiFor(tab.id, await settings(), '/extension/page-kind', {method: 'POST', body: JSON.stringify(proof)}).catch(() => {}); }   // the press led to a form: a digest's answer may be kept, the fast tier's is counted (ladder/learning.js)
      else {
        noteNoEffect(key, label);   // pressed, nothing came: never pressed again on this page, and the AI's next look is told so (no-effect.js)
        // No form and the page did not move: it may be a step that offers several ways to start (Workday's dialog). The AI names the route of its button; only the manual one is pressed (start-route.js).
        // A look that names the form frame is the way on: no route is pressed ahead of it (15 Oct 2026: a "here" link to a PDF went first, the frame it named was never opened).
        const chosen = await startRoute(key, {ask: async () => { lookAfterPress = await askKind(tab, {fresh: true}); return Number.isInteger(lookAfterPress?.form_frame) && lookAfterPress.form_frame >= 0 && frameSrcOf(tab.id, lookAfterPress.form_frame) ? null : lookAfterPress; }, press: async routePhrases => {
          applyPressed.set(tab.id, {at: Date.now(), url: tab.url});
          const next = await pressApply(tab.id, routePhrases, routePhrases[0]?.phrase || '', '', noEffectOf(key));
          if (!next.pressed) applyPressed.delete(tab.id);
          return next;
        }});
        if (chosen.route) decide('fill', chosen.pressed ? 'pressed the start route: manual' : `start route not pressed: ${chosen.route}`, {host, route: chosen.route, label: chosen.pressed});
        if (chosen.pressed) {
          const afterRoute = await formAfterPress(tab.id, tab.url, 8000, counts);
          if (afterRoute === 'navigated') { started.delete(key); return; }
          if (afterRoute) { role = 'form'; pressed = true; await noteRole(tab.id, tab.url, role); } else noteNoEffect(key, chosen.pressed);
        }
        // The look after the press says this page IS the form, as sure as the first answer: filled, never handed over as a bot check (later-look.js).
        if (laterLookIsForm(kind, lookAfterPress)) {   // also after a form came by the route: the later look is the newer answer
          decide('fill', 'a later look says this page is the form: filled', {host, first: kind?.kind || '', confidence: lookAfterPress.confidence});
          await forgetKind(tab, kind, 'a later look says form'); kind = lookAfterPress; role = 'form'; await noteRole(tab.id, tab.url, role);
        }
      }
    }
  }
  // Self-correction: called a posting, but there was no Apply to press and the page has an application form's fields: it is the form.
  // Never for an "other", at any confidence: fields do not make a page a job page (13 Oct 2026, the owner's Chrome: a pull request was filled); the AI's answer stands, a weak one is asked again next visit (page-kind-final.js).
  if (kind?.role === 'no-form' && !pressed && ruled === 'form') {
    if (noJobPage(kind)) decide('fill', 'the AI says this is no job page: its fields do not make it a form', {host, confidence: kind.confidence});
    else { await forgetKind(tab, kind, 'a posting with no Apply but a form\'s fields'); role = 'form'; await noteRole(tab.id, tab.url, role); }
  }
  await markPage(tab.id, role, pressed, kind, {working: true});   // after the Apply press: the form came (cleared) or is opening; the climbs below still work
  // The application form is inside a frame of this page (Datadog, 10 Oct 2026): the page-kind AI named it by index; its stored address is opened in this same tab, https only, once per tab and page.
  // The numbered digest names a frame too (rung 2 unsure, 14 Oct 2026: a posting with its form in a frame got no frame from the unsure rung): the same opening, from the answer that carries it.
  const openFormFrame = async answer => {
    if (role !== 'no-form' || !Number.isInteger(answer?.form_frame) || answer.form_frame < 0) return false;
    const src = frameSrcOf(tab.id, answer.form_frame);
    if (!src || !claimFrame(key)) return false;
    decide('fill', 'opening the application form frame as the page', {host, frame: new URL(src).hostname, by: answer.by || 'ai'});
    await moveTab(tab.id, src); started.delete(key); return true;
  };
  if (await openFormFrame(lookAfterPress) || await openFormFrame(kind)) return;   // the look after the press first: the form frame often loads only after Apply (14 Oct 2026)
  // Nothing to press and no form: the numbered digest looks once (ladder/climb.js). It may name a control the sketch lost (Aldi, 10 Oct 2026: 20 menu links ahead of "Postuler"): pressed through the same floors as any Apply button.
  let stall = null;
  if (role === 'no-form' && kind?.botCheck !== true && !emailReport(kind) && !toldReport(kind)) {
    stall = await climbOnStall(tab, askKind, key, kind);
    if (late(tab, gen, 'stall climb')) return;
    if (await openFormFrame(stall)) return;
    if (stall?.applyButton) {
      applyPressed.set(tab.id, {at: Date.now(), url: tab.url});
      const attempt = await pressApply(tab.id, [{key: 'apply_button', phrase: stall.applyButton}], stall.applyButton, '', noEffectOf(key));
      if (!attempt.pressed) applyPressed.delete(tab.id);
      else {
        decide('fill', 'pressed the control the digest named', {host, label: attempt.pressed});
        const afterDigest = await formAfterPress(tab.id, tab.url, 8000, counts);
        if (afterDigest === 'navigated') { started.delete(key); return; }
        if (afterDigest) { role = 'form'; pressed = true; await noteRole(tab.id, tab.url, role); } else noteNoEffect(key, attempt.pressed);
      }
    }
  }
  // The ladder ended at the person with nothing to say (the digest answered nothing usable): the picture rung looks once at the posting, from the sketch alone. It may press ONE control the page lists that the AI
  // calls Apply and the Apply floor accepts (desktop/lib/ladder/rung4-picture.js vetPage); the press is the next-step press, which never presses a control that submits.
  if (role === 'no-form' && kind?.botCheck !== true && !emailReport(stall || kind) && !toldReport(stall || kind) && otherReport(stall || kind, tab.id)) {
    // A blind page (the digest said the way on is not in its list) is looked at with its PICTURE, in test runs only (the harness's ladderAct switch: the CI pool; owner, 13 Oct 2026, users keep it off);
    // the log says whether the picture confirmed the blind spot: the control it named led to a form, which the numbered list lacked.
    const blindLook = blindOn(tab.id) && (await settings().catch(() => null))?.ladderAct === true;
    const look = await closerLook(tab, 0, 'the ladder ended at the person', {kind: 'page', picture: blindLook}).catch(() => 'none');
    let led = false;
    if (look === 'click') {
      const afterLook = await formAfterPress(tab.id, tab.url, 8000, counts);
      if (afterLook === 'navigated') { blindVerdict(blindLook, look, true); started.delete(key); return; }
      if (afterLook) { role = 'form'; pressed = true; led = true; await noteRole(tab.id, tab.url, role); }
    }
    blindVerdict(blindLook, look, led);
  }
  if (await backgroundPage(tab.id, role, kind?.botCheck === true)) return;
  if (role !== 'form') {
    await progress(tab.id, '', '', 'your-turn');   // no fill here: the panel's "Starting…" ends now, not after its 20 s (owner, 9 Oct 2026: it spun on a sign-in page left to them)
    // A check that the visitor is human in front of the page (the page-kind AI's bot_check): the person solves it in this tab; the form is watched for two
    // minutes and filled once it shows (SmartRecruiters, 9 Oct 2026: the check was read as an empty page, "no form", and nobody was told).
    const botCheck = role === 'no-form' && kind?.botCheck === true;
    const watching = botCheck || (role === 'no-form' && counts && emptyShape(counts));   // judged while still empty, or a check: look again if fields come
    // No verdict while the flow still works (owner, 27 Oct 2026: "don't show a verdict" ... "IF the extension didn't stop thinking"): stopped and sure, the verdict now; a watch that
    // may judge the page again keeps "Reading this page…" and says the verdict only when it ends with no form (Greenhouse: "no application", then filled seconds later).
    await markPage(tab.id, role, pressed, kind, {working: !!watching});
    if (watching) watchForFields(tab, jobUrl, undefined, botCheck ? 60 : 10, counts?.frameHosts || [], () => markPage(tab.id, role, pressed, kind)).catch(() => markPage(tab.id, role, pressed, kind));
    if (late(tab, gen, 'page state')) return;   // a stale read never writes the page's state (worker/test/read-generation.test.js)
    await writeState(tab.id, {state: role});
    const said = stall || kind;   // the digest's answer at a stall, else what the page-kind said
    const email = role === 'no-form' ? emailReport(said) : null, told = role === 'no-form' && !email ? toldReport(said) : null, closed = email || told ? null : closedReport(kind, counts), other = role === 'no-form' && !email && !told && !closed ? otherReport(said, tab.id) : null;   // the page asks for email (ladder/outcomes.js) or tells what to do (ladder/climb.js)
    decide('fill', role === 'account' ? 'account page left for Claude' : botCheck ? 'a bot check in front of the page: handed to the person' : email ? 'the posting asks for the application by email: reported to the app' : closed ? 'the posting is closed (the AI says so): reported to the app' : told ? 'the page tells what to do: reported to the app' : other ? 'the ladder ended at the person: reported as other' : 'no form on this page', {host, role, ...(kind?.applyBy ? {applyBy: kind.applyBy} : {})});
    if (other && await restartFromPosting(tab, jobUrl, {decide})) return;   // a broken page mid-application: from the posting again (restart-from-posting.js)
    if (other) apiFor(tab.id, await settings(), '/extension/page-kind', {method: 'POST', body: JSON.stringify({why: 'other', url: tab.url.split('#')[0], controls: controlsOf(tab.id)})}).catch(() => {});   // the shape is counted by the app (no text): the ladder ended at the person
    if (email || told || closed || other) deadEndHere(tab, jobUrl, host, (email || told || closed || other).why, (email || told || closed || other).needs, {role, rung: said?.rung, signal: blindOr(tab.id, said?.signal)});   // the address is the need: the card says where to send it
    else if (!(role === 'account' && kind?.accountStep)) deadEndHere(tab, jobUrl, host, role === 'account' ? 'account' : 'no-form', botCheck ? BOT_CHECK_NEED : '', {role, botCheck, pressed: !!pressed, rung: kind?.rung, signal: kind?.signal});   // tier 3: the app offers Apply with Claude; an account page the AI has a step for is the account step's (it reports when it cannot finish)
    reportFlow(tab, {role, pressed}, {buttons: pressed ? [] : buttonsSeen});
    return;
  }
  forgetGivenUp(tab.id);   // a new fill: its menus are tried afresh
  decide('fill', 'filling', {host, job: new URL(String(jobUrl || tab.url)).pathname, page: new URL(tab.url).pathname});   // which posting's kit this page uses
  if (late(tab, gen, 'fill start')) return;   // the closer looks above wait too: only the tab's current read fills it
  const fillToken = crypto.randomUUID(); await writeState(tab.id, {state: 'running'}, fillToken);
  const result = await fillOpenedTab(live, String(jobUrl || tab.url).split('#')[0], false, {fast: true, quiet: true});
  // The end state is this page's: a tab that moved on during the fill (the person pressed the page's own "Create account") shows another page, which writes its own
  // (13 Oct 2026: a sign-up's fill error was read on the application form after it, as if the form had failed).
  const still = await chrome.tabs.get(tab.id).catch(() => null);
  if (!still || String(still.url || '').split('#')[0] === String(live.url || tab.url).split('#')[0]) await writeState(tab.id, result?.error ? {state: 'error', error: String(result.error).slice(0, 160)}
    : {state: 'done', filled: result?.filled || 0, left: (result?.todo || []).length, todo: (result?.todo || []).slice(0, 20)}, fillToken);
  else decide('fill', 'the tab moved on during the fill: its end state is left to the next page', {page: new URL(String(live.url || tab.url)).pathname}).catch(() => {});
  reportFlow(tab, {role: 'form', ok: !result?.error});
  const requiredIn = (result?.trace || []).filter(row => row.required && row.outcome === 'filled').length; if (!result?.error && requiredIn) noteProgress(tab.id, 'required_down', {filled: requiredIn});
  const filledProof = !result?.error && result?.filled > 0 && !pressed && !noted ? confirmedBody(kind?.role === 'form' ? kind : null, tab.url, controlsOf(tab.id), 'filled') : null;   // the page took the fill: the decision that called it a form is counted (a kind the structure overrode is the rule's, rung 0)
  for (const proof of filledProof ? [filledProof, carried].filter(Boolean) : []) apiFor(tab.id, await settings(), '/extension/page-kind', {method: 'POST', body: JSON.stringify(proof)}).catch(() => {});
  // A fill that put nothing in and left required fields open has no next move of its own (Deloitte's "how will you give your CV" step, 9 Oct 2026: "Form open",
  // 0 filled, 2 left, nobody told): the session says what is left and offers Claude. Counted from the fill's own rows, no word of any page.
  const open = (result?.trace || []).filter(row => row.required && row.outcome === 'left').map(row => String(row.label || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!result?.error && !(result?.filled > 0) && result?.unfilledRequired > 0 && open.length) {
    // The ladder (owner, 9 Oct 2026: "3 levels of solving"): 1 the rules did their part; 2 the page AI looks again from the page's own controls (never the remembered answer);
    // 3 the same look with the picture; 4 the person is told, with the control the AI named when it may not press it. Levels 2 and 3 are the closer look (opt-in, capped, lib/ladder/rung4-picture.js).
    let moved = false, named = '';
    for (const picture of [false, true]) {
      const did = await closerLook(live, 0, 'the fill put nothing in and required fields are left', {kind: 'form', picture}).catch(() => 'none');
      if (did === 'click') { moved = true; break; }
      named = lastLook.get(tab.id)?.control || named;
      if (did === 'none' && !picture) break;   // off, capped or no AI: a picture would not change that
    }
    if (moved) {   // the page moved on by that press: the fill looks at it once more (a new state, a new look, never more than once)
      started.delete(key);
      decide('fill', 'the closer look pressed a control: the page is filled again', {host});
      await pageStill(tab.id, {maxMs: 1500});
      await consider(tab, jobUrl).catch(() => {});
      return;
    }
    decide('fill', 'nothing filled, required fields left: the person is told, Claude is offered', {host, left: open.length, aiNamed: !!named});
    deadEndHere(tab, jobUrl, host, 'incomplete', [...new Set(open)].slice(0, 3).join(', ') + (named ? ` · try "${named}"` : ''), {left: open.length, aiNamed: !!named});
  }
  if (!result?.error && !accountPage) handGivenUpToPerson(live, 0, result?.trace).catch(() => {});   // a required menu the fill gave up on is the person's (form-ready.js)
  if (!result?.error && !accountPage) formNext(live, 0).catch(() => {});   // the AI says what this page needs next, and a middle step's Continue is pressed (next-step.js)
  if (accountAfterFill) accountStep(tab, 0).catch(() => {});   // the account page, now with your details in (above)
}
