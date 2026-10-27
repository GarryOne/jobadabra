// The extension worker's messages about what the page learned (moved out of background.js, 8 Oct 2026): reading a job list, arming a tab, the fill's misses and the
// answers typed, the panel's focus result and allowed state, what the fill missed at Submit, the press of Submit and Fill anyway. An account page teaches nothing
// (account.js). Each returns a function that answers the messages it owns and returns undefined for any other. A FLOW FILE (docs/flows/applying.md). Guards:
// the learned-answers, submit and account tests in desktop/test and the matrix (npm run flows).
import {accountSkip} from './account.js';
import {STARTING} from './panel-start.js';
import {applyState, setApply, VERDICTS} from './apply-state.js';
import {api} from './flow.js';
import {decide} from './log.js';
import {stripMark} from './tab-pages.js';
import {identityOf} from './tab-identity.js';
import {onAccountPage} from './account.js';
import {pageFingerprint} from './tab-pages.js';
import {pageKey} from './tab-pages.js';
import {sessionGet} from './tab-memory.js';
import {startBoard} from './visit.js';
import {settings} from './flow.js';
import {submissionOutcome} from './tab-pages.js';
import {tabArmed} from './tab-pages.js';

export function createLearningMessages(ctx) {
  const {arm, fillOpenedTab, handOff, jobOf, panelRefused, reportFlow, stepBox, stepNow, watchSubmission} = ctx;
  return function messages_learning(message, sender, reply) {
    // "Read this board": the person pressed Read in the popup on a tab the app opened for it (visit.js startBoard refuses any other tab).
    if (message?.type === 'visitRead') {
      const tabId = Number(message.tabId);
      if (!Number.isInteger(tabId)) { reply({ok: false}); return false; }
      startBoard(tabId, !!message.filter).then(reply, error => reply({ok: false, error: error.message}));
      return true;
    }
    // Review in form, for a tab Claude opened (no fill mark): inject the panel. Do not fill again, and do not reload.
    if (message?.type === 'armTab') {
      const tabId = Number(message.tabId);
      if (!Number.isInteger(tabId)) { reply({ok: false}); return false; }
      arm(tabId, 'review').then(() => reply({ok: true}), () => reply({ok: false}));
      return true;
    }
    // Controls the panel could not read (their structure, never their text): kept on this Mac for learning how to operate them.
    if (message?.type === 'misses' && sender.tab && Array.isArray(message.items)) {
      (async () => {
        const config = await settings();
        if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {ok: false};
        let host = '';
        try { host = new URL(sender.tab.url).hostname; } catch { /* not a url */ }
        return api(config, '/extension/misses', {method: 'POST', body: JSON.stringify({host, items: message.items.slice(0, 10)})});
      })().then(reply, () => reply({ok: false}));
      return true;
    }
    // What you answered yourself in the form, sent at the Submit press: the app keeps it so no form asks again.
    if (message?.type === 'learned' && sender.tab && Array.isArray(message.items)) {
      (async () => {
        if (await onAccountPage(sender.tab, message.account, message.url)) { accountSkip(sender.tab, 'answers typed there are not learned'); return {ok: false, account: true}; }
        const config = await settings();
        if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {ok: false};
        let host = '';
        try { host = new URL(sender.tab.url).hostname; } catch { /* not a url */ }
        const items = message.items.slice(0, 40).map(item => ({label: String(item?.label || '').slice(0, 120), value: String(item?.value || '').slice(0, 300),
          kind: item?.kind === 'option' ? 'option' : 'text'})).filter(item => item.label && item.value);
        return api(config, '/extension/learned', {method: 'POST', body: JSON.stringify({host, job: await jobOf(sender.tab), items})});
      })().then(reply, () => reply({ok: false}));
      return true;
    }
    if (message?.type === 'focusResult' && sender.tab) {
      (async () => {
        const config = await settings();
        if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {ok: false};
        return api(config, '/extension/focus', {method: 'POST', body: JSON.stringify({
          url: sender.tab.url, title: sender.tab.title || '', found: !!message.found, job: await jobOf(sender.tab), session: (await identityOf(sender.tab)).session})});
      })().then(reply, () => reply({ok: false}));
      return true;
    }
    // The page asks the worker's state for its first draw and draws exactly that (apply-state.js); a verdict the page saw (the person must act, its own fill ended) is reported here, never decided there.
    if (message?.type === 'panelApply' && sender.tab) { const text = stepNow.get(sender.tab.id) || ''; reply({state: applyState(sender.tab.id), text}); return false; }
    if (message?.type === 'applyVerdict' && sender.tab && VERDICTS.includes(message.verdict)) { setApply(sender.tab.id, message.verdict); reply({ok: true}); return false; }
    if (message?.type === 'panelStepNow' && sender.tab) {
      const text = stepNow.get(sender.tab.id) || '';
      if (text) stepBox(sender.tab.id, '');
      reply({text, wait: text === STARTING ? 20000 : 0});   // the fill has not said its first step yet (panel-start.js)
      return false;
    }
    if (message?.type === 'panelAllowed' && sender.tab) {
      const key = `armed:${sender.tab.id}`;
      sessionGet(key).then(stored => {
        const ok = tabArmed({url: sender.tab.url, armed: stored[key]});
        if (!ok) {
          let host = '';
          try { host = new URL(sender.tab.url).hostname; } catch { /* not a url */ }
          if (!panelRefused.has(host)) {
            panelRefused.add(host);
            decide('panel', 'page was not opened by the app: panel not shown', {host});
          }
        }
        reply({ok});
      }, () => reply({ok: false}));
      return true;
    }
    // At Submit, what the fill missed (review.js noteMissed): labels and kinds only, counted per board by the app.
    if (message?.type === 'formLearning' && sender.tab) {
      const labels = list => (Array.isArray(list) ? list : []).slice(0, 30);
      const byYou = labels(message.byYou).map(item => ({label: String(item?.label || '').slice(0, 120), kind: String(item?.kind || '').slice(0, 20), unread: !!item?.unread}));
      const invalid = labels(message.invalid).map(label => String(label || '').slice(0, 120));
      const fillId = /^[\w-]{8,40}$/.test(String(message.fillId || '')) ? message.fillId : '';
      // What the fill missed teaches the form-filling data (recipes, the board's misses): never from a sign-in or sign-up page.
      onAccountPage(sender.tab, message.account, message.url).then(account => {
        if (account) { accountSkip(sender.tab, 'its fields are not counted as fill misses'); return; }
        reportFlow(sender.tab, null, {...(byYou.length ? {byYou} : {}), ...(invalid.length ? {invalid} : {}), ...(fillId ? {fillId, submitted: !!message.submitted} : {})});
      });
      reply({ok: true});
      return false;
    }
    if (message?.type === 'submitted' && sender.tab?.id != null) {
      const tabId = sender.tab.id;
      const url = pageKey(message.url || sender.tab.url || '');
      const at = Date.now();
      const fingerprint = pageFingerprint(message.snapshot || {});
      const where = submissionOutcome({at, from: url, to: url, before: fingerprint, after: fingerprint});
      // "Create account" or "Sign in" is not the application being sent: its "thanks for registering" must never mark it Applied.
      onAccountPage(sender.tab, message.account, message.url).then(account => {
        if (account) { decide('submitted', 'account page: a sign-in or sign-up press, not an application submit', {host: where.host, path: where.path}); return; }
        chrome.storage.session.set({[`submit:${tabId}`]: {at, url, fingerprint, calls: 0}}).then(() => watchSubmission(tabId)).catch(() => {});
        decide('submitted', 'submit pressed', {host: where.host, path: where.path});
      });
      reply({ok: true});
      return false;
    }
    if (message?.type === 'fillAnyway' && sender.tab) {
      fillOpenedTab(sender.tab, stripMark(sender.tab.url), true);
      reply({ok: true});
      return false;
    }
    if (message?.type === 'claudeFill' && sender.tab) {
      handOff(sender.tab, String(message.job || ''), String(message.ticket || ''));
      reply({ok: true});
      return false;
    }
    return undefined;   // not one of this group's messages: the next group looks
  };
}
