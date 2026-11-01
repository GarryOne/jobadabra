// The closer look (spec: docs/superpowers/specs/2026-10-08-ai-escalation.md; owner, 8 Oct 2026: off until he turns it on, account pages first). When the account AI is unsure twice about a page, or a control it
// named cannot be found, the worker takes a screenshot of the tab (typed values hidden for the capture), asks the app (lib/ladder/rung4-picture.js: opt-in, capped, validated, remembered per page shape) and carries out
// ONE action: click a control the page lists, wait, or ask the person. A click that moved the page on is reported back so the app remembers it. Only a tab in front can be photographed. Guard: app-core/test/escalate.test.js.
import {apiFor, settings} from '../flow.js';
import {decide} from '../log.js';
import {sketchOf} from '../judge-sketch.js';
import {hideValues, showValues} from './rung4-page-picture.js';
import {pressRegister} from '../account-fill.js';
import {notePress} from '../tabs.js';
import {attachDebugger, detachDebugger, mayAct} from '../stop-state.js';
import {chooseOption, fillControl} from '../account-act.js';
import {pressInPage} from '../next-step.js';
import {viewOf} from './picture-view.js';

// What the last look said, per tab (the application ladder tells the person which control to press when it may not press it itself).
export const lastLook = new Map();

const run = (tab, frameId, func, args = []) => chrome.scripting.executeScript({target: {tabId: tab.id, frameIds: [frameId ?? 0]}, func, args}).then(rows => rows?.[0]?.result).catch(() => undefined);
export const UNSURE_BEFORE_LOOKING = 2;
// True when this page state has now been "unsure" twice: `seen` is a Map of tab -> {sig, count}.
export function unsureTwice(seen, tabId, sig) {
  const now = seen.get(tabId);
  const next = now?.sig === sig ? {sig, count: now.count + 1} : {sig, count: 1};
  seen.set(tabId, next);
  return next.count === UNSURE_BEFORE_LOOKING;   // exactly the second time, once per page state
}

// The tab as a data: URL. captureVisibleTab needs the page's host permission (an unlisted site has none), so the debugger (already a permission) takes it then.
async function shot(live) {
  try { return await chrome.tabs.captureVisibleTab(live.windowId, {format: 'jpeg', quality: 60}); } catch { /* no host permission: the debugger below */ }
  const target = {tabId: live.id};
  await attachDebugger(live.id);
  try { const {data} = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {format: 'jpeg', quality: 60}); return `data:image/jpeg;base64,${data}`; }
  finally { await detachDebugger(live.id); }
}

// The visible page as a JPEG of at most 1280 px, base64, values hidden while it is taken. null when the tab is not in front.
async function picture(tab, frameId) {
  const live = await chrome.tabs.get(tab.id).catch(() => null);
  if (!live?.active) return null;
  // No picture unless the values are hidden: the page answers true only when the hiding style is in place (a failed injection is undefined).
  if (await run(tab, frameId, hideValues) !== true) { decide('fill', 'closer look: no picture', {why: 'values could not be hidden'}); return null; }
  try {
    await new Promise(resolve => setTimeout(resolve, 120));   // the style paints before the capture
    const url = await shot(live);
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const scale = Math.min(1, 1280 / bitmap.width), canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({type: 'image/jpeg', quality: 0.6});
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  } catch (error) { decide('fill', 'closer look: no picture', {why: String(error?.message || error).slice(0, 120)}); return null; } finally { await run(tab, frameId, showValues); }
}

// -> 'none' | 'click' | 'fill' | 'choose' | 'wait' | 'ask_person' (what was done or decided). reason: why we ask (for the log and the model).
// kind 'form': an application page where a fill put nothing in (fill-flow.js ladder); kind 'page': a job posting where the ladder ended at the person (an Apply control the sketch and the digest missed); picture false = the sketch alone (the cheap look first).
export async function closerLook(tab, frameId, reason, {kind = 'account', picture: withPicture = true} = {}) {
  const config = await settings();
  if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return 'none';
  const sketch = await sketchOf(tab.id, frameId);
  const image = sketch && withPicture ? await picture(tab, frameId) : null;
  if (!sketch || (withPicture && !image)) { decide('fill', 'closer look: no picture (not in front, or no sketch)', {}); return 'none'; }
  const url = tab.url.split('#')[0];
  const answer = await apiFor(tab.id, config, '/extension/escalate', {method: 'POST', body: JSON.stringify({url, kind, sketch, image: image || '', reason})}).catch(() => null);
  const action = answer?.action || 'none';
  lastLook.set(tab.id, {action, control: String(answer?.control || ''), why: String(answer?.why || '')});
  decide('fill', `closer look: ${action}`, {tab: tab.id, reason, by: answer?.by || '', picture: !!image, usd: Number(answer?.usd) || 0, ...viewOf(answer), why: String(answer?.why || '').slice(0, 80)});
  if (action === 'click' && answer.control) {
    // An application page is pressed with the next-step press (never a control that submits or reads like Submit); an account page with the register press.
    if (!mayAct()) return 'none';   // stopped by the person (stop.js)
    notePress(tab.id, tab.url);   // the click below is ours: a tab it opens joins the application (tabs.js followOpener)
    const result = kind === 'form' || kind === 'page'
      ? ((await chrome.scripting.executeScript({target: {tabId: tab.id, frameIds: [frameId ?? 0]}, world: 'MAIN', func: pressInPage, args: [answer.control]}).then(rows => rows?.[0]?.result).catch(() => null))?.pressed ? 'pressed' : 'refused')
      : await run(tab, frameId, pressRegister, [answer.control]);
    decide('fill', `closer look: pressed (${result})`, {tab: tab.id});
    if (result === 'pressed') {   // did the page move on? then the app remembers this click for the page shape
      await new Promise(resolve => setTimeout(resolve, 3000));
      const after = await sketchOf(tab.id, frameId);
      const worked = !!after && JSON.stringify([after.controls.map(item => item.label), after.buttons]) !== JSON.stringify([sketch.controls.map(item => item.label), sketch.buttons]);
      apiFor(tab.id, config, '/extension/escalate', {method: 'POST', body: JSON.stringify({url, feedback: {kind, action: 'click', control: answer.control, worked}})}).catch(() => {});
    }
  }
  // fill: the app resolved the value from the person's contact details (never logged, never sent to the model); choose: one of the dropdown's own options. Both only when the app allowed them (full).
  if ((action === 'fill' && answer.control && answer.value) || (action === 'choose' && answer.control && answer.option)) {
    const result = action === 'fill' ? await run(tab, frameId, fillControl, [answer.control, answer.value]) : await run(tab, frameId, chooseOption, [answer.control, answer.option]);
    decide('fill', `closer look: ${action} (${result})`, {detail: answer.detail || '', ...(action === 'choose' ? {option: String(answer.option).slice(0, 40)} : {})});
    if (result === 'filled' || result === 'chosen') apiFor(tab.id, config, '/extension/escalate', {method: 'POST', body: JSON.stringify({url, feedback: {action, control: answer.control, detail: answer.detail, option: answer.option, worked: true}})}).catch(() => {});
  }
  return action;
}

// The live test (desktop/e2e/lib/apply-live.mjs) reaches the worker only through its evaluate(), where import() is not allowed: it calls this. Not reachable from any page.
globalThis.__jobPilottoCloserLook = closerLook;
