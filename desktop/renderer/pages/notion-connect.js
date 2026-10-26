// Connecting Notion from anywhere in the window (Notion later: the app only tries until it is connected): the dialog with the
// advantages, the locked pages, and the listener for any action that answers {needsNotion, reason} (see preload.cjs).
import {$, message, show} from './core.js';
import {el, notionBenefits, notionGate} from '../components.js';
import {GATE_FOOTNOTE, GATE_TITLE, LOCKED_VIEWS, WHY_CHOICES} from '../notion-benefits.js';
import {closeOnProgress, connectMode, GO_LABEL, ignoreGateEvent, moveAfterConnect} from '../notion-connect-rules.js';
import {MOVE_WORDS, movedText} from '../store-move-text.js';
import {shared} from './shared.js';
import {signInWait} from '../sign-in-wait.js';

export const notionConnected = () => !!shared.state?.notion?.NOTION_PROFILE_PAGE_ID;
// The data has a home (Notion connected, or kept on this Mac: lib/store), so tracking works; false only while trying.
export const tracking = () => notionConnected() || shared.state?.store?.tracking === true;
// A page behind the Notion gate (LOCKED_VIEWS) while not tracking: its loader reads nothing, so a background caller (a finished check,
// a saved answer) never opens the connect prompt uninvited (#410). Guard: test/notion-gate-window.test.js.
export const gatedOut = name => !!LOCKED_VIEWS[name] && !tracking();
export const reasonText = reason => {
  const words = shared.state?.notionReasons?.[reason];
  return words ? `Connect Notion ${words}.` : '';
};


let current = null;  // the open prompt: {reason, where, from, then, sent, notNow, why, connecting, mode, moving}
let underwaySince = 0;  // news of a connect this prompt did not start (Settings, a token): see notion-connect-rules.js
function finish() {
  if (!current || current.sent) return;
  current.sent = true;
}

function progressLine({found, total, building, waitingPage, template, moving}) {
  if (moving) return 'Moving your strategy and matches into Notion…';
  if (building) return 'Connected ✓ Building your Jobadabra workspace in Notion (databases, columns, pages)… about a minute.';
  if (waitingPage) return 'Waiting for Notion to share an empty page for your new Jobadabra workspace with the app…';
  return template ? `Connected ✓ Notion is copying the Jobadabra template into your workspace: ${found} of ${total} ready. About a minute; the app keeps checking.`
    : `Notion is still sharing your workspace with the connection: ${found} of ${total} found. This can take a minute; the app keeps checking.`;
}

// The prompt's words for its mode (rules connectMode): "Connect and move" with the move said up front, "Move to Notion" when connected already.
function setMode(box) {
  // Connected is read from the store's own answer: state.notion holds Notion's pages only while Notion holds the data (main.js state).
  box.mode = connectMode({store: shared.state?.store, connected: !!shared.state?.store?.notionConnected || notionConnected()});
  box.sent = box.mode === 'move';   // a move-only prompt is no connect to report
  const why = shared.state?.notionReasons?.[box.reason];
  const words = box.mode !== 'move' ? reasonText(box.reason) : why && box.reason !== 'move' ? `Needed ${why}.` : '';
  $('notion-connect-title').textContent = box.mode === 'move' ? 'Move your data to Notion' : GATE_TITLE;   // about Notion
  $('notion-connect-reason').textContent = words;
  show($('notion-connect-reason'), !!words);
  show($('notion-connect-move'), box.mode !== 'connect');
  show($('notion-connect-benefits'), box.mode !== 'move');
  show($('notion-connect-note'), box.mode !== 'move');   // the sign-in footnote: no sign-in when Notion is connected already
  $('notion-connect-go').textContent = GO_LABEL[box.mode];
}

// reason: a key of lib/notion-gate.js REASONS, or 'none' (the Optional extras card, Settings). where: dialog | extras | settings.
// then(result): runs after a successful connect, and after the move it announced (the action the user asked for, or a redraw).
// With the data on this Mac the prompt is "Connect and move", or "Move to Notion" when Notion is connected already (rules connectMode).
export function openNotionConnect({reason = 'none', where = 'dialog', from = 'dialog', then = null} = {}) {
  const dialog = $('notion-connect-dialog');
  current = {reason, where, from, then, sent: false, notNow: false, why: null};
  setMode(current);
  // The mode follows where the data is now: the state read at start may be older (a token pasted, a move finished elsewhere).
  const box = current;
  window.pilot.state().then(state => { shared.state = state; if (current === box && !box.connecting && !box.moving) setMode(box); }).catch(() => {});
  show($('notion-connect-why'), false);
  $('notion-connect-later').textContent = 'Not now';
  $('notion-connect-go').disabled = false;
  message('notion-connect-message', '');
  show($('notion-connect-token'), false);
  show($('notion-connect-import'), !!shared.state?.settings?.importedNotion);   // after an import (main.js importedNotion): the moment a new workspace would be made
  if (!dialog.open) dialog.showModal();
}

