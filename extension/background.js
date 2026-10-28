// The background worker: tabs the app opens to fill (#jobpilotto-fill), the next page in that tab, a tab that tab
// opens, Apply with Claude's hand-off, the ring's messages to the app, and the connection check. The result of a
// fill shows in a panel on the page and in the icon badge.
import {NO_APP, api, fillTab, settings} from './flow.js';
import {plainWhy} from './ai-reply.js';
import {oneFillPerTab, retireFill} from './one-fill.js';
import {decide, pushDecisions} from './log.js';
import {PANEL_FILES} from './panel-files.js';
import {logFieldsLine} from './fill-fields.js';
import {createLearningMessages} from './messages-learning.js';
import {createSubmitWatch} from './submit-watch.js';
import {createTabReport} from './tab-report.js';
import {createPanelMessages} from './messages-panel.js';
import {createAppMessages} from './messages-app.js';
import {createReportMessages} from './messages-report.js';
import {claimAppTab, closePosting, followOpener, noteSource, movedByUs, moveTab} from './tabs.js';
import {createSettleOpenTabs} from './settle-tabs.js';
import {createStopMessages} from './stop-messages.js';
import {consider, initFillFlow} from './fill-flow.js';
import {closePopupOrLayer} from './consent.js';
import {closeFillDialogs, holdFill, layerOnTop} from './dialog-after-fill.js';
import {autoRead, holdBoard, siteUnreachable, startWaiting} from './visit.js';
import {MEMORY_KEY, memoryReadyIs, sessionGet, snapshot, startRun} from './tab-memory.js';
import {startsOwnJob, sameSite, navigationKind, neverForm, sharedFixes, withMark, stripMark} from './tab-pages.js';
import {noteStart} from './panel-start.js';
import {KEY, fromOf, jobOf, bindMark, markFor, startJob} from './tab-identity.js';
import {tellPanel} from './page-notes.js';
import {fillWaitsForAllow, resumeFillWaiting, watchUnallowedFillTabs} from './site-allow.js';
import {createReadyHandoff} from './ready-handoff.js';
import {startRefusedReads} from './refused-read.js';
import {startEarlyDim} from './early-dim.js'; import {applyState, setApply, forgetApply} from './apply-state.js';

// The tab we may touch: Chrome reuses a tab id after its tab closes, and the user can navigate the tab elsewhere
// while a fill is still running, so every injection asks the tab what it shows first (tab-pages.js).
async function onPage(tabId, url) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return sameSite(tab?.url, url) ? tab : null;
}

// What the extension decided, and why: log.js (decide), kept and pushed to the app's log.
pushDecisions();  // a worker that just started delivers whatever the last one could not

async function note(tabId, text, url = '') {
  if (url && !(await onPage(tabId, url))) return;  // the tab is showing something else now: leave it alone
  if (await tellPanel(tabId, text)) return;   // the panel's note line when it is on the page (page-notes.js)
  await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', args: [text], func: message => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:320px;background:#132439;color:#fff;' +
      'border-radius:10px;padding:12px 14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px #0008';
    box.textContent = message;
    box.onclick = () => box.remove();
    document.documentElement.append(box);
  }}).catch(() => {});
}

