// After a fill: a dialog that opened while the form was filled (often our own upload or typing: a site's "your fields may be replaced, continue?") is closed
// with the button the app's AI names for "close without agreeing" (consent.js closePopup, popup-pick.js), and one still over the form after that is reported,
// so a run never ends "5 of 8 filled" with a modal covering the form (Louis Vuitton jobs, 11 Oct 2026). Found by structure (popup-page.js), no words here.
// Guards: app-core/test/dialog-after-fill.test.js.
import {onTop} from './on-top.js';
export const LEFT_OPEN = 'a dialog was left open over the form';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// close(tabId) -> label pressed or ''; look(tabId) -> {text, buttons} of a dialog still in the way, or null. -> {closed, left}
export async function settleDialogs(tabId, {close, look, settleMs = 600}) {
  const closed = await close(tabId).catch(() => '');
  if (closed) await sleep(settleMs);
  const left = await look(tabId).catch(() => null);
  return {closed: closed || '', left: left?.buttons?.length ? {text: String(left.text || '').slice(0, 200), buttons: left.buttons.slice(0, 6)} : null};
}
// The fill's own end: close what opened, say what is still there (a log line the smoke reads: desktop/e2e/lib/record-sites.mjs parseLive).
export async function closeFillDialogs(tab, {close, look, decide}) {
  const dialogs = await settleDialogs(tab.id, {close, look});
  if (dialogs.closed) decide('fill', 'closed a dialog opened by the fill', {label: dialogs.closed.slice(0, 40), tab: tab.id});
  if (dialogs.left) decide('fill', LEFT_OPEN, {host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })(), buttons: dialogs.left.buttons.length});
  return dialogs;
}

// The gate before the fill (owner, 11 Oct 2026: "we should not start filling any form before we close all the popups/overlays"). look(tabId) -> what covers the form's controls
// (on-top.js: {text, buttons, ...}) or null; close(tabId) -> the label of the AI's non-agreeing button pressed, or ''. A layer is closed and looked at again, at most 3 times;
// one nothing closes (the AI says none: a sign-in, a robot check, a consent the person must give) holds the fill only when it is drawn over a control of the form, and nothing is typed. -> {held, closed: [labels], layer}
// A layer whose covered list is empty leaves every control usable; one whose list is unknown (a look that does not say) is taken as covering.
const coversForm = layer => !Array.isArray(layer.covered) || layer.covered.length > 0;
export const HELD = 'a dialog covers the form';
// A layer with no text and no control is no dialog anyone could read or close (owner's real fill, 15 Oct 2026: a transparent busy/block layer drawn while a page loads held the fill with "buttons":0,"text":"", and the person saw nothing): waited out
// a few looks; gone or still empty, it never holds the fill.
const emptyLayer = layer => !String(layer?.text || '').trim() && !layer?.buttons?.length;
export const EMPTY_LOOKS = 5;
export async function clearBeforeFill(tabId, {close, look, tries = 3, settleMs = 600}) {
  const closed = [];
  for (let attempt = 0; attempt < tries; attempt++) {
    let layer = await look(tabId).catch(() => null);
    if (!layer) return {held: false, closed, layer: null};
    if (emptyLayer(layer)) {
      for (let wait = 0; wait < EMPTY_LOOKS && layer && emptyLayer(layer); wait++) { await sleep(settleMs); layer = await look(tabId).catch(() => null); }
      if (!layer || emptyLayer(layer)) return {held: false, closed, layer: null};
    }
    let pressed = await close(tabId).catch(() => '');
    // Nothing pressed: the layer may have gone on its own, or been closed by another asker, between the list and the press (fix-import-dialog's false hold): look once more.
    if (!pressed) { await sleep(settleMs); const again = await look(tabId).catch(() => null); if (!again) return {held: false, closed, layer: null}; layer = again; }
    // A layer that leaves the form's controls usable never holds the fill (Recruitee, 11 Oct 2026: a closable notice drawn over the page centre stopped 6 of 6 at 1 of 13): only one drawn over a control does.
    if (!pressed) return {held: coversForm(layer), closed, layer};
    closed.push(pressed);
    await sleep(settleMs);
  }
  const layer = await look(tabId).catch(() => null);
  return {held: !!layer && !emptyLayer(layer) && coversForm(layer), closed, layer: layer || null};
}

// A held fill, said everywhere: the log line the pool reads (record-sites.mjs parseLive), and the person told on the page.
export async function holdFill(tab, page, result, {decide, progress, note}) {
  const why = String(result.layer?.text || '').slice(0, 120);
  decide('fill', `held: ${result.note}`, {host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })(), text: why, buttons: result.layer?.buttons?.length || 0});
  await progress(tab.id, '', page);
  await note(tab.id, `✈️ A dialog is in the way${why ? `: "${why}"` : ''}. Close it, then press Fill again.`, page);
  return result;
}

// What covers the form's controls, found by occlusion (on-top.js), as {text, buttons} for settleDialogs / clearBeforeFill; null when nothing does (a layer that covers no control is none).
export const layerOnTop = tabId => chrome.scripting.executeScript({target: {tabId, frameIds: [0]}, func: onTop})
  .then(rows => { const layer = rows?.[0]?.result; return layer && !layer.pressed ? {text: layer.text, buttons: layer.buttons, covered: layer.covered || []} : null; }).catch(() => null);
