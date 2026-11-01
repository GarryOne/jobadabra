// The Apply press (moved out of fill-flow.js, 11 Oct 2026, a pure move): on a posting with no form, find the start-applying control (by the
// learned phrases, or the one the page-kind AI named) and press it in this same tab. Part of the flow core with fill-flow.js (its invariant 1:
// Apply is pressed once per tab and page, kept there by triedApply). Guards: extension-tab-pages.test.js, named-controls.test.js, the e2e rows (npm run flows).
// Invariants (flow core: read before editing; changing one is the owner's call, said in the commit):
//  1. A control the AI named is pressed by its own text or not at all: never another route found by a phrase while the named one is visible but refused (desktop/test/named-controls.test.js).
//  2. Never a Submit by another name: a control that submits a form with fields to fill, or that its own code names submit/save, is no candidate (desktop/test/extension-tab-pages.test.js).
//  3. The press stays in this tab: a link, form or script window aimed elsewhere is pointed here; a sized pop-up (features given) is left to the page.
import {api, settings} from './flow.js';
import {decide} from './log.js';
import {NAMED_BUTTONS, pickApplyButton, pickNamedButton} from './tab-pages.js';
import {behindAStep, whyNotPressed} from './ladder/press-why.js';
import {sameControl} from './no-effect.js';
import {notePress} from './tabs.js';
import {mayAct} from './stop-state.js';