// "Apply to N jobs" in the desktop app opens each job with #jobpilotto-fill. That mark is the only way a tab
// becomes one the extension may touch: the panel, the fill and the submit listener never start on a page
// the user opened themselves.
export const FILL_MARK = 'jobpilotto-fill';
const started = new Set();
const armedLogged = new Set();
const panelRefused = new Set();
const readyHandoff = createReadyHandoff({chrome, api: (path, init) => settings().then(config => api(config, path, init)), sessionGet, move: moveTab, decide, mark: FILL_MARK});   // Open in my browser (ready-handoff.js)
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!tab.url?.includes(`#${FILL_MARK}`)) return;
  // A mark added to a tab already open changes only its address (a hash change: no loading status).
  if (info.status !== 'loading' && info.status !== 'complete' && !info.url?.includes(`#${FILL_MARK}`)) return;
  claimAppTab(tabId, tab.url);   // before any await: a followOpener still reading its opener's keys must not write over this job (tabs.js)
  let origin = '';
  try { origin = new URL(tab.url).origin + '/*'; } catch { return; }
  if (!(await chrome.permissions.contains({origins: [origin]}))) {
    // Not one of the supported job sites, and "Work on every job site" is off: wait for Allow, visibly (site-allow.js).
    if (info.status === 'complete') await fillWaitsForAllow(tabId, tab.url, {decide});
    return;
  }
  if (await readyHandoff.takeHandoff(tabId, tab.url, info.status)) return;   // Open in my browser: on to the night's page, its cookies set
  // `from` is the job this tab was opened for. A mark the extension carried onto the next page (markPage) does not change it:
  // the posting that led to an agency's form stays the job, whichever site the form is on.
  const carried = (await sessionGet(`carried:${tabId}`))[`carried:${tabId}`];
  // A page the app opened starts its own job: nothing a tab that happened to open it handed over (followOpener) stays. The same page
  // loading again (a form's own result after Submit) is not a new start: its job must stay, or the confirmation has no job to mark.
  if (carried !== tab.url) {
    const prior = await fromOf(tabId);
    if (!startsOwnJob(prior, tab.url)) { /* same page again: keep its job */ } else {
      // Nor the session a tab that happened to be active handed it (8 Oct 2026, e2e: the app's new tab for one job reported as another job's).
      await startJob(tabId, stripMark(tab.url));
    }
  }
  await bindMark(tabId, tab.url);   // the session the app opened this tab for: bound now, never inferred later
  await arm(tabId, 'fill mark');  // while the document loads, so Apply with Claude finds the hook
  if (info.status === 'loading') noteStart(stepNow, tabId, tab.url);   // the panel spins "Starting…" until the fill's first step (panel-start.js)
  if (info.status !== 'complete') return;
  await readyHandoff.restoreHandoff(tabId);   // the night's values first; the normal fill takes over for the rest
  // The job, not this page: a page the extension carried the mark onto (an agency's form) belongs to the posting that led to it.
  await consider(tab, await jobOf(tab));
});