// The move the prompt announced (lib/store-move.js through preload's moveToNotion): progress in the prompt, then box.then(result).
async function move(box) {
  box.moving = true;
  $('notion-connect-go').disabled = true;
  message('notion-connect-message', 'Moving your data to Notion…', 'waiting');
  const result = await window.pilot.moveToNotion().catch(error => ({ok: false, error: error.message}));
  box.moving = false;
  $('notion-connect-go').disabled = false;
  shared.state = await window.pilot.state();
  if (!result?.ok) {
    // Stopped: nothing changed, the data is still on this Mac; the prompt stays open with "Move to Notion" to try again.
    box.mode = 'move';
    $('notion-connect-go').textContent = GO_LABEL.move;
    message('notion-connect-message', result?.text || result?.error || 'Not moved.', 'error');
    box.then?.(result);
    return;
  }
  message('notion-connect-message', movedText(result), 'ok');
  setTimeout(() => { $('notion-connect-dialog').close(); box.then?.(result); }, 2500);
}

let waitSignIn = fn => fn();   // set by init(): the Go button as Cancel sign-in while Notion's wait runs
async function connect() {
  if (!current) return;
  const box = current;
  // A press before the fresh state arrived: decide on the state now, so a connected Notion is never asked to sign in again.
  shared.state = await window.pilot.state().catch(() => shared.state);
  setMode(box);
  if (box.mode === 'move') { await move(box); return; }
  box.connecting = true;
  message('notion-connect-message', 'Waiting for Notion: approve in your browser, then come back here. Press Cancel sign-in to stop.');
  const result = await waitSignIn(() => window.pilot.notionOAuth({from: box.from}).catch(error => ({ok: false, error: error.message})));
  if (!result.ok) {
    message('notion-connect-message', result.error || 'Not connected.', 'error');
    show($('notion-connect-token'));
    return;
  }
  shared.state = await window.pilot.state();
  finish();
  if (box.mode === 'connect-move' && moveAfterConnect(result)) { await move(box); return; }
  // Where the data lives now (lib/store-handlers.js startOnNotionIfEmpty): nothing on this Mac yet → Notion from now on; data here → it stays
  // until "Move my data to Notion" (Settings → Data & backup).
  const where = result.startedOnNotion ? ' Your jobs and applications live in Notion from now on.'
    : moveAfterConnect(result) ? ' Your data is still on this Mac: Settings → Data & backup → Move my data to Notion.' : '';
  message('notion-connect-message', result.kept
    ? `Connected ✓ Your Notion already had a Profile, so it was kept. This Mac's version is saved in ${result.kept}.${where}`
    : `Connected ✓${where}`, 'ok');
  setTimeout(() => { $('notion-connect-dialog').close(); box.then?.(); }, result.kept || where ? 4000 : 900);
}

// Open one of the user's Notion pages (a key of state.notion), or the connect prompt when Notion isn't connected.
// Opening takes about a second: the button that asked shows it (disabled, "Opening…"), for every caller at once (#66 Strategy, #74 Settings).
export async function openInNotion(key, event, reason = 'profile') {
  if (!notionConnected()) { openNotionConnect({reason, where: 'dialog', from: `gate:${reason}`}); return; }
  const button = event?.currentTarget?.tagName === 'BUTTON' ? event.currentTarget : null;
  // The words change only where they are plain text (a <span>, or a button with no icon): an icon inside must survive.
  const label = button && (button.querySelector('span') || (button.children.length ? null : button));
  const was = label?.textContent;
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); if (label) label.textContent = 'Opening…'; }
  try { return await window.pilot.openNotion(shared.state.notion[key], !!event?.metaKey); }
  finally { if (button) { button.disabled = false; button.removeAttribute('aria-busy'); if (label) label.textContent = was; } }
}

// Settings → Notion: the advantages and "Connect" until it is connected; "Reconnect" after.
export function showNotionPanel() {
  const on = notionConnected();
  const list = $('set-notion-benefits');
  if (!list.children.length) list.replaceChildren(...notionBenefits().children);
  show(list, !on);
  $('set-notion-oauth').textContent = on ? 'Reconnect with Notion' : 'Connect with Notion';
}

