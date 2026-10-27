// Which tabs belong to which application (docs/flows/applying.md, owner 8 Oct 2026): a tab opened by an application's tab is the same
// application (it inherits its job and session), and a tab the page opens by script right after the extension pressed Apply is followed
// while the posting tab closes (same-tab.js decides which). Scenarios owned: "Apply opens its form from the page's script", "Two
// applications side by side". Guards: extension-same-tab.test.js, review.test.js, the e2e rows "Apply opens a new tab" and "side by side".
// Invariants (flow core: read before editing; changing one is the owner's call, said in the commit; each names the test that guards it):
//  1. A tab joins an application only through the extension's own press on its opener (Apply, a route, a next step, an account button) a moment before: a tab the person opens, even from the application's tab, is theirs,
//     never armed, never given the session or the fill mark (13 Oct 2026, owner: GitHub pages filled; desktop/test/extension-tab-adoption.test.js). A tab the app opened for another job stays that job's, whatever order the events come in (desktop/test/extension-opener-race.test.js).
//  2. Tab identity keys are named only in tab-identity.js (desktop/test/extension-tab-identity.test.js).
import {IDENTITY_KEYS, fromOf, inheritedEntries} from './tab-identity.js';
import {FOLD_MS, postingToClose, pressedLately, realOpener} from './same-tab.js';
import {pageKey} from './tab-pages.js';
import {applyState, setApply, WORKING} from './apply-state.js';
import {decide} from './log.js';
import {sessionGet} from './tab-memory.js';
import {isStopped, restart} from './stop-state.js';

export const navSources = new Map();   // new tab id → the tab whose page created it (webNavigation.onCreatedNavigationTarget)
export const noteSource = details => { navSources.set(details.tabId, details.sourceTabId); setTimeout(() => navSources.delete(details.tabId), 60000); };
// The opener of a just-created tab. The source event comes a moment after tabs.onCreated, so a tab that has an opener waits briefly for it.
export async function openerOf(tab, waitMs = 250) {
  if (tab.openerTabId == null && !navSources.has(tab.id)) return null;
  for (let waited = 0; waited < waitMs && !navSources.has(tab.id); waited += 25) await new Promise(resolve => setTimeout(resolve, 25));
  return realOpener(tab, navSources);
}
// The extension moving an armed tab itself (visit.js, fill-flow.js): Chrome reports that navigation as from_api, the same as an address handed in from outside Chrome,
// which the mark must not follow (tab-pages.js navigationKind). Noted by tab id for a few seconds, then forgotten.
const ownMoves = new Map();
export const movedByUs = tabId => ownMoves.has(tabId);
export async function moveTab(tabId, url, api = chrome) { ownMoves.set(tabId, Date.now()); setTimeout(() => ownMoves.delete(tabId), 15000).unref?.(); return api.tabs.update(tabId, {url}); }   // api: a test's fake Chrome (refused-tab.js)
export const applyPressed = new Map();   // tab id → {at, url}: when and on which page the extension pressed its Apply button
const pressedAt = new Map();   // tab id → {at}: any other press of the extension (a route, a next step, an account button, a closer look)
// Said right before the extension clicks something in a tab: a tab that page opens a moment later is the same application's (followOpener below).
export function notePress(tabId, url = '') { pressedAt.set(tabId, {at: Date.now(), url}); setTimeout(() => pressedAt.delete(tabId), FOLD_MS + 1000).unref?.(); }
const presses = {get: tabId => pressedAt.get(tabId) || applyPressed.get(tabId)};