// The panel is injected only into a tab the desktop app opened, a later page in that tab, or a tab that tab
// opened. A new document gets the scripts again. Nothing is injected into a tab the user opened themselves.
async function arm(tabId, why = 'app tab') {
  await chrome.storage.session.set({[`armed:${tabId}`]: true});
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  let host = '';
  try { host = new URL(tab?.url || '').hostname; } catch { /* not a url */ }
  const mark = `${tabId}:${host}`;
  if (host && !armedLogged.has(mark)) {
    armedLogged.add(mark);
    decide('panel', 'panel on a tab the app opened', {host, why});
  }
  await chrome.scripting.executeScript({target: {tabId, allFrames: true}, files: ['page/skeleton.js', 'page/required-mark.js', 'page/typed-check.js', 'page/read-back.js', 'page/label-before.js', 'page/coverage.js', 'page/option-groups.js', 'page/review-payload.js', 'hook.js', 'panel-claude.js', 'page/submit-press.js', ...PANEL_FILES], injectImmediately: true}).catch(() => {});
}
// The mark in the address is what makes a page ours. A server redirect keeps it (a browser carries the #fragment through a
// redirect). When an application tab moves on by itself (a link, a form, a script) and the new address has none, the mark is
// put back in place, without a reload. When a person walks away (types an address, searches, opens a bookmark), the tab is
// let go. Without the permission this needs, tabs stay armed until closed (webNavigation).
const forget = tabId => chrome.storage.session.remove([`armed:${tabId}`, KEY.from(tabId), KEY.job(tabId), `carried:${tabId}`, `submit:${tabId}`, `judged:${tabId}`]).catch(() => {});
async function markPage(tabId, url) {
  const marked = withMark(url, await markFor(tabId));   // the carried mark keeps the session
  if (!marked) return false;
  await chrome.storage.session.set({[`carried:${tabId}`]: marked});
  await chrome.scripting.executeScript({target: {tabId}, args: [marked], func: address => { try { history.replaceState(history.state, '', address); } catch { /* sandboxed page */ } }}).catch(() => {});
  return true;
}
if (chrome.webNavigation) {
  // A site on the app's visit list lights the icon ("Read"): no access to the page is needed for that (visit.js).
  // Read as soon as the page's own content is there (DOMContentLoaded), not only when every image and script has loaded (onCompleted):
  // 7 Oct 2026: Tiffany's site took longer than the app's 30 s to "complete", and the app skipped it as "it never started reading".
  // autoRead runs once a tab, whichever comes first.
  const readWhenLoaded = details => {
    if (details.frameId !== 0 || !/^https?:/.test(details.url)) return;
    if (/#jp-board-[a-z0-9]{4,16}$/.test(details.url)) { holdBoard(details.tabId); return; }   // a board the person reads: nothing starts until they press Read
    if (/#jp-read(-filter)?(-[a-z0-9]{4,16})?$|#jp-posting-[a-z0-9]{4,16}$/.test(details.url)) { autoRead(details.tabId, details.url); return; }   // a tab the app opened to read (Actions)
    // A site that redirected and dropped the mark (iwc.com to iwc.com/ch-en, 7 Oct 2026: the tab sat there unread): the mark it was opened with.
    const key = `readmark:${details.tabId}`;
    sessionGet(key).then(kept => {
      if (/^#jp-board/.test(kept[key] || '')) holdBoard(details.tabId);   // after a sign-in the page moved on and lost its mark: still the person's board
      else if (kept[key]) autoRead(details.tabId, `${details.url.split('#')[0]}${kept[key]}`);
    }).catch(() => {});
  };
  chrome.webNavigation.onDOMContentLoaded.addListener(readWhenLoaded);
  chrome.webNavigation.onCompleted.addListener(details => readWhenLoaded({...details, complete: true}));
  // A site the app opened that cannot be reached: the app hears it at once (visit.js siteUnreachable), with the mark kept if it redirected first.
  chrome.webNavigation.onErrorOccurred.addListener(details => {
    if (details.frameId !== 0) return;
    if (/#jp-(read(-filter)?|board)-[a-z0-9]{4,16}$/.test(details.url)) { siteUnreachable(details.tabId, details.url, details.error); return; }
    const key = `readmark:${details.tabId}`;
    sessionGet(key).then(kept => { if (kept[key]) siteUnreachable(details.tabId, `${details.url.split('#')[0]}${kept[key]}`, details.error); }).catch(() => {});
  });
  // The mark of a tab the app opened to read, kept for the tab: its next pages may have lost it (a redirect).
  chrome.webNavigation.onBeforeNavigate.addListener(details => {
    const found = details.frameId === 0 && /#jp-(?:read(?:-filter)?|posting|board)(?:-([a-z0-9]{4,16}))?$/.exec(details.url);
    if (!found) return;
    chrome.storage.session.set({[`readmark:${details.tabId}`]: found[0]}).catch(() => {});
    // The app hears at once that the extension has the tab (its site row says so, and it is not silence): "never started reading" then
    // means the extension never saw it (an old version, the extension off), not a slow page.
    if (found[1] && !/^#jp-board/.test(found[0])) settings().then(config => api(config, '/extension/visit-state', {method: 'POST', body: JSON.stringify({ticket: found[1], words: 'the extension has the tab: waiting for the page to load'})})).catch(() => {});
  });
  chrome.tabs.onRemoved.addListener(tabId => { forgetApply(tabId); chrome.storage.session.remove(`readmark:${tabId}`).catch(() => {}); });
  chrome.permissions.onAdded.addListener(() => { startWaiting(); resumeFillWaiting({decide}); });
  watchUnallowedFillTabs({decide});
  startEarlyDim();   // an Apply starts when the app opens its tab and stays dimmed through every page change until a verdict (apply-state.js, early-dim.js)
  startRefusedReads();   // reads refused sites only after the person's press in the app, seen by a one-minute look (extension/refused-read.js)
  chrome.webNavigation.onCommitted.addListener(async details => {
    if (details.frameId !== 0) return;
    retireFill(details.tabId);   // a new document: the fill running here belongs to the old one (extension/one-fill.js)
    const key = `armed:${details.tabId}`;
    if (!(await sessionGet(key))[key] || String(details.url).includes(`#${FILL_MARK}`)) return;
    let host = '';
    try { host = new URL(details.url).hostname; } catch { /* not a url */ }
    if (navigationKind(details, movedByUs(details.tabId)) === 'by-hand') {
      await forget(details.tabId);
      decide('panel', 'tab left by hand: no longer the application', {host});
      return;
    }
    if (await markPage(details.tabId, details.url)) decide('panel', 'mark carried to the next page', {host});
  });
}
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !/^https:/.test(tab.url || '') || tab.url.includes(`#${FILL_MARK}`)) return;
  const key = `armed:${tabId}`;
  // Notion is where the kit lives, never a form: an armed tab sent there is let go (no panel, no fill) until the app arms it again.
  if (neverForm(tab.url)) {
    if ((await sessionGet(key))[key]) {
      await chrome.storage.session.remove([key, KEY.from(tabId), KEY.job(tabId), `submit:${tabId}`, `judged:${tabId}`]).catch(() => {});
      decide('panel', 'tab left for Notion: no longer armed', {host: new URL(tab.url).hostname});
    }
    return;
  }
  if (!(await sessionGet(key))[key]) return;
  await markPage(tabId, tab.url);
  await arm(tabId, 'next page');
  await consider(tab, await jobOf(tab));
});
chrome.webNavigation.onCreatedNavigationTarget.addListener(noteSource);   // which tab's page really created a new tab (tabs.js openerOf)
chrome.tabs.onCreated.addListener(async tab => {
  if (!(await followOpener(tab))) return;
  let host = '';
  try { host = new URL(tab.pendingUrl || tab.url || '').hostname; } catch { /* the address is not ready yet */ }
  decide('panel', 'following a tab this session opened', {host, why: 'child'});
  await closePosting(tab, host);
  // A page that loads faster than the lines above finish (a local or cached one) completed before this tab was armed, and the load listener above
  // let it go: nothing looks at it again. Look now, if it is already loaded; `consider` runs a page only once, so a page still loading is not doubled.
  const live = await chrome.tabs.get(tab.id).catch(() => null);
  if (live?.status !== 'complete' || !/^https:/.test(live.url || '') || live.url.includes(`#${FILL_MARK}`) || neverForm(live.url)) return;
  await markPage(live.id, live.url);
  await arm(live.id, 'next page');
  await consider(live, await jobOf(live));
});

// A progress panel on the page while a tab fills itself (the popup is closed then). `url`: the page being filled —
// nothing is drawn when that tab has moved on to another site (or its id came back as a different tab).
async function progress(tabId, text, url = '', verdict = 'done') {
  // Why (2026-10-27, owner, replacing #2262's step-on-tab rule): the run's end is the verdict that lifts the dim, whichever site the tab is on (apply-state.js): a progress with no text is `done`, or `your-turn` when the fill hands the page over.
  if (!text) { stepNow.delete(tabId); setApply(tabId, verdict); } else { if (applyState(tabId) === 'done') setApply(tabId, 'working'); if (applyState(tabId) !== 'working') return; }   // a step after a `done` (a no-form read, then a fill) is the run being on again; after Stop or your-turn only the person's own start brings it back, and a step is drawn only while working
  if (url && !(await onPage(tabId, url))) return;
  // The page's panel (review.js) shows it when it is there; the floating box is for pages without one. Whichever
  // takes it, the other is cleared: a box drawn before the panel opened used to stay on the page for good, above a
  // form that was already "Ready to submit" (1 Oct 2026).
  if (text) stepNow.set(tabId, text); else stepNow.delete(tabId);
  const shown = await chrome.tabs.sendMessage(tabId, {type: 'panelStep', text}).catch(() => null);
  await stepBox(tabId, shown?.shown ? '' : text);
}
// The step a fill is on, per tab: a panel that appears after the step was announced (the fill started before the page
// had one) asks for it, shows it itself, and the floating box goes (2 Oct 2026: both were on screen for the whole wait).
const stepNow = new Map();

// The floating step box: drawn, updated, or (with no text) removed. Only for pages whose panel can't show the step.
function stepBox(tabId, message) {
  return chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', args: [message], func: message => {
    let box = document.getElementById('jobpilotto-progress');
    // The panel (review.js) shows the step itself: never a second copy of it in the corner.
    if (!message || document.getElementById('jobpilotto-review-host')) { box?.remove(); return; }
    if (!box) {
      box = Object.assign(document.createElement('div'), {id: 'jobpilotto-progress'});
      box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:320px;background:#132439;color:#fff;' +
        'border-radius:10px;padding:12px 14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px #0008;display:flex;gap:10px';
      const spin = document.createElement('span');
      spin.style.cssText = 'flex:none;width:14px;height:14px;margin-top:2px;border-radius:50%;border:2px solid #3b5170;border-top-color:#ffb224';
      spin.animate([{transform: 'rotate(0)'}, {transform: 'rotate(360deg)'}], {duration: 800, iterations: Infinity});
      box.append(spin, document.createElement('span'));
      document.documentElement.append(box);
    }
    box.lastChild.textContent = `Jobadabra: ${message}`;
  }}).catch(() => {});
}

