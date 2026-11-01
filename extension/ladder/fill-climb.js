// The fill ladder's climb for controls (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, amendment 5 "same door"; PR C2), called once at the fill's end after rung 0's read
// (page/read-back.js pass, flow.js). Two jobs:
//  1. Repair, for every user (owner, 15 Oct 2026; the switch is ladder/acts.js repairActs, off only by chrome.storage repairAct: false): a control the fill had an answer for that did not keep it (the judges' sketch
//     says match "no") is checked by fill_verify, the app names a closed verb per missed control (fill_repair, at most 3), and ladder/fill-repair.js runs them with the extension's own primitives, behind the
//     floors of page/repair-act.js (a repair changes how the fill's answer goes in, never which answer). Switched off, nothing new is asked (the panel's own judge asks fill_verify in shadow, form-ready.js).
//  2. The record's last read: a box the page emptied after rung 0 read it (its own autofill after an upload) is typed again now (the fastpath's retype, within its attempt log), and
//     when that or a repair changed anything the page is read again, so the fill's record (flow.js settleTrace, read by the replays' agreement check and the pool's endings,
//     desktop/e2e/lib/ending.mjs) says what the page holds after the last action (cc, 13 Oct 2026).
// Log lines: counts and verbs only, never a label or a value. Guard: app-core/test/fill-climb.test.js.
import {apiFor} from '../flow.js';
import {attachDebugger, detachDebugger} from '../stop-state.js';
import {driving} from '../input-gap.js';
import {decide} from '../log.js';
import {sketchOf} from '../judge-sketch.js';
import {onTop} from '../on-top.js';
import {closeLayer} from '../consent.js';
import {runRepairs} from './fill-repair.js';
import {repairDoors} from './control-door.js';
import {repairActs} from './acts.js';

const inPage = (tabId, func, args = []) => chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func, args}).then(([row]) => row?.result);

// A trusted click on the tab through Chrome's debugger, attached only for the work that needs it.
async function withClicks(tabId, work) {
  const target = {tabId};
  await attachDebugger(tabId);
  try {
    const mouse = (type, x, y) => chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {type, x, y, button: 'left', clickCount: 1});
    return await work(async (x, y) => { const marked = await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func: (px, py) => globalThis.__jobPilottoSubmitPress?.markAt(px, py), args: [x, y]}).catch(() => [{result: true}]); if (marked?.[0]?.result === false) return; await driving(tabId, async () => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await mouse(type, x, y); }); });   // marked first: the extension's own press (page/submit-press.js markAt)
  } finally { await detachDebugger(tabId); }
}

// Ask, then (behind the switch) act. -> {repairs, results} or null when nothing was asked.
async function repairPage(tab, config, turn) {
  const sketch = await sketchOf(tab.id, 0, 'MAIN').catch(() => null);
  if (!sketch?.controls?.some(item => item.match === 'no')) return null;
  sketch.onTop = await inPage(tab.id, onTop).catch(() => null) || null;
  const verified = await apiFor(tab.id, config, '/extension/account-judge', {method: 'POST', body: JSON.stringify({phase: 'fill', sketch})}).catch(() => null);
  const found = await apiFor(tab.id, config, '/extension/account-judge', {method: 'POST', body: JSON.stringify({phase: 'repair', sketch, verdicts: verified?.verdicts || []})}).catch(() => null);
  if (!Array.isArray(found?.repairs) || !found.repairs.length) return null;
  const clicks = found.repairs.some(row => ['trusted_click', 'toggle'].includes(row.verb) && !row.refused);
  const run = click => runRepairs(found.repairs, {page: (func, args) => inPage(tab.id, func, args), click, closeLayer: ({want}) => closeLayer(tab.id, {want})}, sketch.onTop);
  const results = await turn(() => (clicks ? withClicks(tab.id, run) : run(async () => {}))).catch(() => []);
  for (const row of results) if (row.ok !== undefined) decide('fill', `fill: ${row.verb} on control ${row.n}`, {tab: tab.id, worked: row.ok, fp: sketch.controls[row.n - 1]?.fp || ''}).catch(() => {});   // spec "Caps and floors": the verb and the control's structural fingerprint (the CI pool's feed reads them: lib/ladder-moves.mjs repairsFromLog), never a label
  const done = results.filter(row => row.ok !== undefined).map(row => { const asked = found.repairs.find(one => one.n === row.n) || {}; return {fp: sketch.controls[row.n - 1]?.fp || '', verb: row.verb, widget: asked.widget || 'other', option: asked.option || 0, ok: !!row.ok}; }).filter(row => row.fp);
  if (done.length) apiFor(tab.id, config, '/extension/account-judge', {method: 'POST', body: JSON.stringify({phase: 'repair-result', results: done})}).catch(() => {});   // kept per fingerprint, or dropped (desktop/lib/ladder/repair-kept.js): fixed values only
  repairDoors({sketch, verdicts: verified?.verdicts, results}, decide);   // each control the check or the repair could not settle: a door record at control level (ladder/control-door.js)
  decide('fill', 'fill repair', {asked: found.repairs.length, tried: results.filter(row => row.ok !== undefined).length, worked: results.filter(row => row.ok).length}).catch(() => {});
  return {repairs: found.repairs, results};
}

// tab, config (flow.js settings(): repairAct false switches repair off), turn: the worker's one-debugger-at-a-time queue (flow.js debuggerTurn).
// -> {readBack} when the page was read again (a repair or a late retype changed something), else null: the caller keeps its first read.
export async function climbFill(tab, config, {turn = work => work()} = {}) {
  const repaired = repairActs(config) ? await repairPage(tab, config, turn).catch(() => null) : null;
  const late = await inPage(tab.id, () => window.__jobPilottoRetypeWiped?.(0) || 0).catch(() => 0);   // a box the page emptied after rung 0's read: typed again now (page/browser-form-fastpath.js)
  if (!late && !repaired?.results?.some(row => row.ok !== undefined)) return null;
  const readBack = await inPage(tab.id, () => window.__jobPilottoReadBack?.pass() || []).catch(() => null);
  if (Array.isArray(readBack)) decide('fill', 'read back again after the last action', {retyped: late, repaired: repaired?.results?.filter(row => row.ok).length || 0}).catch(() => {});
  return Array.isArray(readBack) ? {readBack} : null;
}
