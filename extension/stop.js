// Stop (owner, 13 Oct 2026: "a major bug, I want a stop button"): ONE switch that halts everything the extension does, on every tab, at once. The extension had acted on
// a tab that was no application (a debugging bar, 24 sections opened, a box filled) and nothing but turning it off in chrome://extensions stopped it.
// Stopped means: no press, no typing, the debugger detached, the fill marks and the tabs' application state cleared, every read still on its way late (read-gen.js),
// and nothing starts again until the person presses Apply again (the app opens a tab with the fill mark, the panel's Fill, the popup's "Apply on this page").
// Who asks: the popup's and the panel's Stop button, the app (its answer to any report carries `stop`), Chrome's own "Cancel" on the debugging bar (watchDebugger).
// Every way the extension acts checks it here: attachDebugger (the one place the debugger is attached, only to a tab the app opened), mayAct (before a press), isStopped (the
// fill's entry, the worker's messages, a tab joining an application). Guard: desktop/test/extension-stop.test.js (it fails when a press or an attach skips these).
import {IDENTITY_KEYS} from './tab-identity.js';
import {decide} from './log.js';
import {setApply, workingTabs} from './apply-state.js';
import {forgetDebuggerUsers, isStopped, markStopped, noteStarting, restart as restartState} from './stop-state.js';

export {attachDebugger, isStopped, mayAct} from './stop-state.js';
let lastRequest = '';
const told = [], toldStarted = [];   // what to do once stopped / started again on a tab, besides the above: tell the app (stop-messages.js registers both; this file owns no network)
export const onStopped = fn => { told.push(fn); };
export const onStarted = fn => { toldStarted.push(fn); };

// The state after a worker restart: still stopped, and the app's request already answered stays answered.
export const restored = (async () => {
  const {stopped, stopReq} = await chrome.storage.session.get(['stopped', 'stopReq']).catch(() => ({}));
  if (stopped?.at && !isStopped()) markStopped(stopped.at);
  if (stopReq) lastRequest = stopReq;
})();

// The person starts it again (the one door back): Apply in the app, the panel's Fill, the popup's Apply on this page. -> whether it was stopped.
export function restart(who) {
  const was = restartState();
  if (was) decide('stop', 'started again by the person', {who});
  return was;
}