// "Didn't fill: <reason>" with a Fill anyway button on the page itself.
async function ineligibleNote(tabId, reason, partly = false) {   // partly: your details were filled before the verdict came (flow.js, owner 11 Oct 2026)
  if (await tellPanel(tabId, partly ? `Jobadabra filled only your details on this form: ${reason || 'not eligible'}` : `Jobadabra didn't fill this form: ${reason || 'not eligible'}`, true)) return;   // the panel's note line, with its Fill anyway
  await chrome.scripting.executeScript({target: {tabId}, args: [String(reason || 'not eligible'), !!partly], func: (text, partly) => {   // an app reply without a note must not crash the note (10 Oct 2026, the Aldi replay)
    document.getElementById('jobpilotto-note')?.remove();
    const box = Object.assign(document.createElement('div'), {id: 'jobpilotto-note'});
    box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:340px;background:#132439;color:#fff;' +
      'border-radius:10px;padding:12px 14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px #0008';
    const message = Object.assign(document.createElement('div'), {textContent: partly ? `Jobadabra filled only your details on this form: ${text}` : `Jobadabra didn't fill this form: ${text}`});
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:10px';
    const button = (label, primary) => {
      const b = Object.assign(document.createElement('button'), {textContent: label, type: 'button'});
      b.style.cssText = `padding:6px 12px;border-radius:7px;border:${primary ? '0' : '1px solid #3b5170'};background:${primary ? '#ffb224' : 'transparent'};` +
        `color:${primary ? '#14110c' : '#fff'};font:600 12px system-ui,sans-serif;cursor:pointer`;
      return b;
    };
    const anyway = button('Fill anyway', true), close = button('Close', false);
    anyway.onclick = () => { box.remove(); chrome.runtime.sendMessage({type: 'fillAnyway'}); };
    close.onclick = () => box.remove();
    row.append(anyway, close);
    box.append(message, row);
    document.documentElement.append(box);
  }}).catch(() => {});
}

