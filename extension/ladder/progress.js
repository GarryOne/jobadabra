// The run's progress (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 2 box 2: the silent dead-end rule). ONE call per observable sign that an application moved,
// fixed kinds only, logged in shadow as "progress: <kind>", so the gaps between them are measured on the CI pool and the rule's T comes from data. No detector here yet: nothing in
// this file changes what happens. Kinds: navigated (a new page in the tab), new_controls (fields or a frame appeared on a page judged without a form), required_down (a fill put a
// value in a required field), value_stayed (RESERVED for the fill ladder's attempt log, extension/page/attempts.js: its page script sends {type: 'progress', kind: 'value_stayed'};
// this file never detects a value itself, cc 12 Oct 2026). Each note also restarts the application's silence clock (ladder/silence.js, the silent dead-end rule, in shadow: its notice
// goes through the door with {shadow: true}). Guard: app-core/test/progress.test.js.
import {evidenceOf, seenDeadEnd} from './dead-end.js';
import {forgetSilence, restartSilence, silenceTab, useSilence} from './silence.js';
import {disarmRecordUpdate, noteLateRetype} from './record-update.js';

export const PROGRESS_KINDS = ['navigated', 'new_controls', 'required_down', 'value_stayed'];
export const PAGE_KINDS = ['value_stayed'];   // the only kinds a page script may send
let log = () => {};
export const useProgressLog = fn => { log = fn; };
useSilence({notice: (host, evidence, tabId) => {   // the stop is logged once the tab's address is known (the shadow question joins by door id; the tab may be gone: then it is logged without the question)
  const open = page => seenDeadEnd('silent', host, evidence, log, {tabId, page});
  Promise.resolve(globalThis.chrome?.tabs?.get(tabId)).then(tab => open(tab?.url || ''), () => open('')).catch(() => {});
}, ended: () => log('fill', 'run ended', {})});   // no page text: the line only says the application's run has nothing left to do (a test run's watch may end sooner)
const last = new Map();   // tabId -> {at, kind}
const pages = new Map();   // tabId -> the page key last considered

// noteProgress(tabId, kind, data) -> true when noted. data: fixed values of ours (evidenceOf), never page text. host: the page's, for the silence notice (a new page knows it).
export function noteProgress(tabId, kind, data = {}, now = Date.now(), host = '') {
  if (tabId == null || !PROGRESS_KINDS.includes(kind)) return false;
  const before = last.get(tabId);
  last.set(tabId, {at: now, kind});
  log('fill', `progress: ${kind}`, {tab: tabId, ...evidenceOf(data), ...(before ? {sinceMs: now - before.at} : {})});
  restartSilence(tabId, kind, {now, host});
  return true;
}
// A page the fill flow considers: a new page key for the tab is 'navigated'; the same page looked at again is not. where: {job, page}, the application the tab works on and its address.
export function notePage(tabId, key, where = {}, now = Date.now()) {
  if (pages.get(tabId) === key) return false;
  pages.set(tabId, key);
  disarmRecordUpdate(tabId);   // a new page: the record of the one before is not this tab's any more
  silenceTab(tabId, where.job);
  let host = '';
  try { host = new URL(where.page).hostname; } catch { /* no address */ }
  return noteProgress(tabId, 'navigated', {}, now, host);
}
export const lastProgress = tabId => last.get(tabId) || null;
export const forgetProgress = tabId => { last.delete(tabId); pages.delete(tabId); disarmRecordUpdate(tabId); };

// A page script's report (only PAGE_KINDS), and a closed tab forgotten. Registered here, at the worker's start; another message is left to the other handlers (no reply).
// -> a promise of true when the report made the fill's record update (ladder/record-update.js: a retype after the record was sent), else false.
export async function onPageProgress(message, sender) {
  if (message?.type !== 'progress' || sender?.tab?.id == null || !PAGE_KINDS.includes(message.kind)) return false;
  noteProgress(sender.tab.id, message.kind, {});
  return message.kind === 'value_stayed' ? noteLateRetype(sender.tab.id) : false;
}
globalThis.chrome?.runtime?.onMessage?.addListener((message, sender) => { onPageProgress(message, sender).catch(() => {}); });
globalThis.chrome?.tabs?.onRemoved?.addListener(tabId => { forgetProgress(tabId); forgetSilence(tabId); });
