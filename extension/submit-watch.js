// Did the person submit? (moved out of background.js, 8 Oct 2026): the submit press starts a short watch; a redirect or a change on the same page is read by the app, which decides
// if it is the site's confirmation. The address alone is not a submission, and a press that leaves the page unchanged is not one either. A FLOW FILE (docs/flows/applying.md).
// Guards: the confirmation, submit-outcome and tab-pages tests in desktop/test and the e2e row "the person submits a form" (npm run flows).
import {backgroundContext, backgroundChallenge, setBackgroundWatcher} from './background-apply.js';
import {plainWhy} from './ai-reply.js';
import {KEY} from './tab-identity.js';
import {LATE_CONFIRMATION_MS} from './tab-pages.js';
import {SUBMIT_WAIT_MS} from './tab-pages.js';
import {accountOutcomePending} from './account-step.js';
import {apiFor} from './flow.js';
import {confirmationOf} from './tab-pages.js';
import {decide} from './log.js';
import {forJob} from './tab-pages.js';
import {missedConfirmation} from './tab-pages.js';
import {pageFingerprint} from './tab-pages.js';
import {pageKey} from './tab-pages.js';
import {sessionGet} from './tab-memory.js';
import {settings} from './flow.js';
import {submissionOutcome} from './tab-pages.js';
import {tabArmed} from './tab-pages.js';