// Returns what was done ({filled, todo, ineligible, note}) or {error}, for Apply with Claude's hand-off.
// The kit and your contact details + CV per job, fetched when the panel first sees the form, so Fill starts at once.
// Kept 10 minutes (an edited kit or profile shows up after that, or at the next page load).
const early = new Map();  // job url -> {at, kit: Promise, me: Promise}
const FRESH_MS = 10 * 60 * 1000;
const ME_FRESH_MS = 5000;
function prefetch(config, url) {
  const known = early.get(url);
  if (known && Date.now() - known.at < FRESH_MS) return known;
  const entry = {at: Date.now(), meAt: Date.now(),
    kit: api(config, `/extension/kit?url=${encodeURIComponent(url)}`),
    me: api(config, `/extension/me?url=${encodeURIComponent(url)}`)};
  entry.kit.catch(() => early.delete(url));
  entry.me.catch(() => early.delete(url));
  // Details that came with an error (Notion failed) aren't kept: the next Fill asks the app again.
  entry.me.then(me => { if (me?.contactError) early.delete(url); }, () => {});
  early.set(url, entry);
  return entry;
}

// How the generic operators fared on this form (kind, fingerprint, worked or not, why): the app turns the failures into
// reports that help everyone. No questions, no answers.
// `trace` carries only the rows no answer matched (the form's own wording: the app cleans it and drops what could be personal).
function reportControls(config, tab, operated, trace, card = null, uploads = [], starred = 0) {
  // Every fill counts for the board it was on, even when the operators had nothing to do there.
  if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return;
  let host = '';
  try { host = new URL(tab.url).hostname; } catch { /* not a url */ }
  // Every field left and why, so the app counts each reason per board (lib/question-labels.js leftCounts); the wording only of
  // the rows no answer matched (the app learns it), never of the others.
  const unplaced = (Array.isArray(trace) ? trace : []).filter(row => row && row.outcome !== 'filled' && row.reason && row.type !== 'file').slice(0, 25)
    .map(row => ({label: row.reason === NO_ANSWER ? String(row.label || '').slice(0, 100) : '', type: String(row.type || '').slice(0, 20),
      required: !!row.required, outcome: 'left', reason: String(row.reason).slice(0, 80)}));
  // Which service meanings placed a question, and whether the field took the value (counts only: the canary's evidence).
  const aliasUse = (Array.isArray(trace) ? trace : []).filter(row => row && row.alias).slice(0, 20).map(row => ({phrase: String(row.alias).slice(0, 60), ok: row.outcome === 'filled'}));
  // The questions the fill did answer (form wording only), so corrections can be counted against them.
  const filled = (Array.isArray(trace) ? trace : []).filter(row => row && row.outcome === 'filled' && row.source && row.type !== 'file').slice(0, 30).map(row => String(row.label || '').slice(0, 100));
  // How many required questions the form had (the CV and consents aside): the denominator of the per-board rates.
  const required = (Array.isArray(trace) ? trace : []).filter(row => row && row.required && row.type !== 'file' && !/^(legal|written|demographic)/.test(String(row.reason || ''))).length;   // words-ok: our own trace reasons (extension/page/fill.js), not page text
  // The titles of upload slots whose wording no meaning knew (the slot was left empty): the service gives each a meaning once (alias keys resume, cover_letter).
  const uploadTitles = (Array.isArray(uploads) ? uploads : []).slice(0, 5).map(label => String(label || '').slice(0, 60));
  api(config, '/extension/controls', {method: 'POST', body: JSON.stringify({host, items: (Array.isArray(operated) ? operated : []).slice(0, 20), trace: unplaced, aliasUse, filled, required, starred: Math.max(0, Math.min(200, Math.round(Number(starred)) || 0)), uploads: uploadTitles,
    ...(card ? {card} : {})})}).catch(() => {});
}
// Labels of filled fields the person later changed by hand (page/fill.js watchCorrection): sent once, then forgotten.
async function reportCorrections(config, tabId) {
  const frames = await chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: () => (window.__jobPilottoCorrections || []).splice(0)}).catch(() => []);
  const corrections = frames.flatMap(frame => frame.result || []).slice(0, 40);
  if (!corrections.length) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  let host = '';
  try { host = new URL(tab?.url).hostname; } catch { /* not a url */ }
  api(config, '/extension/controls', {method: 'POST', body: JSON.stringify({host, items: [], corrections})}).catch(() => {});
}
// Where an application got to on this page (a form, a page with no form, an account wall): counted per board, nothing else.
async function reportFlow(tab, flow, extra = {}) {
  try {
    const config = await settings();
    if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return;
    let host = '';
    try { host = new URL(tab.url).hostname; } catch { /* not a url */ }
    await api(config, '/extension/controls', {method: 'POST', body: JSON.stringify({host, items: [], ...(flow ? {flow} : {}), ...extra})});
  } catch { /* the app is closed */ }
}
const NO_ANSWER = 'no answer in the kit, Profile or your details';

