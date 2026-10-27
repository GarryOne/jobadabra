// Stop (owner, 13 Oct 2026: "a major bug, I want a stop button"): ONE switch that halts everything the extension does, on every tab, at once. The extension had acted on
// a tab that was no application (a debugging bar, 24 sections opened, a box filled) and nothing but turning it off in chrome://extensions stopped it.
// Stopped means: no press, no typing, the debugger detached, the fill marks and the tabs' application state cleared, every read still on its way late (read-gen.js),
// and nothing starts again until the person presses Apply again (the app opens a tab with the fill mark, the panel's Fill, the popup's "Apply on this page").
// Who asks: the popup's and the panel's Stop button, the app (its answer to any report carries `stop`), Chrome's own "Cancel" on the debugging bar (watchDebugger).
// Every way the extension acts checks it here: attachDebugger (the one place the debugger is attached, only to a tab the app opened), mayAct (before a press), isStopped (the
// fill's entry, the worker's messages, a tab joining an application). Guard: desktop/test/extension-stop.test.js (it fails when a press or an attach skips these).
import {IDENTITY_KEYS} from './tab-identity.js';
import {decide} from './log.js';
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
  window.__jobPilottoStopped = true;
  try { const clean = location.href.replace(/#jobpilotto-fill(=[A-Za-z0-9_-]{1,64})?$/, ''); if (clean !== location.href) history.replaceState(history.state, '', clean); } catch { /* sandboxed page */ }
  for (const id of ['jobpilotto-progress', 'jobpilotto-note', 'jobpilotto-fill-overlay']) document.getElementById(id)?.remove();
  if (!document.documentElement) return;
  document.documentElement.dataset.jobpilottoFill = JSON.stringify({state: 'stopped'});
  if (window.top !== window || document.getElementById('jobpilotto-review-host')) return;
  const box = document.createElement('div');
  box.id = 'jobpilotto-note';
  box.dataset.stopped = '1';
  box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:320px;background:#132439;color:#fff;border-radius:10px;padding:12px 14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px #0008';
  box.textContent = 'Jobadabra is stopped on this page. Press Apply in the app to start again.';
  box.onclick = () => box.remove();
  document.documentElement.append(box);
}

// A page the person starts again: its own Stop goes (the flag, the stopped mark, the stopped note). -> whether it was stopped. Runs in every frame.
function startedPage() {
  const was = !!window.__jobPilottoStopped;
  delete window.__jobPilottoStopped;
  document.querySelector('#jobpilotto-note[data-stopped]')?.remove();
  try { if (JSON.parse(document.documentElement?.dataset.jobpilottoFill || '{}').state === 'stopped') delete document.documentElement.dataset.jobpilottoFill; } catch { /* not our mark */ }
  return was;
}

// The person started again ON this tab (the panel's Fill, Fill again, Check form again, Fill anyway; the popup's Apply on this page): restart() lifts the worker's Stop,
// this lifts the page's, whether or not the worker was still stopped (a Stop lifted from another tab leaves this page's flag behind). The panel hears `started` (it leaves
// "Stopped by you" and works again) and the app is told (its session leaves "Stopped"). The fill waits for the page's part (stop-state.js pageStarted).
// Owner, 27 Oct 2026: "I stopped the extension, then said fill again and then it still stays stopped". -> resolves once the page is clear.
export function startTab(tabId, who = '', wasStopped = false) {
  if (!Number.isInteger(tabId)) return Promise.resolve(false);
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

// Stop everything. -> {tabs}: how many tabs were cleared.
export async function stopAll(reason = 'the person pressed Stop') {
  const at = Date.now();
  markStopped(at);
  await chrome.storage.session.set({stopped: {at, reason: String(reason).slice(0, 80)}}).catch(() => {});
  decide('stop', 'stopped: nothing more is done on any tab', {reason: String(reason).slice(0, 80)});
  const stored = await chrome.storage.session.get(null).catch(() => ({}));
  const ids = new Set(Object.keys(stored).filter(key => key.startsWith('armed:') && stored[key]).map(key => Number(key.slice(6))).filter(Number.isInteger));
  for (const tab of await chrome.tabs.query({}).catch(() => [])) if (tab.id != null && String(tab.url || '').includes('#jobpilotto-fill')) ids.add(tab.id);
  const held = new Set(ids);
  for (const target of await chrome.debugger.getTargets().catch(() => [])) if (target.attached && Number.isInteger(target.tabId)) held.add(target.tabId);
  for (const tabId of held) await chrome.debugger.detach({tabId}).catch(() => {});   // only ours detaches; any other client's attach refuses and is left alone
  forgetDebuggerUsers();   // nobody holds the attachment any more (the form trace is dropped by its own onStopped, messages-report.js)
  for (const tabId of ids) {
    await chrome.storage.session.remove([...IDENTITY_KEYS(tabId), `role:${tabId}`, `armed:${tabId}`, `carried:${tabId}`, `submit:${tabId}`, `judged:${tabId}`, `read:${tabId}`, `next:${tabId}`]).catch(() => {});
    await chrome.storage.session.set({[`stoppedTab:${tabId}`]: at}).catch(() => {});   // still the app's tab for the person's own start (the popup's Apply on this page): its mark and arming are gone
    await chrome.scripting.executeScript({target: {tabId, allFrames: true}, world: 'MAIN', func: stoppedPage}).catch(() => {});
    chrome.tabs.sendMessage(tabId, {type: 'stopped', at}).catch(() => {});   // at: the panel ignores a Stop older than the person's start on it (review.js)
  }
  for (const fn of told) await Promise.resolve(fn(reason, ids.size)).catch(() => {});
  return {tabs: ids.size};
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
