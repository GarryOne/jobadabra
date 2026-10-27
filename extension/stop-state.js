// Whether the extension is stopped, and the one door the debugger goes through (extension/stop.js says why and does the stopping). A leaf with no imports on purpose: the files that
// act (the fill, the presses, the debugger users) check it without pulling the worker in. Guard: desktop/test/extension-stop.test.js.
let stoppedAt = 0, generation = 0;
export const isStopped = () => stoppedAt > 0;
export const mayAct = () => stoppedAt === 0;
/** The Stop generation never rewinds on restart: work from before Stop stays retired. */
export const stopGeneration = () => generation;
/** Record a Stop timestamp supplied by the worker or storage restore and retire earlier work; returns nothing. */
export const markStopped = when => { stoppedAt = when; generation++; };
// The person starts it again (Apply in the app, the panel's Fill, the popup's Apply on this page). -> whether it was stopped.
export function restart() {
  if (!stoppedAt) return false;
  stoppedAt = 0;
  chrome.storage.session.remove('stopped').catch(() => {});
  return true;
}
// The person's start on one tab clears that page's own Stop too (stop.js startTab); the page fill waits for it (flow.js pageStarted), so a fill pressed right after
// Stop never meets the old flag and answers "Stopped by you." at once (owner, 27 Oct 2026: "Check form again is not working").
const starting = new Map();   // tab id -> the page's clearing, on its way
export function noteStarting(tabId, done) { starting.set(tabId, done); done.finally(() => { if (starting.get(tabId) === done) starting.delete(tabId); }); }
export const pageStarted = tabId => starting.get(tabId) || Promise.resolve();
// The one place the debugger is attached (it shows Chrome's "started debugging this browser" bar): never while stopped, and only on a tab the app opened for an application.
// Several users share one attachment (the fill's menu clicks and typing, the repair clicks, the picture, the form trace: trace.js): each attachDebugger is matched by ONE detachDebugger, and
// Chrome's detach happens when the last user leaves, so a menu click finishing never ends the trace (spec 2026-10-16-report-from-the-trace.md §1). Guard: desktop/test/trace-debugger.test.js.
const users = new Map();   // tab id -> how many hold the attachment
export async function attachDebugger(tabId) {
  if (isStopped()) throw new Error('stopped: the person pressed Stop');
  const key = `armed:${tabId}`;
  let armed = !!(await chrome.storage.session.get(key).catch(() => ({})))[key];
  if (!armed) armed = String((await chrome.tabs.get(tabId).catch(() => null))?.url || '').includes('#jobpilotto-fill');
  if (!armed) throw new Error('not one of the tabs the app opened for an application');
  if (!users.get(tabId)) await chrome.debugger.attach({tabId}, '1.3');
  users.set(tabId, (users.get(tabId) || 0) + 1);
}
export async function detachDebugger(tabId) {
  const left = (users.get(tabId) || 0) - 1;
  if (left > 0) { users.set(tabId, left); return; }
  users.delete(tabId);
  await chrome.debugger.detach({tabId}).catch(() => {});
}
export const forgetDebuggerUsers = tabId => { if (tabId === undefined) users.clear(); else users.delete(tabId); };   // Chrome detached by itself (a closed tab, DevTools, Stop)
export const debuggerUsers = tabId => users.get(tabId) || 0;