// The posting before its form: a page with no form and one "Apply" button (chosen by rule: tab-pages.js pickApplyButton).
const PAGE_BUTTONS = 'a[href], button, [role="button"], input[type="button"]';
function applyCandidates(tabId, listed = PAGE_BUTTONS) {   // listed: PAGE_BUTTONS for the phrase path, NAMED_BUTTONS (the page sketch's own list) when the AI named the control
  return chrome.scripting.executeScript({target: {tabId}, func: selector => [...document.querySelectorAll(selector)].map((el, index) => {
    if (el.closest('[id^=jobadabra], [id^=jobadabra]')) return null;   // never the extension's own UI; the index stays the page's (desktop/e2e/test/own-ui-not-read.test.mjs)
    const box = el.getBoundingClientRect(), style = getComputedStyle(el);
    return {index, tag: el.tagName.toLowerCase(), text: (el.innerText || el.value || el.getAttribute('aria-label') || '').slice(0, 80),
      area: Math.round(box.width * box.height), visible: el.getClientRects().length > 0 && style.visibility !== 'hidden',
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', href: el.getAttribute('href') || '',
      // Hard floor, by structure (any language): never a posting's Apply when it submits a form that has fields to fill (an application's
      // Submit), or when the site's own code names it (or its 2 parents) a submit/save button (9 Oct 2026, live: a SuccessFactors form still
      // loading, 0 inputs, read as a posting; its "Postuler" was SPAN#..._submitBtn.rcmSaveButton). A form of hidden inputs only that posts
      // on to the application (an agency's "To apply") is a way in, not a Submit: it is pressed (e2e chain-step).
      submits: (() => {
        const own = node => `${node.id || ''} ${node.getAttribute('name') || ''} ${typeof node.className === 'string' ? node.className : ''}`;
        for (let node = el, depth = 0; node && depth < 3; node = node.parentElement, depth++) if (/submit|save/i.test(own(node))) return true;
        const fields = form => !!form && [...form.elements].some(item => !['hidden', 'submit', 'button', 'reset', 'image'].includes(item.type) && item.getClientRects().length > 0);
        // A link with no href (a script click handler: the named list now includes it) inside a form that has fields to fill is that form's Submit by another name.
        if (el.tagName === 'A' && !el.hasAttribute('href') && fields(el.closest('form'))) return true;
        return ['submit', 'image'].includes(el.type) && fields(el.form);
      })()};
  }).filter(Boolean), args: [listed]}).then(rows => rows?.[0]?.result || []).catch(() => []);
}
// The start-applying phrases the service has learned (extension/alias-schema.js, key apply_button), asked of the app which asks the site and
// remembers: added to the built-in words, never replacing them. None, and the built-in words work alone.
let phrasesAt = 0, phrasesKept = [];
export async function applyPhrases() {
  if (Date.now() - phrasesAt < 5 * 60 * 1000) return phrasesKept;
  try {
    const found = await api(await settings(), '/extension/aliases', {method: 'POST', body: '{}'});
    phrasesKept = (Array.isArray(found?.aliases) ? found.aliases : []).filter(item => item && item.key === 'apply_button').slice(0, 500);
    phrasesAt = Date.now();
  } catch { /* the built-in words are enough */ }
  return phrasesKept;
}
// -> {pressed: the button's text or null, via: the service phrase that found it ('' for a built-in word), buttons: the visible button texts
// when none was found (the app counts them, to learn new words; texts only, from a page with no form)}.
// The choice pressApply makes for a control the AI named, WITHOUT pressing (the dead-end question in shadow, ladder/fallback.js): the same list, finder and floors. -> {press, why}.
export async function wouldPress(tabId, named, noEffect = []) {
  const candidates = (await applyCandidates(tabId, NAMED_BUTTONS)).filter(item => !noEffect.some(label => sameControl(label, item.text)));
  return pickNamedButton(candidates, named) ? {press: true, why: null} : {press: false, why: whyNotPressed(candidates, named)};
}
export async function pressApply(tabId, phrases = [], named = '', want = '', noEffect = []) {   // named: a button the page-kind AI chose (the start route): pressed by its own text, not ranked (tab-pages.js pickNamedButton); want: the name the AI gave, only for the log
  // The AI named a control (the start route's, or the posting's Apply): the finder searches the list the AI's sketch came from and presses that control only. Never another route found by a phrase
  // in its place when the named one is on the page and visible but a floor refuses it (Hornbach: the digest pressed "(mit Anmeldung)" when "(ohne Anmeldung)" was named). A posting's named control that is
  // hidden or absent sits behind a step (Workday: "Apply Manually" is in the dialog the posting's plain "Apply" opens): then the phrase path runs as before. No name: the phrase path, its own list.
  const target = named || want;
  // noEffect: labels of controls already pressed on this page with nothing happening (no-effect.js): never pressed again, whoever names them (Hornbach 0.9.189: the dead "ohne Anmeldung" link three times). Left out of the list, so a named one is simply not on the page.
  const live = list => list.filter(item => !noEffect.some(label => sameControl(label, item.text)));
  let listed = target ? NAMED_BUTTONS : PAGE_BUTTONS, candidates = live(await applyCandidates(tabId, listed));
  let pick = target ? pickNamedButton(candidates, target) : pickApplyButton(candidates, phrases);
  const why = pick || !target ? null : whyNotPressed(candidates, target);   // the named control's flags, for the log
  if (!pick && want && !named && behindAStep(why)) { listed = PAGE_BUTTONS; candidates = live(await applyCandidates(tabId, listed)); pick = pickApplyButton(candidates, phrases); }
  if (!pick) {
    const seen = [...new Set(candidates.filter(item => item.visible && !item.disabled).sort((a, b) => b.area - a.area).map(item => String(item.text || '').replace(/\s+/g, ' ').trim())
      .filter(text => text && text.length <= 40))].slice(0, 25);
    return {pressed: null, via: '', buttons: seen, why};   // why: flags of the control the AI named (ladder/press-why.js), for the log
  }
  if (!mayAct()) return {pressed: null, via: '', buttons: [], why: null};   // stopped by the person (stop.js): nothing is pressed
  notePress(tabId);   // right before the click: a tab this press opens joins the application, any other tab never does (tabs.js followOpener)
  const done = await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func: (selector, index) => {   // MAIN: the page's own window.open, below
    const el = document.querySelectorAll(selector)[index];
    if (!el) return false;
    el.scrollIntoView({block: 'center'});
    // The next page in this same tab, the way the browser goes there itself (a form keeps what it posts, the page loads once):
    // a link or form that names another tab is pointed at this one (same-tab.js; a tab the page opens by script is followed instead).
    let same = '';
    const link = el.closest('a[target]');
    if (link && link.target.toLowerCase() !== '_self') { link.target = '_self'; same = 'link'; }
    const form = el.form || el.closest('form');
    if (el.getAttribute('formtarget') && el.getAttribute('formtarget').toLowerCase() !== '_self') { el.setAttribute('formtarget', '_self'); same = 'form'; }
    if (form?.target && form.target.toLowerCase() !== '_self') { form.target = '_self'; same = 'form'; }
    const aimed = (link?.getAttribute('target') || el.getAttribute('formtarget') || form?.getAttribute('target') || '').slice(0, 20);
    // A new tab the page opens from its own script (window.open, no window features): Chrome's pop-up blocker refuses it, because this
    // click is not the person's own (jobs.ch, 9 Oct 2026: Apply pressed, no tab, "no form"). For this press it opens in this tab instead,
    // like a link pointed here. A sized pop-up (a sign-in window: features given) is left to the page. Restored a few seconds later.
    const open = window.open;
    const here = address => { try { location.assign(new URL(String(address), location.href).href); } catch { /* not an address */ } };
    const clickedAt = Date.now(), seen = window.__jpOpen = {calls: 0, firstMs: -1};   // evidence only: how often, and how soon after the click, the page opened a window (press-why.js clickTrace)
    const noted = () => { seen.calls += 1; if (seen.firstMs < 0) seen.firstMs = Date.now() - clickedAt; };
    window.open = function (url, name, features) {
      noted();
      if (features) return open.apply(this, arguments);
      same = 'script';
      const address = String(url ?? '');
      if (address && address !== 'about:blank') { setTimeout(() => here(address), 0); return window; }
      // Opened empty, its address set afterwards (w = window.open(); w.location = url): that address comes here too.
      const later = {closed: false, focus() {}, close() {}, opener: window, document};
      Object.defineProperty(later, 'location', {get: () => ({assign: here, replace: here, set href(value) { here(value); }}), set: here});
      return later;
    };
    const counting = function () { noted(); return open.apply(this, arguments); };   // after the redirect window: the page's own behaviour, only counted
    setTimeout(() => { if (window.open !== open) window.open = counting; }, 5000);
    setTimeout(() => { if (window.open === counting) window.open = open; }, 25000);
    (globalThis.__jobadabraPress?.(el) || el.click());
    return {same, tag: el.tagName.toLowerCase(), aimed};
  }, args: [listed, pick.index]}).then(rows => rows?.[0]?.result || null).catch(error => ({error: String(error?.message || error).slice(0, 120)}));
  if (done?.error) { decide('fill', 'the Apply button could not be pressed', {error: done.error}); return {pressed: null, via: '', buttons: []}; }
  return {pressed: done ? pick.text.replace(/\s+/g, ' ').trim().slice(0, 40) : null, via: done ? pick.viaPhrase || '' : '', buttons: [],
    same: done?.same || '', tag: done?.tag || '', aimed: done?.aimed || ''};
}