// fast: the page is already there (the panel's Fill): no wait for it to render.
// Fills running now, by tab: an update waits for them (a reload mid-fill ended Claude's answers and reset the panel, 8 Oct 2026).
const fillsNow = new Set();
async function fillOpenedTab(tab, ...rest) {
  return oneFillPerTab(tab.id, tab.url, async () => {
    fillsNow.add(tab.id);
    try { return await fillOpenedTabNow(tab, ...rest); } finally { fillsNow.delete(tab.id); }
  }, {onJoin: () => decide('fill', 'a fill is already running on this tab: this ask joins it', {tab: tab.id})});
}
async function fillOpenedTabNow(tab, url, force = false, {fast = false, quiet = false} = {}) {
  await arm(tab.id);
  if (!fast) await new Promise(resolve => setTimeout(resolve, 1500)); // forms render after the load event
  const page = tab.url || url;  // the page this fill belongs to: progress is only ever drawn while the tab shows it
  chrome.action.setBadgeText({tabId: tab.id, text: '…'}).catch(() => {});  // the tab may already be closed
  try {
    const config = await settings();
    const ready = prefetch(config, url);
    // No kit (404: not tracked) fills without one; no app or no connection stops with the reason.
    const kit = await ready.kit.catch(error => {
      if (error.status === 401) throw error;
      if (!error.status) throw new Error(NO_APP);
      return {};
    });
    // Your details and CV are read again when the prefetch is more than a few seconds old: a CV tailored (or a detail edited) since the form
    // was first seen must be the one attached, not the copy kept for 10 minutes (found by the e2e apply suite, 3 Oct 2026).
    if (Date.now() - ready.meAt > ME_FRESH_MS) { ready.me = api(config, `/extension/me?url=${encodeURIComponent(url)}`); ready.meAt = Date.now(); }
    const me = await ready.me.catch(() => null);  // missing: fillTab fetches it and says what's wrong
    const result = await fillTab(tab, config, {jobUrl: url, kitAnswers: kit.kit?.answers || [], hasKit: !!kit.kit, coverLetter: kit.kit?.cover_letter || '', force, me,
      onStep: text => progress(tab.id, text, page)});
    if (result?.held) return holdFill(tab, page, result, {decide, progress, note});   // a dialog covers the form and nothing closes it: nothing was typed (dialog-after-fill.js)
    reportControls(config, tab, result?.operated, result?.trace, result?.card, result?.unknownUploads, result?.starred);
    // The kit's eligibility verdict, as a reminder (applying anyway was the user's choice).
    if (kit.kit?.eligible === false) await note(tab.id, `⛔ Reminder from your kit: ${kit.kit.eligibility_note}`, page);
    // Claude could not answer the form's own questions (not answering, a limit, no key): the fill went on without them and the panel said
    // "Ready to submit" with the free-text questions empty (a friend's Ashby form, 2 Oct 2026). Say so on the page, in the log, and to the app.
    if (result?.aiError) {
      const why = String(result.aiError).slice(0, 160);
      decide('fill', 'Claude did not answer the questions', {error: why});
      await note(tab.id, `✈️ The AI couldn't answer the questions this form asks (${why}). Answer them yourself, or press Fill again.`, page);
      api(config, '/extension/event', {method: 'POST', body: JSON.stringify({type: 'ai-failed', url, host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })(), why})}).catch(() => {});
    }
    await closeFillDialogs(tab, {close: closePopupOrLayer, look: layerOnTop, decide});   // dialog-after-fill.js
    await progress(tab.id, '', page);
    if (result.ineligible && await onPage(tab.id, page)) await ineligibleNote(tab.id, result.note, result.partly);
    decide('fill', result.ineligible ? `did not fill: ${result.note || 'ineligible'}` : 'filled the form',
      {url: page, ineligible: !!result.ineligible, aiEligible: result.aiEligible ?? null, forced: result.forced || ''});   // the AI's own verdict and who passed a "no" (eligibility-verdict.js)
    // How each field was handled, so "what happened to <field>?" is answered from the log (8 Oct 2026: it took page probes). Labels and kinds, never a value.
    // One row per field: a later pass (Claude on the page) wins.
    logFieldsLine(decide, result.trace, {page, recipes: sharedFixes(result.operated).count});   // with `required`, so an optional field left empty is not a failure (extension/fill-fields.js); recipes: did the learned layer act (the live twin loop, 9 Oct 2026)
    chrome.action.setBadgeText({tabId: tab.id, text: result.ineligible ? '!' : '✓'}).catch(() => {});  // the tab may already be closed
    return result;
  } catch (error) {
    await progress(tab.id, '', page);
    decide('fill', `failed: ${error.message}`, {url: page});
    // An automatic fill (the page was not asked for by you, just reached in an armed tab) fails quietly: logged, never a popup.
    if (!quiet) await note(tab.id, `✈️ Jobadabra couldn't fill this page: ${plainWhy(error)}. If the form is behind an "Apply" button, open that form from the Jobadabra app.`, page);
    chrome.action.setBadgeText({tabId: tab.id, text: '!'}).catch(() => {});  // the tab may already be closed
    return {error: plainWhy(error)};
  }
}

