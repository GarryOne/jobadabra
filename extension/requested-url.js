// The address the app asked a tab to open, kept per tab BEFORE any server redirect (webNavigation.onBeforeNavigate sees the request; the tab afterwards only shows where it landed).
// Why (27 Oct 2026, fair round form 264402): http -> https dropped "?gh_jid=<job>"; the tab's own first look already had the redirected address, so the query could only be
// restored from the request. The app's mark (#jobpilotto-fill) says which navigations are the app's. Read by restore-query.js. Guard: desktop/test/restore-query.test.js.
const MARK = /#jobpilotto-fill(=[A-Za-z0-9_-]{1,64})?$/;
const KEY = tabId => `requested:${tabId}`;

// -> the requested address without its mark, or '' (a frame, a page the app did not open, not http(s)).
export function requestedOfNavigation(details) {
  if (details?.frameId !== 0 || !MARK.test(String(details.url || '')) || !/^https?:/.test(details.url)) return '';
  return String(details.url).replace(MARK, '');
}
// Keeps the navigation's requested address for its tab (details: a webNavigation event); nothing for a navigation that is not the app's; a storage failure is swallowed (the restore then has nothing to compare).
export async function noteRequested(details, store = chrome.storage.session) {
  const url = requestedOfNavigation(details);
  if (url) await store.set({[KEY(details.tabId)]: url}).catch(() => {});
}
// -> the address noted for the tab, or '' (none noted, or storage unreadable). Data: noteRequested, in chrome.storage.session.
export async function requestedOf(tabId, store = chrome.storage.session) {
  const key = KEY(tabId);
  return (await store.get(key).catch(() => ({})))[key] || '';
}
// TODO(AI): drop `requested:<tab>` when its tab closes, from the onRemoved listener; extension/background.js is at its 500-line limit (2026-10-27)
export const forgetRequested = (tabId, store = chrome.storage.session) => store.remove(KEY(tabId)).catch(() => {});
if (typeof chrome !== 'undefined' && chrome.webNavigation?.onBeforeNavigate) chrome.webNavigation.onBeforeNavigate.addListener(details => { noteRequested(details); });   // at load: a listener added later would miss the first navigation