export function createSubmitWatch(ctx) {
  const {note} = ctx;
  // Submitted? The submit press starts a short watch. A redirect or a change on the same page (a confirmation
  // message where the form was) is then read by the app. The address alone is not a submission, and a press
  // that leaves the page unchanged is not one either.
  const loggedMiss = new Set();
  const watching = new Map(); // tab id -> the submit press (its timestamp) this watch belongs to
  const ASK_LIMIT = 2;
  function logOnce(tabId, text, fields) {
    const key = `${tabId}:${text}:${fields.host || ''}/${fields.path || ''}/${fields.id || ''}`;
    if (loggedMiss.has(key)) return;
    loggedMiss.add(key);
    decide('submitted?', text, fields);
  }
  async function readLandedPage(tabId) {
    const [frame] = await chrome.scripting.executeScript({target: {tabId}, func: () => {
      const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
      const headings = [...document.querySelectorAll('h1, h2')].map(el => clean(el.innerText)).filter(Boolean).slice(0, 6);
      const inputs = [...document.querySelectorAll('input, textarea, select')].filter(el => el.type !== 'hidden' && el.getClientRects().length).length;
      return {title: clean(document.title).slice(0, 180), headings, text: clean(document.body?.innerText).slice(0, 1500), inputs};
    }}).catch(() => []);
    return frame?.result || null;
  }
  async function askAboutOutcome(tabId, tab, reading, gate, pressAt) {
    const jobKey = KEY.job(tabId);
    const {[jobKey]: job} = await sessionGet(jobKey);
    if (!job) {
      logOnce(tabId, 'submit, then the page changed, no job stored on this tab: not marked', {host: gate.host, path: gate.path});
      return {done: true};
    }
    if (await accountOutcomePending(tabId)) {   // the sign-up before this page has not been judged yet: this is its next page, not an application's confirmation
      logOnce(tabId, 'submit, then the page changed: an account step is waiting for its outcome, not asking whether it confirms', {host: gate.host, path: gate.path});
      return {done: false};
    }
    decide('submitted?', `submit, then the page changed (${gate.why}): asking whether it confirms`, {host: gate.host, path: gate.path});
    try {
      const config = await settings();
      const background = await backgroundContext(tabId), submit = (await sessionGet(`submit:${tabId}`))[`submit:${tabId}`];
      if (background?.manual && submit?.automation) return {done: true};
      const verdict = await apiFor(tabId, config, '/extension/confirmation', {method: 'POST', body: JSON.stringify({
        job, page: pageKey(tab.url), title: reading?.title || '', headings: reading?.headings || [], text: reading?.text || '', inputs: reading?.inputs || 0, background: background ? {...background, attempt: submit?.automation ? submit.attempt : '', humanAt: submit?.automation ? 0 : pressAt} : null,
      })});
      if (verdict.manual) { await backgroundChallenge(tabId, verdict.reason || 'captcha_runtime'); return {done: true}; }   // words-ok: our own hand-off reason id / user-facing word, not page knowledge
      if (!verdict.confirmation) {
        decide('submitted?', verdict.error ? `page not read (${verdict.error}): not marked` : 'page is not a confirmation: not marked', {host: gate.host, path: gate.path});
        return {done: false};
      }
      if (!verdict.ok) {
        decide('submitted', `the app refused it: ${verdict.error || 'not marked'}`, {host: gate.host, path: gate.path});
        return {done: true};
      }
      await chrome.storage.session.set({[`judged:${tabId}`]: pressAt});
      await chrome.storage.session.remove(`submit:${tabId}`);
      decide('submitted', 'marked Applied', {host: gate.host, path: gate.path});
      await note(tabId, '✈️ Submitted: marked Applied in Jobadabra and Notion.', pageKey(tab.url));
      return {done: true};
    } catch (error) {
      decide('submitted', `could not reach the app: ${error.message}`, {host: gate.host, path: gate.path});
      await note(tabId, `✈️ Submitted, but Jobadabra couldn't reach the app to mark it Applied (${plainWhy(error)}). Open Jobadabra to mark it Applied.`, pageKey(tab.url));
      return {done: true};
    }
  }
  // One watch per tab. Samples the page until it changes and settles, or the wait runs out. A second sample
  // is allowed when the first read was a loading state rather than the outcome.
  async function watchSubmission(tabId) {
    const key = `submit:${tabId}`;
    let {[key]: submit, [`judged:${tabId}`]: judged} = await sessionGet([key, `judged:${tabId}`]);
    if (!submit?.at || judged === submit.at || submit.closed) return;
    if (watching.get(tabId) === submit.at) return;
    const pressAt = submit.at;
    watching.set(tabId, pressAt);
    try {
      const armedKey = `armed:${tabId}`;
      let last = submit.fingerprint;
      let stableSince = Date.now();
      let calls = submit.calls || 0;
      const deadline = pressAt + SUBMIT_WAIT_MS;
      // Sleep only until the deadline, then take that sample. A sample a few milliseconds later would be
      // "too old" and would skip both the read and the "page unchanged" line.
      while (calls < ASK_LIMIT && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
        const fresh = await sessionGet([key, `judged:${tabId}`]);
        submit = fresh[key];
        if (submit?.at !== pressAt || fresh[`judged:${tabId}`] === pressAt) return; // a newer press, or already marked
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab?.url || !/^https:/.test(tab.url)) return;
        const {[armedKey]: armed} = await sessionGet(armedKey);
        if (!tabArmed({url: tab.url, armed})) return;
        const reading = await readLandedPage(tabId);
        const after = pageFingerprint(reading || {});
        if (after !== last) { last = after; stableSince = Date.now(); }
        const now = Math.min(Date.now(), deadline);
        const gate = submissionOutcome({
          at: pressAt, now, from: submit.url, to: tab.url, before: submit.fingerprint, after, stableFor: now - stableSince,
        });
        if (gate.why === 'unchanged') {
          await chrome.storage.session.set({[key]: {...submit, closed: true}});
          await backgroundChallenge(tabId, 'submission_outcome_unknown');
          logOnce(tabId, 'submit, page unchanged: not marked', {host: gate.host, path: gate.path});
          return;
        }
        // A blank document mid-navigation is not the outcome. Wait for content, unless this is the last sample.
        const blank = !reading || (!reading.title && !reading.text && !(reading.headings || []).length);
        if (!gate.ask || (blank && now < deadline)) continue;
        calls += 1;
        submit = {...submit, fingerprint: after, calls, ...(calls >= ASK_LIMIT ? {closed: true} : {})};
        await chrome.storage.session.set({[key]: submit});
        const result = await askAboutOutcome(tabId, tab, reading, gate, pressAt);
        if (!result.done && calls >= ASK_LIMIT) await backgroundChallenge(tabId, 'submission_outcome_unknown');
        if (result.done) {
          const latest = await sessionGet(key);
          if (latest[key]?.at === pressAt) await chrome.storage.session.set({[key]: {...latest[key], closed: true}});
          return;
        }
        stableSince = Date.now();
      }
    } finally {
      if (watching.get(tabId) === pressAt) watching.delete(tabId);
    }
  }
  async function onTabSettled(tabId, tab) {
    if (!tab?.url || !/^https:/.test(tab.url)) return;
    const armedKey = `armed:${tabId}`;
    const stored = await sessionGet([KEY.job(tabId), `submit:${tabId}`, `judged:${tabId}`, armedKey]);
    if (!tabArmed({url: tab.url, armed: stored[armedKey]})) return;
    const submit = stored[`submit:${tabId}`];
    if (submit?.automation && (await backgroundContext(tabId))?.manual) return;
    if (submit?.at && !submit.closed && stored[`judged:${tabId}`] !== submit.at && Date.now() - submit.at < SUBMIT_WAIT_MS) {
      watchSubmission(tabId);
      return;
    }
    const job = stored[KEY.job(tabId)];
    // The watch gave up on a page that did not change in time, then the site's confirmation page arrived: read it now.
    const page = confirmationOf(tab.url);
    if (page && submit?.at && stored[`judged:${tabId}`] !== submit.at && Date.now() - submit.at < LATE_CONFIRMATION_MS && forJob(tab.url, job)) {
      const gate = {host: page.host, path: page.path, why: 'late confirmation'};
      const result = await askAboutOutcome(tabId, tab, await readLandedPage(tabId), gate, submit.at);
      if (result.done) await chrome.storage.session.set({[`submit:${tabId}`]: {...submit, closed: true}});
      return;
    }
    const miss = missedConfirmation({url: tab.url, job});
    if (miss) logOnce(tabId, miss.text, miss.fields);
    else if (!submit?.at && job && confirmationOf(tab.url)) logOnce(tabId, 'no submit press before this page: not marked', {host: confirmationOf(tab.url).host, path: confirmationOf(tab.url).path});
  }
  setBackgroundWatcher(watchSubmission);
  return {watchSubmission, onTabSettled};
}