// Apply with Claude asked for a fill on this tab (hook.js): check its ticket with the app, fill, and write the
// result on the page for the session to read. It then fills what's left, checks, and stops before Submit.
async function handOff(tab, job, ticket) {
  await arm(tab.id);
  const token = crypto.randomUUID(), state = value => chrome.scripting.executeScript({target: {tabId: tab.id}, args: [JSON.stringify(value), token, value.state],
    func: (text, token, now) => { if (now === 'running') window.__jobPilottoFillToken = token; else if (now !== 'error' && window.__jobPilottoFillToken !== token) return; document.documentElement.dataset.jobpilottoFill = text; }}).catch(() => {});   // done only into the page this fill started on (fill-flow.js writeState); an error may come before it started
  try {
    const config = await settings();
    const checked = await api(config, '/extension/ticket', {method: 'POST', body: JSON.stringify({ticket, job})});
    if (!checked.ok) throw new Error('ticket not accepted');
  } catch (error) {
    await state({state: 'error', error: `not allowed: ${plainWhy(error)}`});
    return;
  }
  await state({state: 'running'});
  started.add(tab.id);
  const result = await fillOpenedTab(tab, job.split('#')[0], true);
  await state(result?.error ? {state: 'error', error: result.error}
    : {state: 'done', filled: result?.filled || 0, left: (result?.todo || []).length, todo: (result?.todo || []).slice(0, 20)});
}

// Older builds registered the panel on every https page ("Work on every job site"). Take that registration
// down: a page is touched only when the desktop app opened its tab.
async function retireEverywhere() {
  await chrome.scripting.unregisterContentScripts({ids: ['hook-everywhere']}).catch(() => {});
}
chrome.runtime.onInstalled.addListener(retireEverywhere);
chrome.runtime.onStartup.addListener(retireEverywhere);
retireEverywhere();

// The page's messages are answered by groups (messages-learning.js, messages-panel.js, messages-app.js), registered at the end of this file: each
// answers the messages it owns, and returns undefined for any other, so the next group looks.
const messageHandlers = [];
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  for (const handle of messageHandlers) { const answer = handle(message, sender, reply); if (answer !== undefined) return answer; }
  return false;
});

