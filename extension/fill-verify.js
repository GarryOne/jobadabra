// Rung 0 of the fill ladder, the worker's side (spec docs/superpowers/specs/2026-10-12-fill-ladder.md): a text box that did not take the answer the fill set by script
// (a page that keeps its own state from real key presses and writes it back on blur) is typed again the way a person types: one real click on the box, then each
// character as a real key event through Chrome's debugger, then read back (page/fill-verify.js). The second way of the ladder; what still does not hold stays "left".
// Floors: only the boxes the page lists (plain text boxes, never a password, read-only, disabled or a menu's search box), no Enter, no Tab, no other key; at most 8 boxes;
// one debugger at a time (the caller passes the turn it shares with the dropdown clicks). Counts only leave this file, never a value. Guard: worker/test/fill-verify.test.js.
import {attachDebugger, detachDebugger} from './stop-state.js';
import {selectForReplacement} from './text-replace.js';
import {driving} from './input-gap.js';
import {decide} from './log.js';
import {hasPressSpots, pressNotTakenForReal} from './press-real.js';
const SETTLE_MS = 300;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// The key events one character makes. Printable text only: a control character or a newline is not typed (it could press something).
export function keysFor(char) {
  if (!char || /[\u0000-\u001f\u007f]/.test(char)) return [];
  return [{type: 'keyDown', key: char, text: char, unmodifiedText: char}, {type: 'keyUp', key: char}];
}

// page(func, args) runs in the page (main world); send(method, params) is the debugger command (attached by the caller). -> {tried, taken}
export async function typeNotTakenForReal({page, send}) {
  const spots = (await page(() => window.__jobPilottoNotTakenSpots?.() || []).catch(() => [])) || [];
  let taken = 0;
  for (const spot of spots.slice(0, 8)) {
    if ((await page((px, py) => globalThis.__jobPilottoSubmitPress?.markAt(px, py), [spot.x, spot.y]).catch(() => true)) === false) continue;   // the extension's own press: marked first (page/submit-press.js markAt)
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', {type, x: spot.x, y: spot.y, button: 'left', clickCount: 1});
    if (!await selectForReplacement(page, spot.field)) continue;
    for (const char of [...String(spot.text || '')]) for (const key of keysFor(char)) await send('Input.dispatchKeyEvent', key);
    await wait(SETTLE_MS);
    if (await page(field => window.__jobPilottoTakenNow?.(field) || false, [spot.field]).catch(() => false)) taken += 1;
  }
  return {tried: Math.min(spots.length, 8), taken};
}

// The worker's call: attaches the debugger only when the page lists a box to type or a choice to press (press-real.js, the hybrid fill's move 2, same turn).
// tabId -> {tried, taken} of the boxes typed (flow.js says them), plus pressed: {tried, taken} (logged here).
export async function typeNotTakenOnTab(tabId) {
  const page = (func, args = []) => chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func, args}).then(([r]) => r?.result);
  const boxes = ((await page(() => window.__jobPilottoNotTakenSpots?.() || []).catch(() => [])) || []).length > 0;
  if (!boxes && !(await hasPressSpots(page))) return {tried: 0, taken: 0};
  const target = {tabId}, send = (method, params) => chrome.debugger.sendCommand(target, method, params);
  await attachDebugger(tabId);
  try {
    return await driving(tabId, async () => {
      const typed = boxes ? await typeNotTakenForReal({page, send}) : {tried: 0, taken: 0};
      const mouse = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', {type, x, y, button: 'left', clickCount: 1}); };
      const pressed = await pressNotTakenForReal({page, mouse});
      if (pressed.tried) decide('fill', 'pressed for real a choice that did not take its answer', {tab: tabId, tried: pressed.tried, taken: pressed.taken}).catch(() => {});
      return {...typed, pressed};
    });
  } finally { await detachDebugger(tabId); }
}
