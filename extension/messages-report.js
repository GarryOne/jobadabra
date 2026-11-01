// The worker's side of "Report this form" (spec docs/superpowers/specs/2026-10-16-report-from-the-trace.md): owns the one form trace (trace.js) that every application tab keeps while the Settings switch
// is on, starts it when a tab the app opened begins to load, and answers the panel flag's messages: report-state (is it drawn, is there a trace, did the tab move past its first page) and report-send
// (hand the trace in memory to the app at once, POST /extension/report-form: the app scrubs it and answers with counts; report-confirm / report-cancel send or drop it). No reload and no new recording. The trace is dropped when the
// tab closes; Stop only stops recording and keeps what was recorded, so Report still sends it. A message counts only from a tab the app opened (the debugger attach checks it too). A FLOW FILE (docs/flows/applying.md). Guard: desktop/test/report-panel.test.js.
import {createTrace} from './trace.js';
import {api, settings} from './flow.js';
import {isStopped, onStopped} from './stop.js';
import {sessionGet} from './tab-memory.js';

const ROUTE = '/extension/report-form';
const FILL_MARK = 'jobpilotto-fill';
const STATE_TTL_MS = 30e3;
// Any frame of the tab holding a password field: a sign-in page is never kept.
// Why a call to the app failed, as the panel's kinds: no answer at all (the app is closed or the connection broke) is "app"; an answer that is an error is not (the app is open).
export const failureOf = error => ({refused: !error?.status ? 'app' : error.status === 401 ? 'connect' : error.status === 404 ? 'old' : 'failed'});
const passwordIn = async tabId => (await chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: () => !!document.querySelector('input[type="password" i]')})).some(frame => frame.result);

export function createReportMessages() {
  // -> the app's answer, or {ok: false, refused: <kind>} when the call itself failed (failureOf)
  const tell = async (payload, tabId) => api(await settings(), ROUTE, {method: 'POST', body: JSON.stringify(payload)}, true, tabId).catch(error => ({ok: false, ...failureOf(error)}));
  let switchState = {at: 0, on: false, problem: ''};   // the app's Settings switch, asked at most every 30 s; problem: why it could not be asked
  const switchOn = async tabId => {
    if (Date.now() - switchState.at < STATE_TTL_MS) return switchState.on;
    const answer = await tell({action: 'state'}, tabId);
    switchState = {at: answer?.refused ? 0 : Date.now(), on: !!answer?.enabled, problem: answer?.refused || ''};   // a failed ask is asked again at the next press
    return switchState.on;
  };
  const trace = createTrace({chrome, hasPassword: passwordIn, enabled: () => switchOn()});
  onStopped(() => { trace.haltAll(); });   // a Stop ends the recording and releases the debugger but KEEPS what was recorded: Report after a Stop sends it (owner, 19 Oct 2026)

  // An application tab starts its trace as it begins to load (the posting's own answer is the first thing kept), and again at its commit in case the tab was not armed yet.
  const armedOrMarked = async (tabId, url) => String(url || '').includes(`#${FILL_MARK}`) || !!(await sessionGet(`armed:${tabId}`))[`armed:${tabId}`];
  chrome.webNavigation.onBeforeNavigate.addListener(async details => {
    if (details.frameId !== 0 || isStopped()) return;
    if (await armedOrMarked(details.tabId, details.url)) { await trace.navigating(details.tabId); trace.start(details.tabId).catch(() => {}); }
  });
  chrome.webNavigation.onCommitted.addListener(async details => {
    if (details.frameId !== 0 || trace.isTracing(details.tabId) || isStopped()) return;
    if (await armedOrMarked(details.tabId, details.url)) trace.start(details.tabId).catch(() => {});
  });
  chrome.tabs.onRemoved.addListener(tabId => { trace.end(tabId); });
  chrome.debugger.onDetach.addListener(source => { if (source.tabId !== undefined) trace.detached(source.tabId); });

  return function messages_report(message, sender, reply) {
    const tabId = sender?.tab?.id;
    if (!['report-state', 'report-send', 'report-confirm', 'report-cancel'].includes(message?.type) || tabId === undefined) return undefined;
    (async () => {
      if (message.type === 'report-state') {
        switchState.at = 0;   // the panel asking is a page load: look at the switch again
        const on = await switchOn(tabId);
        if (!on && !switchState.problem) trace.end(tabId);   // off in Settings drops the trace; an app that did not answer does not
        return {enabled: on, problem: switchState.problem, tracing: trace.isTracing(tabId), has: trace.has(tabId), moved: trace.pageCount(tabId) > 1, stopped: isStopped()};
      }
      // report-send: the trace as it is now, handed to the app, which scrubs it, holds it and answers with counts for the popup; report-confirm sends what it holds (with the person's note); report-cancel drops it
      if (message.type === 'report-confirm') { const answer = await tell({action: 'send', note: String(message.note || '').slice(0, 300)}, tabId); return answer?.ok ? {ok: true} : {ok: false, refused: answer?.refused, blocked: answer?.blocked, error: answer?.error}; }
      if (message.type === 'report-cancel') { await tell({action: 'cancel'}, tabId); return {ok: true}; }
      const result = trace.snapshot(tabId, 'journey');
      if (!result.ok) return result;
      const answer = await tell({action: 'submit', entries: result.entries, truncated: result.truncated}, tabId);
      return answer?.ok ? {ok: true, preview: answer.preview} : {ok: false, refused: answer?.refused, blocked: answer?.blocked};
    })().then(reply, () => reply({ok: false, refused: 'error'}));
    return true;   // the answer comes later
  };
}
