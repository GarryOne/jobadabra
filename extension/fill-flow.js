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
import {preparePage, readPage, askPage, correctPage, describePage} from './fill-flow-read.js';
import {pressPosting, correctPosting, climbPosting, lookAtPosting, leavePage, fillPage, afterFill} from './fill-flow-steps.js';
import {backgroundMayFill, backgroundPage} from './background-apply.js';
import {PAGE_FILES, apiFor, clickCombos, settings} from './flow.js';
import {decide} from './log.js';
import {retireFill} from './one-fill.js';
import {handoffKey} from './ready-handoff.js';
import {sweepConsent} from './consent-sweep.js';
import {closerLook} from './ladder/rung4-picture.js';
import {applyPressed} from './tabs.js';
import {isStopped} from './stop-state.js';
import {pageStill} from './page-still.js';
import {sessionOf} from './tab-identity.js';
import {formCame, pageKey} from './tab-pages.js';
import {restoreLostQuery} from './restore-query.js';
import {restartFromPosting} from './restart-from-posting.js';
import {pressApply, wouldPress} from './apply-press.js';
import {forgetNoEffect, noEffectOf} from './no-effect.js';
import {modalTrace} from './ladder/press-why.js';
import {forgetRouteTries} from './start-route.js';
import {mailsOf} from './ladder/outcomes.js';
import {brokenOf, onBrokenPage} from './ladder/site-broken.js';
import {deadEnd, useFallback, useReporter} from './ladder/dead-end.js';
import {notePage, noteProgress, useProgressLog} from './ladder/progress.js';
import {onTop} from './on-top.js';
import {labelReaderIn, pageShape, pageSketchOf} from './page-reads.js';
import {setApply} from './apply-state.js';
import {dropIfLate, openRead} from './read-gen.js';
import {candidatesOf, digestAsked, frameBecameCandidate, forgetClimb, frameSketch, framesOf, noteFrames, noteSignal} from './ladder/climb.js';

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
// Read one armed page through the guards, page decisions, fill and after-fill steps.
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
  /* Step writes: consider seeds tab, jobUrl, key, live, gen, flow; readPage sets counts; askPage sets asked, lookedAt, outcomeMs;
   * correctPage sets ruled, noted; describePage sets carried, accountPage, accountAfterFill, host; pressPosting sets buttonsSeen;
   * climbPosting sets stall; watchPage sets botCheck; fillPage sets result. Multiple writers retained from the original local variables:
   * role: correctPage, rememberPressedForm, routeAfterApply, correctPosting, climbPosting, pressDigest, lookAtPosting (classification and later form discoveries);
   * kind: correctPage, routeAfterApply (initial judgment and the newer post-press judgment);
   * pressed: pressPosting, afterApply, routeAfterApply, climbPosting, pressDigest, lookAtPosting (initial false and later press results);
   * lookAfterPress: pressPosting, routeAfterApply (initial null and the fresh post-press answer). Some assignments carry an unchanged value onward. */
  const step = {tab, jobUrl, key, live, gen, flow: fillFlowParts};
  await preparePage(step);
  if (!await readPage(step)) return;
  if (!await askPage(step)) return;
  if (!await correctPage(step)) return;
  await describePage(step);
  if (!await pressPosting(step)) return;
  await correctPosting(step);
  if (!await climbPosting(step)) return;
  if (!await lookAtPosting(step)) return;
  if (await backgroundPage(tab.id, step.role, step.kind?.botCheck === true)) return;
  if (step.role !== 'form') { await leavePage(step); return; }
  if (!await fillPage(step)) return;
  await afterFill(step);
}

// Steps borrow these parts; the worker's mutable state and shared callbacks keep their one owner here.
const fillFlowParts = {
  // Return the worker's current set of pages whose fill has started.
  get started() { return started; },
  // Return the one memory of Apply attempts, never a copy.
  get triedApply() { return triedApply; },
  // Return the worker's current fill-report callback.
  get reportFlow() { return reportFlow; },
  // Return the worker's current tab-fill callback.
  get fillOpenedTab() { return fillOpenedTab; },
  // Return the worker's current progress callback.
  get progress() { return progress; },
  askKind, sayStep, late, forgetKind, brokenPage, formAfterPress, blindVerdict,
  emptyShape, watchForFields, writeState, deadEndHere, consider, BOT_CHECK_NEED,
};
