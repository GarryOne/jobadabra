// Closing a cookie banner, in every frame of a tab (moved out of visit.js, 9 Oct 2026: the apply flow needs it too; Deloitte's application page sat
// behind one). Its words first (free); a banner in another language: the app picks, from the banner's own buttons, the one that refuses what is not
// necessary, else the one that accepts (desktop/lib/server-pages.js pickChoice, by meaning, kept), and that one is pressed. The page-side half is
// closeConsent in visit-page.js. Guards: app-core/test (extension consent tests), desktop/e2e/test/consent.test.mjs.
import {apiFor, settings} from './flow.js';
import {closeConsent} from './visit-page.js';
import {findPopup} from './popup-page.js';
import {onTop} from './on-top.js';
import {decide} from './log.js';

// A press that closes a layer leaves the tab on the same page. Some closers navigate by script (a button that calls the router: no link or form to see beforehand): the address
// is read before and after, and a press that moved the tab is undone (back) and logged, so the page is never judged as the job's (Duolingo, 13 Oct 2026: "BACK TO HOME" of a layer
// sent the tab to the careers home). Every press below goes through it. Guard: app-core/test/popup-press-stays.test.js.
const MOVED_MS = 900;
const here = url => String(url || '').split('#')[0];
export const pressStays = async (tabId, press, {wait = ms => new Promise(resolve => setTimeout(resolve, ms)), onMoved = () => {}} = {}) => {
  const before = here((await chrome.tabs.get(tabId).catch(() => null))?.url);
  const pressed = await press();
  if (!pressed || !before) return pressed;
  await wait(MOVED_MS);
  const after = here((await chrome.tabs.get(tabId).catch(() => null))?.url);
  if (after && after !== before) { decide('fill', 'popup: the press left the page, went back', {label: String(pressed).slice(0, 40), tab: tabId}); await chrome.tabs.goBack(tabId).catch(() => {}); onMoved(); return ''; }   // onMoved: the app forgets the pick, or the same press is made again on the next look
  return pressed;
};
// cookiesOnly (the application flow): the free word rule only a box that speaks of cookies or tracking, never a privacy or terms box of the form itself.
const STILL_THERE_MS = 1500;   // a closed banner is gone by then; one still listed after it contradicts the answer that was pressed
const inFrames = async (tabId, args = []) => (await chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: closeConsent, args}).catch(() => []))
  .map(frame => frame?.result);
const popupIn = async (tabId, args) => (await chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: findPopup, args}).catch(() => [])).map(frame => frame?.result);
// Any other popup in the way (a newsletter offer, an alert prompt, a chat invitation, a notice nobody's word list knows): found by structure, closed by the
// button the app's AI names (popup-pick.js), never one that agrees, subscribes or sends; no AI answer, nothing pressed. -> the label pressed, or ''.
export const closePopup = async tabId => {
  const seen = (await popupIn(tabId, [{list: true}])).find(found => found?.buttons?.length);
  if (!seen) return '';
  const config = await settings().catch(() => null);
  const choice = config && (await apiFor(tabId, config, '/extension/dismiss-popup', {method: 'POST', body: JSON.stringify(seen)}).catch(() => null))?.button;
  if (!choice) return '';
  const forgetPick = () => apiFor(tabId, config, '/extension/dismiss-popup', {method: 'POST', body: JSON.stringify({...seen, forget: true})}).catch(() => {});
  const pressed = await pressStays(tabId, async () => (await popupIn(tabId, [{press: choice}])).find(Boolean) || '', {onMoved: forgetPick});
  // The page contradicts the kept answer when the same popup is still there after its button: the app forgets it (desktop/lib/kept-decisions.js).
  if (pressed) setTimeout(async () => {
    const still = (await popupIn(tabId, [{list: true}])).find(found => found?.text === seen.text);
    if (still) apiFor(tabId, config, '/extension/dismiss-popup', {method: 'POST', body: JSON.stringify({...seen, forget: true})}).catch(() => {});
  }, STILL_THERE_MS);
  return pressed;
};
// The layer the gate sees (on-top.js: drawn over a control or the page centre, in a dialog or a big fixed layer) is closed through ITS OWN buttons when popup-page.js did not list it
// (a notice with no dialog role and no z-index, a close control the list skipped): the same app pick (popup-pick.js), pressed only if it is a button of that layer. -> the label pressed, or ''.
export const closeLayer = async (tabId, {want = ''} = {}) => {   // want: the fill ladder's repair named this button; pressed only when the app's own pick is the same one
  const run = args => chrome.scripting.executeScript({target: {tabId, frameIds: [0]}, func: onTop, args}).then(rows => rows?.[0]?.result).catch(() => null);
  const layer = await run([]);
  if (!layer?.buttons?.length) return '';
  const config = await settings().catch(() => null);
  const choice = config && (await apiFor(tabId, config, '/extension/dismiss-popup', {method: 'POST', body: JSON.stringify({text: layer.text, buttons: layer.buttons})}).catch(() => null))?.button;
  const forgetPick = () => apiFor(tabId, config, '/extension/dismiss-popup', {method: 'POST', body: JSON.stringify({text: layer.text, buttons: layer.buttons, forget: true})}).catch(() => {});
  return choice && (!want || choice === want) ? pressStays(tabId, async () => (await run([{press: choice}]))?.pressed || '', {onMoved: forgetPick}) : '';
};
export const closePopupOrLayer = async tabId => (await closePopup(tabId)) || closeLayer(tabId);
export const closeConsentEverywhere = async (tabId, {cookiesOnly = false} = {}) => {
  const cookie = await closeCookies(tabId, {cookiesOnly});
  return cookie || closePopup(tabId);
};
const closeCookies = async (tabId, {cookiesOnly = false} = {}) => {
  const only = cookiesOnly ? {cookiesOnly: true} : {};
  const pressed = await pressStays(tabId, async () => (await inFrames(tabId, [only])).find(Boolean));
  if (pressed) return pressed;
  const buttons = [...new Set((await inFrames(tabId, [{list: true, ...only}])).flatMap(found => (Array.isArray(found) ? found : [])))].slice(0, 20);
  if (!buttons.length) return '';
  const config = await settings().catch(() => null);
  for (const value of ['Reject all cookies that are not necessary', 'Accept cookies']) {
    const choice = config && (await apiFor(tabId, config, '/extension/pick-choice', {method: 'POST', body: JSON.stringify({label: 'A cookie banner', value, options: buttons})}).catch(() => null))?.choice;
    if (!choice) continue;
    const forgetPick = () => apiFor(tabId, config, '/extension/pick-choice', {method: 'POST', body: JSON.stringify({label: 'A cookie banner', value, options: buttons, forget: true})}).catch(() => {});
    const pressed = await pressStays(tabId, async () => (await inFrames(tabId, [{press: choice, ...only}])).find(Boolean) || '', {onMoved: forgetPick});
    // Still offered after the press: the banner did not close, so the kept answer is dropped (desktop/lib/kept-decisions.js).
    if (pressed) setTimeout(async () => {
      const left = (await inFrames(tabId, [{list: true, ...only}])).flatMap(found => (Array.isArray(found) ? found : []));
      if (left.includes(choice)) apiFor(tabId, config, '/extension/pick-choice', {method: 'POST', body: JSON.stringify({label: 'A cookie banner', value, options: buttons, forget: true})}).catch(() => {});
    }, STILL_THERE_MS);
    return pressed;
  }
  return '';
};
