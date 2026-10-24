// Ready to send's "Open in my browser" in the extension (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md, PR 5b; owner 18 Oct 2026: carry the
// cookies, the normal fill takes over): a tab the app opened for a job asks the app once, while it first loads, for the night's hand-off
// (desktop/lib/ready-handoff.js). With one, the page's cookies are set, the tab loads the page the night ended on (keeping its fill mark, so it stays
// the app's session), and when that page is loaded its storage is put back and the page marked as the night's; then the fill types the night's answers,
// which the app serves for this page with its kind (desktop/lib/ready-handoff.js: no reading, no AI), and asks only what the night did not see. Never a
// password (the server never takes one), never a file (the normal fill uploads them), never Submit. Guard: desktop/test/extension-ready-handoff.test.js.

export const handoffKey = tabId => `handoff:${tabId}`;
const key = handoffKey;

// The page side, run in the tab: the origin's storage only. The night's values are not written into the page here: a page that starts up after load
// cleared them, and a menu can't be set that way (owner, 18 Oct 2026, 6 of 13 put back then cleared). The fill types them with its own operators, from the
// night's answers the app serves for this page (desktop/lib/ready-handoff.js nightAnswers), so no reading and no AI. Returns how many storage items were put back.
export function restoreInPage(handoff) {
  let put = 0;
  const into = (area, items) => { for (const [name, value] of Object.entries(items || {})) { try { if (area.getItem(name) === null) { area.setItem(name, value); put++; } } catch { /* storage refused */ } } };
  into(localStorage, handoff.localStorage); into(sessionStorage, handoff.sessionStorage);
  if (handoff.fromNight) document.documentElement.setAttribute('data-jobpilotto-night', '1');   // the panel's words (review.js)
  return put;
}

// deps: {chrome, api(path, init), sessionGet(key), move(tabId, url): tabs.js moveTab (so the move counts as the extension's own, never an outside link), decide(what, fields)}.
export function createReadyHandoff({chrome, api, sessionGet, move, decide = () => {}}) {
  const asking = new Map();   // tabId -> {url, ask}: the ask still waiting on the app
  // While a marked tab first loads: ask once. -> true when the tab was sent on to the night's page (the caller stops; that load comes back here).
  // The page can finish loading while the app still answers (e2e, 18 Oct 2026: the fill began on the first page, then again on the night's): that
  // "complete" waits for the ask, and stops too when the tab moved on.
  async function takeHandoff(tabId, url, status) {
    const waiting = asking.get(tabId);
    if (status !== 'loading') return waiting?.url === url ? waiting.ask : false;   // the night's own page loading is never held
    if (waiting) return false;
    const ask = askOnce(tabId, url), entry = {url, ask};
    asking.set(tabId, entry);
    try { return await ask; } finally { if (asking.get(tabId) === entry) asking.delete(tabId); }
  }
  async function askOnce(tabId, url) {
    const state = (await sessionGet(key(tabId)))[key(tabId)];
    if (state) return false;   // asked already (nothing, or the restore waits for the page)
    await chrome.storage.session.set({[key(tabId)]: {step: 'asked'}});
    const answer = await api('/extension/ready-handoff', {method: 'POST', body: JSON.stringify({url})}).catch(() => null);
    const handoff = answer?.handoff;
    if (!handoff?.url) return false;
    let set = 0;
    // cookies is an optional permission (Chrome Web Store, owner 24 Oct 2026): granted from the options page; without it the page loads and the fill goes on, not signed in.
    const mayCarry = await chrome.permissions?.contains({permissions: ['cookies']}).catch(() => false);
    if (mayCarry && chrome.cookies) for (const cookie of handoff.cookies || []) if (await chrome.cookies.set(cookie).catch(() => null)) set++;
    await chrome.storage.session.set({[key(tabId)]: {step: 'restore', handoff}});
    const mark = String(url).includes('#') ? `#${String(url).split('#').slice(1).join('#')}` : '';
    decide('ready', 'open in my browser: the night\'s page', {cookies: set, fields: handoff.snapshot?.fields?.length || 0});
    await move(tabId, `${handoff.url.split('#')[0]}${mark}`);
    return true;
  }
  // When the page is loaded, before the fill: the night's storage back and the page marked as the night's, once.
  async function restoreHandoff(tabId) {
    const state = (await sessionGet(key(tabId)))[key(tabId)];
    if (state?.step !== 'restore') return 0;
    await chrome.storage.session.set({[key(tabId)]: {step: 'done'}});
    const [result] = await chrome.scripting.executeScript({target: {tabId}, func: restoreInPage, args: [state.handoff]}).catch(() => []);
    const restored = Number(result?.result) || 0;
    decide('ready', 'open in my browser: the night\'s storage back', {storage: restored, fromNight: !!state.handoff?.fromNight});
    return restored;
  }
  return {takeHandoff, restoreHandoff};
}
