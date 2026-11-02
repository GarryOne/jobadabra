// Following the live run in a row replay (speed-5x landing 2): a recorded page has no scripts, so what the site did after a press (a dialog its script opened, a
// route it changed, a banner it closed) is played back from the live run's own states (lib/capture-journey.mjs: each settled state in order, with its time) once
// the replay's extension makes the same press as the live run did at that point (presses.json, lib/replay-candidate.mjs livePresses). A different press stops the
// replay: "pressed X, live pressed Y" is the finding a fix needs. Used by lib/row-replay.mjs. Guard: e2e/test/row-follow.test.mjs.
// Job: serve stored answers

// The presses the replay's extension logged (its /extension/log calls, our own wording), in order. -> [{what, label}]
const PRESS = /^((?:pressed [^:]*?|closed a popup))(?::.*)?$/;   // words-ok: our own log's wording, not page text
export function replayPresses(requests, hosts = null) {   // hosts: only this row's presses (each press line names its host), when rows replay side by side
  const presses = [];
  for (const request of requests.filter(item => item.route === '/extension/log')) {
    let entries = [];
    try { entries = JSON.parse(request.body).entries || []; } catch { continue; }   // a body cut at the recording limit
    for (const entry of entries) {
      const text = String(entry.text || '').replace(/^[a-z-]+: /, ''), found = text.match(PRESS);
      if (found && found[1].trim() !== 'closed a popup' && (!hosts || !entry.fields?.host || hosts.has(String(entry.fields.host)))) presses.push({what: found[1].trim(), label: String(entry.fields?.label || '')});
    }
  }
  return presses;
}

// The main page's state the live run reached after its press `k` (between that press and the next one: the one kept at the extension's ask, else the first), or null.
// A popup close is optional on BOTH sides (12 Oct 2026): the replayed page may or may not offer the banner the live run closed (Teamtailor: the page kept after the close has none; Lever: the banner's markup stays in every
// kept state, so the replay's extension closes it again and "pressed deny; the live run pressed nothing more" ended the replay at 1.6 s), and the owner's continuous popup guard closes popups at any moment. A popup
// changes no journey: it is in neither list (replayPresses leaves it out of the replay's, this out of the live run's) before presses are compared or states are indexed. The 2nd argument is kept for old callers.
export const keptPresses = presses => presses.filter(press => press.what !== 'closed a popup');

// Which later states follow an EVENT of the live run, not the extension's attach (12 Oct 2026, Lever): the cookie banner is hidden (display:none) 1.3 s after the popup was closed, and the form judge saw the resume widget
// reading "CV.PDF Success!" 1 s after the form answers came back. A replay that plays states by the clock (or by the attach alone) showed the extension's asks the page BEFORE those changes. Each later state is bound to the
// last live event within reach before it: a popup close or an answered model ask (5 s: a state is kept when the page has settled, a moment after the change): {state, kind: 'popup', k} = after the k-th popup the replay's extension closes; {state, kind: 'ask', route, n} = before the
// n-th answer on that route is delivered. The first later state stays the attach's (Ashby: the page's autofill after the upload) unless a popup close precedes it. asks: [{route, at}], popups: [{at, label}], by time.
export function bindToEvents(later, {asks = [], popups = []} = {}) {
  const bound = [], free = [];
  later.forEach((state, index) => {
    let hit = null;
    popups.forEach((popup, k) => { if (popup.at <= state.at && state.at - popup.at <= 5000 && (!hit || popup.at >= hit.at)) hit = {kind: 'popup', k, at: popup.at}; });
    const seen = {};
    for (const ask of asks) {
      seen[ask.route] = (seen[ask.route] || 0) + 1;
      if (ask.at <= state.at && state.at - ask.at <= 5000 && (!hit || ask.at >= hit.at)) hit = {kind: 'ask', route: ask.route, n: seen[ask.route], at: ask.at};
    }
    if (hit && (index > 0 || hit.kind === 'popup')) bound.push({state, ...hit}); else free.push(state);
  });
  return {bound, free};
}

// How long after the extension's file attach the page moves to the live run's next state: the gap the live run had between that state and the one before it, within 150 ms and 8 s. The site's autofill
// took seconds (Ashby: 2.6-4.6 s); a swap at 150 ms made the extension's first page-kind ask see the AUTOFILLED page the live ask never saw (12 Oct 2026: cold ask, "Autofill completed!" in its headings).
export const followDelayMs = (was, next) => Math.min(8000, Math.max(150, Number.isFinite(next?.at - was?.at) ? next.at - was.at : 150));

