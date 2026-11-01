// One Allow for every tab the app opens on a site the extension may not run on yet ("Work on every job site" off, the site not one
// of manifest.json's hiring systems). A tab opened to read (visit.js) waited for it since 7 Oct 2026; a tab opened to APPLY only got
// a '?' badge and returned, so nothing happened, nothing was logged and the popup still said "the panel fills the form" (9 Oct 2026,
// a friend's Windows Chrome on jobs.ch). Now both open allow.html beside the site once, badge the tab "waiting for you", tell the app's
// log, and start when Allow is pressed. Guard: desktop/test/extension-site-allow.test.js.
export const ALL_SITES = {origins: ['https://*/*']};   // as declared in manifest.json (optional_host_permissions)
const WAIT = 'fillwait:';

// The extension's page with the Allow button, opened once (Chrome asks for a site permission only from the extension's own page, on a click).
export async function openAllowPage({chrome = globalThis.chrome} = {}) {
  const asked = (await chrome.storage.session.get('allowTab')).allowTab;
  if (asked && await chrome.tabs.get(asked).catch(() => null)) return;
  const tab = await chrome.tabs.create({url: chrome.runtime.getURL('allow.html'), active: true}).catch(() => null);
  if (tab) await chrome.storage.session.set({allowTab: tab.id});
}

// A tab the app opened to apply, on a site not allowed: wait for the person, visibly, and say so in the app's log.
export async function fillWaitsForAllow(tabId, url, {chrome = globalThis.chrome, decide} = {}) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return; }
  chrome.action.setBadgeText({tabId, text: '!'}).catch(() => {});   // the tab may already be closed
  chrome.action.setTitle({tabId, title: 'Jobadabra: waiting for you: press Allow on the page it opened, then the form is filled'}).catch(() => {});
  const known = (await chrome.storage.session.get(`${WAIT}${tabId}`))[`${WAIT}${tabId}`];
  await chrome.storage.session.set({[`${WAIT}${tabId}`]: url});
  await openAllowPage({chrome});
  if (known !== url) await decide?.('panel', 'tab the app opened to apply waits for Allow: the site is not allowed yet', {host});
}

// Seeing such a tab at all: without access to a site, tabs.onUpdated gives the extension no address (tab.url is empty without the "tabs"
// permission, which would ask every user to allow "read your browsing history"), so background.js's mark check never fired there.
// webNavigation always carries the address, as the read path already uses it (visit.js marks). Allowed sites stay background.js's.
export function watchUnallowedFillTabs({chrome = globalThis.chrome, decide} = {}) {
  const check = async details => {
    if (details.frameId !== 0 || !String(details.url).includes('#jobpilotto-fill')) return;
    let origin = '';
    try { origin = `${new URL(details.url).origin}/*`; } catch { return; }
    if (!/^https:/.test(origin) || await chrome.permissions.contains({origins: [origin]})) return;
    await fillWaitsForAllow(details.tabId, details.url, {chrome, decide});
  };
  chrome.webNavigation.onCompleted.addListener(check);
  chrome.webNavigation.onReferenceFragmentUpdated.addListener(check);   // the app marking a tab already open: only its #fragment changes
  return check;
}

// Allow pressed: every apply tab that waited loads again, and its mark starts the fill as on any allowed site.
export async function resumeFillWaiting({chrome = globalThis.chrome, decide} = {}) {
  if (!(await chrome.permissions.contains(ALL_SITES))) return 0;
  const all = await chrome.storage.session.get(null);
  const waiting = Object.keys(all).filter(key => key.startsWith(WAIT));
  for (const key of waiting) {
    await chrome.storage.session.remove(key);
    await chrome.tabs.reload(Number(key.slice(WAIT.length))).catch(() => {});   // closed meanwhile: nothing to start
  }
  if (waiting.length) await decide?.('panel', 'Allow pressed: apply tabs that waited start', {tabs: waiting.length});
  return waiting.length;
}