// A tab opened by an armed tab (Apply in a new tab) is the same session. A tab the user opened is not.
// The mark the app puts on a tab it opens for a job (background.js FILL_MARK; a test keeps the two equal).
export const APP_TAB_MARK = 'jobpilotto-fill';
// Tabs the fill mark handler (background.js) has claimed for the app's job, noted before its first await. A tab created before its
// address is known passes the mark check below, and the mark handler's from: lands while followOpener reads the opener's keys: on
// 9 Oct 2026 (e2e rerun-apply, found by mac-bc) the opener's session, job and from were then written over it, and the Lever form
// for one job was filled with another job's kit. Checked again right before the write, with no await in between.
const appTabs = new Set();
export function claimAppTab(tabId, url = '') {
  let host = ''; try { host = new URL(url).hostname; } catch { /* no address: the permission is missing or the page is not http */ }
  decide('tab', 'tab with the fill mark seen', {host, tab: tabId, session: /#jobpilotto-fill=/.test(url)});   // the app's "opened the form tab" without this line: the extension never saw it
  const restarted = restart();
  if (restarted) decide('stop', 'started again: the app opened a tab for a job', {host});   // Apply in the app is the person's word to start again (stop.js)
  if (restarted || !applyState(tabId)) setApply(tabId, WORKING);   // the app's open of a tab starts its Apply before any page loads (apply-state.js); a later event of a tab with a verdict never restarts it   // Apply in the app is the person's word to start again (stop.js)
  appTabs.add(tabId); setTimeout(() => appTabs.delete(tabId), 60000).unref?.(); }
const hostOf = tab => { try { return new URL(tab.pendingUrl || tab.url || '').hostname; } catch { return ''; } };
export async function followOpener(tab) {
  // A tab the app opened for a job carries its mark from the start (url or pendingUrl): it is that job's, never the tab that happened to be in front.
  // The from: key below is set a moment later, too late: on 9 Oct 2026 Nahrin's jobs.ch tab, opened while Coop's tab was in front, inherited Coop's
  // session and its first tab report bound it to Coop (found by mac-1a).
  if ([tab.url, tab.pendingUrl].some(address => String(address || '').includes(`#${APP_TAB_MARK}`))) return false;
  if (isStopped()) return false;
  const opener = await openerOf(tab);
  if (opener == null) return false;
  if (await fromOf(tab.id)) return false;   // a tab the app opened for a job already has its own: the tab that was in front is not its parent (8 Oct 2026, side by side)
  const stored = await sessionGet([`armed:${opener}`, ...IDENTITY_KEYS(opener)]);
  if (!stored[`armed:${opener}`]) return false;
  if (!pressedLately(opener, presses)) {   // a tab the person opened (⌘-click, a link of their own) is theirs: Chrome names the tab in front as its opener (13 Oct 2026)
    decide('panel', 'a tab opened beside the application: not followed, no press of ours', {tab: tab.id, opener, host: hostOf(tab)});
    return false;
  }
  const next = {[`armed:${tab.id}`]: true};
  Object.assign(next, inheritedEntries(stored, opener, tab.id));   // the same application: the newest tab is its tab now
  if (appTabs.has(tab.id)) { decide('panel', 'a tab the app opened for a job: not its opener\'s', {tab: tab.id, opener}); return false; }
  await chrome.storage.session.set(next);
  return true;
}

// Apply opened its next page in a new tab by script (a link or form was already pointed at this tab): the new tab is the
// application from now on, and the posting's tab closes, so one tab is left to follow. A pop-up window (a sign-in) never closes it.
const postingHandled = new Set();   // new tab ids already looked at: each is handled once
export async function closePosting(tab, host) {
  if (postingHandled.has(tab.id)) return;
  postingHandled.add(tab.id);
  const openerId = await openerOf(tab);
  const opener = openerId == null ? null : await chrome.tabs.get(openerId).catch(() => null);
  // Strict: the new tab's opener is the very tab whose Apply was just pressed, still on that page (another flow's tab never is).
  const posting = postingToClose({...tab, openerTabId: openerId}, applyPressed, opener?.url, Date.now(), pageKey);
  if (posting == null) {
    const press = openerId == null ? null : applyPressed.get(openerId);   // why the posting stays: no opener, no press of its own, too long ago, or it is no longer on the page pressed
    decide('panel', 'Apply opened a new tab: the posting tab stays', {host, tab: tab.id, opener: openerId, chromeOpener: tab.openerTabId ?? null, openerUrl: String(opener?.url || '').split('?')[0].slice(0, 80), active: !!opener?.active, pressed: !!press, ageMs: press ? Date.now() - press.at : null, samePage: press ? pageKey(opener?.url) === pageKey(press.url) : null, pressedTabs: [...applyPressed.keys()].join(',')});
    return;
  }
  applyPressed.delete(posting);
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  if (win?.type !== 'normal') { decide('panel', 'Apply opened a pop-up: the posting tab stays', {host, opener: posting, tab: tab.id}); return; }
  await chrome.tabs.remove(posting).catch(() => {});
  decide('panel', 'Apply opened a new tab: followed it, closed the posting tab', {host, opener: openerId, closed: posting, tab: tab.id, within: FOLD_MS});
}