// Just loaded: open the settings page, which connects to the Jobadabra Mac app by itself.
chrome.runtime.onInstalled.addListener(({reason}) => { if (reason === 'install' && !globalThis.__jobPilottoBackgroundOwned) chrome.runtime.openOptionsPage(); });

const settleOpenTabs = createSettleOpenTabs({arm, memoryReady: () => memoryReady});   // settle-tabs.js: after a reload the panel is put back on the app's tabs and taken off every other page
chrome.runtime.onInstalled.addListener(settleOpenTabs);
chrome.runtime.onStartup.addListener(settleOpenTabs);

// This worker's own id: Chrome may stop the worker and start a new one, and every reading in progress dies with the old one; the app hands
// those tabs back when the id changes.
const WORKER = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// This browser run's id, and the tabs' memory (extension/tab-memory.js), settled once per worker before anything reads them: several reports
// at a worker's start each made their own id before (7 Oct 2026, 22:05:39: three ids in half a second, the app took each for a restart).
// A worker that finds the run's id in session storage is the same run (Chrome stopped and started the worker). Empty: the extension was
// reloaded (its memory is put back, the id kept) or Chrome started (a new id: tab ids start again). onStartup says which.
let sawStartup = false;
chrome.runtime.onStartup.addListener(() => { sawStartup = true; });
const memoryReady = (async () => {
  const {boot: running} = await chrome.storage.session.get('boot').catch(() => ({}));
  if (running) { decide('worker', 'worker started again in the same browser run', {worker: WORKER}); return running; }
  await new Promise(resolve => setTimeout(resolve, 300));   // a Chrome start announces itself (onStartup) as the worker begins
  const {[MEMORY_KEY]: kept} = await chrome.storage.local.get(MEMORY_KEY).catch(() => ({}));
  const run = startRun({kept, sawStartup, tabsNow: await chrome.tabs.query({}).catch(() => [])});
  const boot = run.boot || String(Date.now());
  await chrome.storage.session.set({...(run.restore || {}), boot}).catch(() => {});
  // Why this worker started is otherwise unknowable from the app's log.
  decide('worker', run.boot ? 'worker started in the same browser run: tab memory put back' : 'worker started in a new browser run',
    {worker: WORKER, why: run.why, keys: Object.keys(run.restore || {}).length});
  return boot;
})();
const bootId = () => memoryReady;
// Every read of the tabs' memory waits until it is put back (a reload's first messages come at once).
memoryReadyIs(memoryReady);   // every read of the tabs' memory (tab-memory.js sessionGet) waits until it is put back
// The live copy: written shortly after session storage changes, and right before the extension's own update reload.
async function keepMemory() {
  await memoryReady;
  const items = await chrome.storage.session.get(null);
  if (items.boot) await chrome.storage.local.set({[MEMORY_KEY]: snapshot(items, await chrome.tabs.query({}))});
}
let keepTimer = null;
chrome.storage.onChanged.addListener((_, area) => {
  if (area !== 'session') return;
  clearTimeout(keepTimer);
  keepTimer = setTimeout(() => keepMemory().catch(() => {}), 500);
});
createTabReport({WORKER, armedLogged, bootId, fillsNow, jobOf, keepMemory, newer, readyHandoff, reportCorrections, started});   // tab-report.js
export function newer(a, b) {
  const [x, y] = [a, b].map(v => String(v || '0').split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

const {watchSubmission, onTabSettled} = createSubmitWatch({note});   // submit-watch.js
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === 'complete') onTabSettled(tabId, tab); });

// The fill flow (fill-flow.js) gets what lives on with this worker: the tabs a fill started on, the fill, its report, onPage.
initFillFlow({started, fillOpenedTab, reportFlow, onPage, fillsNow, arm, progress});

// Message groups: registered here, after everything they use exists, in the order the messages were answered before.
messageHandlers.push(createStopMessages());   // stop-messages.js: first, so a stopped worker refuses before any other group acts
messageHandlers.push(createLearningMessages({arm, fillOpenedTab, handOff, jobOf, panelRefused, reportFlow, stepBox, stepNow, watchSubmission}));   // messages-learning.js
messageHandlers.push(createPanelMessages({fillOpenedTab, jobOf, prefetch, readyHandoff, started}));   // messages-panel.js
messageHandlers.push(createAppMessages({bootId, jobOf}));   // messages-app.js
messageHandlers.push(createReportMessages());   // messages-report.js: the panel's "Report this form" flag