// k = -1: before any press (the segment the page starts in; its state is the page as the extension saw it when it asked).
const segment = (states, presses, k) => {
  const after = k < 0 ? -Infinity : presses[k]?.at, before = presses[k + 1]?.at ?? Infinity;
  return after == null ? [] : states.filter(state => state.at > after && state.at < before);
};
export function stateAfter(states, presses, k) {
  const window = segment(states, presses, k);
  return window.find(state => state.ask) || (k < 0 ? null : window[0]) || null;   // the page as the extension saw it when it asked, else the first state kept after the press
}

// The states the page reached on its own in that segment after the one stateAfter serves (the site's script reacting to the extension: an attached CV autofilled the form and emptied the boxes the
// extension had typed, Ashby, 12 Oct 2026). One follows per extension action (an attach, lib/row-replay.mjs), so a row with 0 presses reaches them too. A copy of the page just before it is not a new state.
export function laterStates(states, presses, k) {
  const window = segment(states, presses, k), first = stateAfter(states, presses, k) || window[0];
  if (!first) return [];
  const later = [];
  for (const state of window.filter(one => one.at > first.at)) if (state.html !== (later.at(-1) || first).html) later.push(state);
  return later;
}

// Press `k` of the replay against the live run's: -> {same: true} or {same: false, finding}.
export function samePress(mine, live, k) {
  if (!live) return {same: false, finding: `pressed "${mine.label}" (${mine.what}); the live run pressed nothing more`};
  if (mine.what === live.what && mine.label === live.label) return {same: true};
  return {same: false, finding: `press ${k + 1}: pressed "${mine.label}" (${mine.what}); live pressed "${live.label}" (${live.what})`};
}

// Runs in the page: the recorded next state of this same address is played INTO the page (12 Oct 2026): an element that is still there stays the same element (the extension holds the boxes it typed
// in; a page's own script empties their value, it does not replace them: fix 2f6a91e retypes exactly such a box, which a replaced one could never show), its attributes and text follow the new state,
// a text box or area takes the capture's value (none: the capture strips typed values), nodes only one side has are added or removed. The extension's own UI (ids jobadabra-*) is kept.
export function swapInPage(html) {
  /* global document, DOMParser */
  const next = new DOMParser().parseFromString(html, 'text/html');
  const ours = node => node.nodeType === 1 && /^(jobadabra|jobadabra)/.test(node.id || '');
  const sameKind = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && (a.nodeType !== 1 || (a.id || '') === (b.id || ''));
  const morph = (from, to) => {
    if (from.nodeType === 3 || from.nodeType === 8) { if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue; return; }
    for (const attr of [...from.attributes]) if (!to.hasAttribute(attr.name) && !/^data-jobadabra/.test(attr.name) && attr.name !== 'value') from.removeAttribute(attr.name);
    for (const attr of [...to.attributes]) if (attr.name !== 'value' && from.getAttribute(attr.name) !== attr.value) from.setAttribute(attr.name, attr.value);
    if (/^(INPUT|TEXTAREA)$/.test(from.tagName) && !/^(file|checkbox|radio|submit|button|image|reset|hidden)$/i.test(from.type || '') && to.getAttribute('data-jp-state') !== 'filled') from.value = to.getAttribute('value') ?? (to.tagName === 'TEXTAREA' ? to.textContent : '');   // a box the live state had FILLED keeps what the extension typed
    if (from.tagName === 'TEXTAREA') return;
    const mine = [...from.childNodes].filter(node => !ours(node)), theirs = [...to.childNodes];
    for (let at = 0; at < Math.max(mine.length, theirs.length); at++) {
      if (!mine[at]) from.append(theirs[at]);
      else if (!theirs[at]) mine[at].remove();
      else if (sameKind(mine[at], theirs[at])) morph(mine[at], theirs[at]);
      else mine[at].replaceWith(theirs[at]);
    }
  };
  morph(document.body, next.body);
  // The live state's control states (lib/capture-page.mjs data-jp-state, no values): a box the page had filled is filled (a typed value stays, else a stand-in), a checkbox is as it was, a select has a choice or none.
  for (const field of document.querySelectorAll('[data-jp-state]')) {
    const mark = field.getAttribute('data-jp-state');
    if (/^(checkbox|radio)$/i.test(field.type || '')) field.checked = mark === 'checked';
    else if (field.tagName === 'SELECT') { if (mark === 'filled' && field.selectedIndex <= 0 && field.options.length > 1) field.selectedIndex = 1; if (mark === 'empty') field.selectedIndex = 0; }
    else if (mark === 'filled' && !String(field.value || '')) field.value = 'x';
    else if (mark === 'empty') field.value = '';
  }
  document.head.innerHTML = next.head.innerHTML;
  document.title = next.title;
}