// A page that needs Notion: until it is connected only the gate card shows. true = locked (don't load the page).
export function applyViewGate(name, {then = null} = {}) {
  const view = document.querySelector(`.view[data-view="${name}"]`);
  const reason = LOCKED_VIEWS[name];
  if (!view || !reason) return false;
  const locked = !tracking();
  view.classList.toggle('notion-locked', locked);
  let host = view.querySelector(':scope > .notion-gate-host');
  if (!locked) { host?.remove(); return false; }
  if (!host) { host = el('div', 'notion-gate-host'); view.prepend(host); }
  host.replaceChildren(notionGate({reasonText: reasonText(reason),
    onConnect: () => openNotionConnect({reason, where: 'view', from: `gate:${reason}`, then})}));
  return true;
}

// Run at start-up (app.js calls each page's init).
export function init() {
  const benefits = $('notion-connect-benefits');
  benefits.replaceChildren(...notionBenefits().children);
  $('notion-connect-title').textContent = GATE_TITLE;
  $('notion-connect-note').textContent = GATE_FOOTNOTE;
  waitSignIn = signInWait($('notion-connect-go'), () => window.pilot.notionOAuthCancel());
  $('notion-connect-go').addEventListener('click', connect);
  // Setup → Optional extras → Notion: the first three advantages; "Connect" opens the prompt on this step (the other extras'
  // buttons finish setup and open Settings, strategy-review.js); connected, the button is "Manage" and does that like the rest.
  $('extras-notion-benefits').replaceChildren(...notionBenefits(3, {compact: true}).children);
  $('extras-notion').addEventListener('click', event => {
    if (notionConnected()) return;
    event.stopImmediatePropagation();  // this listener is registered first: the finish-setup handler never runs
    openNotionConnect({reason: 'none', where: 'extras', from: 'wizard', then: () => import('./settings.js').then(settings => settings.showExtrasStatus())});
  });
  $('notion-connect-later').addEventListener('click', () => {
    if (!current) return;
    if (current.notNow) { $('notion-connect-dialog').close(); return; }
    current.notNow = true;
    show($('notion-connect-why'));
    $('notion-connect-later').textContent = 'Close';
  });
  $('notion-connect-why').replaceChildren(el('span', 'muted small', 'Why not? (optional)'), ...WHY_CHOICES.map(([key, label]) => {
    const chip = el('button', 'ui-tag is-action', label);
    chip.type = 'button';
    chip.addEventListener('click', () => { if (current) current.why = key; $('notion-connect-dialog').close(); });
    return chip;
  }));
  // Closed by Esc, the backdrop, Close or a chip: Not now when it was asked, else just closed (a connect already reported itself).
  $('notion-connect-dialog').addEventListener('close', () => { finish(); });
  // Any action that needs Notion (preload.cjs): the prompt, then the same action again, then the Jobs list read afresh.
  window.addEventListener('pilot-needs-notion', () => {
    const need = window.pilot.takeNotionNeed();
    if (!need || $('notion-connect-dialog').open) return;
    if (ignoreGateEvent({since: underwaySince})) return;   // a connect is already running: asking again would stack a prompt on it
    openNotionConnect({reason: need.reason, where: 'dialog', from: `gate:${need.reason}`, then: async () => {
      await window.pilot.retryNotionNeed().catch(() => null);
      import('./jobs.js').then(jobs => jobs.loadJobs());
    }});
  });
  // A move this prompt runs: its progress here (data.js shows the same in Settings → Your data).
  window.pilot.onStoreMoveProgress(({entity, done, total} = {}) => {
    if (current?.moving && $('notion-connect-dialog').open) message('notion-connect-message', `Moving ${MOVE_WORDS[entity] || entity}… ${done} of ${total}`, 'waiting');
  });
  // An action that runs off this Mac (Always on, Telegram buttons while it is off) while the data is here (preload.cjs): the move, then the action again.
  window.addEventListener('pilot-needs-move', () => {
    const need = window.pilot.takeNotionNeed();
    if (!need || $('notion-connect-dialog').open) return;
    openNotionConnect({reason: need.reason, where: 'dialog', from: `gate:${need.reason}`, then: async result => {
      if (result?.ok) await window.pilot.retryNotionNeed().catch(() => null);
    }});
  });
  window.pilot.onNotionProgress(progress => {
    const dialog = $('notion-connect-dialog'), own = !!current?.connecting;
    if (!own) underwaySince = Date.now();
    if (closeOnProgress({dialogOpen: dialog.open, ownConnect: own})) { dialog.close(); return; }
    if (dialog.open && current) message('notion-connect-message', progressLine(progress), 'waiting');
  });
}
