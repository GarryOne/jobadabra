// The fill's record after a late retype (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, the record update, cc 13 Oct 2026). The record of a fill is sent once; a page's own
// autofill can empty a box a few seconds AFTER that (an upload's "autofill from resume"), the retype watcher (page/browser-form-fastpath.js) types it again, and the sent record still says
// "left" for a box that holds its value (or the reverse). The page tells the worker a try worked (ladder/progress.js, value_stayed); this settles the record again (rung 0: the same read of
// every control as at the end of the fill, extension/trace-settle.js) and, only when an outcome changed, writes ONE "fields (updated after a late retype)" line (fill-fields.js logFieldsLine),
// at most MAX_UPDATES a run. The pool's ending reads the later line (desktop/e2e/lib/record-sites.mjs). onUpdate gets the new trace (the run row's update, a later PR). Guard: app-core/test/record-update.test.js.
import {loggedFields, logFieldsLine} from '../fill-fields.js';
import {settleTrace} from '../trace-settle.js';

export const MAX_UPDATES = 2, QUIET_MS = 1500;   // quiet: a burst of retypes is one re-settle, after the page stopped changing
const armed = new Map();   // tabId -> {page, trace, sent, ...}: the fill whose record was sent from this tab

const outcomes = trace => loggedFields(trace).map(row => `${row.label}:${row.outcome}`).join('|');

// The run row's update (POST /extension/run with `update: <the run's id>`): the first record's body with the counts of the new trace. fields moves by what changed in the filled rows
// (the page's own count of what the fill typed stays as it was), unfilled is the required rows left.
const filledCount = trace => (trace || []).filter(row => row.outcome === 'filled').length;
export const runUpdateBody = (body, before, next, id) => ({...body, update: id, trace: next,
  fields: Math.max(0, (Number(body.fields) || 0) + filledCount(next) - filledCount(before)),
  unfilled: (next || []).filter(row => row.required && row.outcome !== 'filled').length});

// Called once the fill's record was sent. trace: the settled trace it carried; inPage(tabId, func): runs in the page's own world (flow.js).
export function armRecordUpdate(tabId, {page, trace, resumeName = '', inPage, decide, onUpdate = null, quietMs = QUIET_MS}) {
  disarmRecordUpdate(tabId);
  armed.set(tabId, {page, trace: trace || [], sent: outcomes(trace), resumeName, inPage, decide, onUpdate, quietMs, count: 0, timer: 0, resolve: null, running: false});
}
export function disarmRecordUpdate(tabId) {
  const state = armed.get(tabId);
  if (!state) return;
  clearTimeout(state.timer); state.resolve?.(false);
  armed.delete(tabId);
}

// The retype watcher typed a box again after the record was sent. -> a promise: true when the record was updated (a line written), false otherwise.
export function noteLateRetype(tabId) {
  const state = armed.get(tabId);
  if (!state || state.count >= MAX_UPDATES) return Promise.resolve(false);
  clearTimeout(state.timer); state.resolve?.(false);   // a newer retype restarts the quiet time; the earlier call is answered "not by me"
  return new Promise(resolve => {
    state.resolve = resolve;
    state.timer = setTimeout(() => { state.resolve = null; resettle(tabId, state).then(resolve, () => resolve(false)); }, state.quietMs);
  });
}

async function resettle(tabId, state) {
  if (armed.get(tabId) !== state || state.running || state.count >= MAX_UPDATES) return false;
  state.running = true;
  try {
    const ask = func => state.inPage(tabId, func).catch(() => null);
    const finalForm = await ask(() => window.__jobadabraDescribeForm?.(true));
    const gaveUp = await ask(() => window.__jobadabraRetypeGaveUp?.() || []);
    const readBack = await ask(() => window.__jobadabraReadBack?.pass() || []);
    if (armed.get(tabId) !== state) return false;   // the page was left meanwhile
    const next = settleTrace(state.trace, Array.isArray(finalForm) ? finalForm : [], Array.isArray(gaveUp) ? gaveUp : [], Array.isArray(readBack) ? readBack : [], state.resumeName);
    const now = outcomes(next);
    if (now === state.sent) return false;   // the retype put back what the record already said
    state.count += 1; state.sent = now; state.trace = next;
    logFieldsLine(state.decide, next, {page: state.page, updated: true});
    state.onUpdate?.(next);
    return true;
  } finally { state.running = false; }
}