// What a stopped tab shows: the page-side fill sees the flag between its stages (page/guard-gate.js) and at its start (page/fill.js); the mark goes off the address.
// The panel stays and says "Stopped by you" with "Check form again" itself (review.js hears `stopped`; owner mockup 03): the note below is only for a page without the panel,
// never a second box beside it saying something else (owner, 27 Oct 2026: the panel came back centred and working, undimmed, under "Jobadabra is stopped on this page").
function stoppedPage() {
  window.__jobadabraStopped = true;
  try { const clean = location.href.replace(/#jobpilotto-fill(=[A-Za-z0-9_-]{1,64})?$/, ''); if (clean !== location.href) history.replaceState(history.state, '', clean); } catch { /* sandboxed page */ }
  for (const id of ['jobadabra-progress', 'jobadabra-note', 'jobadabra-fill-overlay']) document.getElementById(id)?.remove();
  if (!document.documentElement) return;
  document.documentElement.dataset.jobadabraFill = JSON.stringify({state: 'stopped'});
  if (window.top !== window || document.getElementById('jobadabra-review-host')) return;
  const box = document.createElement('div');
  box.id = 'jobadabra-note';
  box.dataset.stopped = '1';
  box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:320px;background:#132439;color:#fff;border-radius:10px;padding:12px 14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px #0008';
  box.textContent = 'Jobadabra is stopped on this page. Press Apply in the app to start again.';
  box.onclick = () => box.remove();
  document.documentElement.append(box);
}

// A page the person starts again: its own Stop goes (the flag, the stopped mark, the stopped note). -> whether it was stopped. Runs in every frame.
function startedPage() {
  const was = !!window.__jobadabraStopped;
  delete window.__jobadabraStopped;
  document.querySelector('#jobadabra-note[data-stopped]')?.remove();
  try { if (JSON.parse(document.documentElement?.dataset.jobadabraFill || '{}').state === 'stopped') delete document.documentElement.dataset.jobadabraFill; } catch { /* not our mark */ }
  return was;
}

// The person started again ON this tab (the panel's Fill, Fill again, Check form again, Fill anyway; the popup's Apply on this page): restart() lifts the worker's Stop,
// this lifts the page's, whether or not the worker was still stopped (a Stop lifted from another tab leaves this page's flag behind). The panel hears `started` (it leaves
// "Stopped by you" and works again) and the app is told (its session leaves "Stopped"). The fill waits for the page's part (stop-state.js pageStarted).
// Owner, 27 Oct 2026: "I stopped the extension, then said fill again and then it still stays stopped". -> resolves once the page is clear.
export function startTab(tabId, who = '', wasStopped = false) {
  if (!Number.isInteger(tabId)) return Promise.resolve(false);
  setApply(tabId, 'working');   // the person's own start on this tab: its Apply is working again until a verdict (apply-state.js)
  const page = chrome.scripting.executeScript({target: {tabId, allFrames: true}, world: 'MAIN', func: startedPage})
    .then(rows => (rows || []).some(row => row?.result === true), () => false);
  noteStarting(tabId, page);
  page.then(async was => {
    if (!was && !wasStopped) return;
    decide('stop', 'started again on this tab', {who});
    chrome.tabs.sendMessage(tabId, {type: 'started'}).catch(() => {});
    for (const fn of toldStarted) await Promise.resolve(fn(tabId, who)).catch(() => {});
  });
  return page;
}

// Stop everything. -> {tabs, ok, failed}: how many tabs were cleared; ok false when a step that makes the Stop hold failed, `failed` naming each step and why.
// Why (31 Oct 2026, a8; coordinator: "A Stop that failed must say so (rule 6, safety)"): every step's error was swallowed and the worker answered ok:true, so the panel went on as if
// the Stop had worked. The steps that count are the ones that keep it from holding (the flag a restarted worker reads, a tab's armed marks, the page's own mark); a closed tab, the
// debugger refusing a detach it does not own, the page's panel message and the app's report are best effort and never make the Stop fail.
// Why (1 Nov 2026, #2812, a8's yes): the page's own mark counts only where a script of ours runs. A page Chrome guards (chrome://, the web store, an error page) refuses every
// injection, and all of ours is injected (no content_scripts), so nothing of ours is there; it refused on every press and the Stop never read as done. Whether ours runs is the
// page's answer to the 'stopped' message (review.js, panel-overlay.js reply), never the error's words or the page's address. Each failed step goes to the log, not the page.
export async function stopAll(reason = 'the person pressed Stop') {
  const at = Date.now();
  const failed = [];
  const attempt = (what, work) => Promise.resolve(work).catch(error => { failed.push(`${what}: ${String(error?.message || error).slice(0, 80)}`); });
  markStopped(at);
  await attempt('the Stop could not be kept for a restarted worker', chrome.storage.session.set({stopped: {at, reason: String(reason).slice(0, 80)}}));
  decide('stop', 'stopped: nothing more is done on any tab', {reason: String(reason).slice(0, 80)});
  const stored = await chrome.storage.session.get(null).catch(() => ({}));
  const ids = new Set(Object.keys(stored).filter(key => key.startsWith('armed:') && stored[key]).map(key => Number(key.slice(6))).filter(Number.isInteger));
  for (const tab of await chrome.tabs.query({}).catch(() => [])) if (tab.id != null && String(tab.url || '').includes('#jobpilotto-fill')) ids.add(tab.id);
  const held = new Set(ids);
  for (const target of await chrome.debugger.getTargets().catch(() => [])) if (target.attached && Number.isInteger(target.tabId)) held.add(target.tabId);
  for (const tabId of held) await chrome.debugger.detach({tabId}).catch(() => {});   // only ours detaches; any other client's attach refuses and is left alone
  forgetDebuggerUsers();   // nobody holds the attachment any more (the form trace is dropped by its own onStopped, messages-report.js)
  for (const tabId of new Set([...ids, ...workingTabs()])) setApply(tabId, 'stopped');   // Stop is a verdict: the one owner of the dim says so, every page lifts (apply-state.js)
  for (const tabId of ids) {
    const gone = await Promise.resolve().then(() => chrome.tabs.get(tabId)).then(() => false, () => true);   // a closed tab has nothing left to stop
    const step = (what, work) => (gone ? Promise.resolve(work).catch(() => {}) : attempt(`tab ${tabId}: ${what}`, work));
    await step('its marks were not cleared', chrome.storage.session.remove([...IDENTITY_KEYS(tabId), `role:${tabId}`, `armed:${tabId}`, `carried:${tabId}`, `submit:${tabId}`, `judged:${tabId}`, `read:${tabId}`, `next:${tabId}`]));
    await chrome.storage.session.set({[`stoppedTab:${tabId}`]: at}).catch(() => {});   // still the app's tab for the person's own start (the popup's Apply on this page): its mark and arming are gone
    const refused = await Promise.resolve().then(() => chrome.scripting.executeScript({target: {tabId, allFrames: true}, world: 'MAIN', func: stoppedPage})).then(() => null, error => error);
    // at: the panel ignores a Stop older than the person's start on it (review.js). The answer says a script of ours is on the page.
    const ours = await Promise.resolve().then(() => chrome.tabs.sendMessage(tabId, {type: 'stopped', at})).then(answer => answer?.stopped === true, () => false);
    if (refused && !gone && ours) failed.push(`tab ${tabId}: the page was not marked stopped: ${String(refused?.message || refused).slice(0, 80)}`);
  }
  for (const fn of told) await Promise.resolve(fn(reason, ids.size)).catch(() => {});
  if (failed.length) decide('stop', 'the Stop did not finish', {failed: failed.join(' | ').slice(0, 400)});
  return {tabs: ids.size, ok: failed.length === 0, failed};
}

// Chrome's own "Cancel" on its "started debugging this browser" bar is the person's Stop too (a closed tab or DevTools taking over is not).
export function watchDebugger() {
  chrome.debugger?.onDetach?.addListener((_, why) => { if (why === 'canceled_by_user') stopAll('Cancel on Chrome\'s debugging bar'); });
}

// The app's answer to a report carries `stop: <request id>` until it hears the extension stopped: each request stops once (a request answered before a restart is not asked again).
export async function stopFromApp(answer) {
  const request = typeof answer?.stop === 'string' ? answer.stop : '';
  await restored;
  if (!request || request === lastRequest) return false;
  lastRequest = request;
  await chrome.storage.session.set({stopReq: request}).catch(() => {});
  await stopAll('Stop pressed in the app');
  return true;
}
