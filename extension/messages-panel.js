// The extension worker's messages from the page's panel (moved out of background.js, 8 Oct 2026): the job it shows, Fill, bringing the tab forward or closing it, taking over with
// Claude, the tip, tailoring a CV and opening the app. Each returns a function that answers the messages it owns and returns undefined for any other. A FLOW FILE
// (docs/flows/applying.md). Guards: the panel and review tests in desktop/test and the matrix (npm run flows).
import {NO_APP} from './flow.js';
import {plainWhy} from './ai-reply.js';
import {TIPS} from './tips-pool.js';
import {api} from './flow.js';
import {decide} from './log.js';
import {forgetAI} from './flow.js';
import {settings} from './flow.js';
import {sharedFixNote} from './tab-pages.js';
import {sharedFixes} from './tab-pages.js';
import {consider, tabReloaded} from './fill-flow.js';

export function createPanelMessages(ctx) {
  const {fillOpenedTab, jobOf, prefetch, readyHandoff, started} = ctx;
  return function messages_panel(message, sender, reply) {
    // The panel (review.js). App first: its job, its session and the state of the form, shared both ways. Without the
    // app (not open, or your own Worker) the panel still shows the form's progress and fills through your Worker.
    if (message?.type === 'panelJob' && sender.tab) {
      (async () => {
        const config = await settings();
        const app = !config.workerUrl || config.workerUrl.startsWith('http://127.0.0.1');
        try {
          const data = await prefetch(config, String(message.url || sender.tab.url).split('#')[0]).kit;  // the contact details come along
          return {connected: true, app, job: data.job || null, answers: data.kit?.answers?.length || 0, coverLetter: data.kit?.cover_letter || ''};
        } catch (error) {
          // The app answered (an error is still an answer): connected, and say what failed; only no answer is "not connected".
          return {connected: !!error.status, app, job: null, answers: 0, coverLetter: '', retry: !!error.status && error.status !== 404,
            why: !error.status ? (app ? NO_APP : plainWhy(error)) : error.status === 404 ? '' : `Connected, but this job couldn't be loaded (${plainWhy(error, '') || error.status}): trying again`};
        }
      })().then(reply, () => reply({connected: false}));
      return true;
    }
    if (message?.type === 'panelFill' && sender.tab) {
      const url = String(message.url || sender.tab.url).split('#')[0];
      started.add(sender.tab.id);
      forgetAI(sender.tab).then(() => fillOpenedTab(sender.tab, url, !!message.force, {fast: true})).then(result => reply({
        ok: !result?.error, error: result?.error || '', ineligible: !!result?.ineligible, note: result?.note || '',
        filled: result?.filled || 0, todo: (result?.todo || []).slice(0, 20), coverLetter: result?.coverLetter || '',
        sharedNote: sharedFixNote(sharedFixes(result?.operated))}));
      return true;
    }
    // The toolbar popup's "Apply on this page": only a tab the app opened (the mark in its address, or armed), never any other page. The fill runs again from the start
    // (a reload or a page that did nothing left it "started"), the panel is put back, and the answer says why when it could not.
    if (message?.type === 'applyHere' && Number.isInteger(message.tabId)) {
      (async () => {
        const tab = await chrome.tabs.get(message.tabId).catch(() => null);
        const kept = tab ? await chrome.storage.session.get([`armed:${tab.id}`, `stoppedTab:${tab.id}`]).catch(() => ({})) : {};
        const armed = tab && (kept[`armed:${tab.id}`] || kept[`stoppedTab:${tab.id}`]);   // a tab Stop cleared is still the app's: the person starts it again here (stop.js)
        if (!tab || !/^https:/.test(tab.url || '') || !(armed || tab.url.includes('#jobpilotto-fill'))) return {ok: false, why: 'This page was not opened by the Jobadabra app: press Apply in the app.'};
        tabReloaded(tab.id);   // a page whose Apply press was tried once is pressed again: this is the person asking (a reload does the same, tab-report.js)
        decide('fill', 'Apply pressed in the extension popup', {host: new URL(tab.url).hostname});
        if (await readyHandoff.takeLate(tab.id, tab.url).catch(() => false)) return {ok: true};   // a load the worker missed: the night's page first (ready-handoff.js)
        consider(tab, await jobOf(tab)).catch(() => {});
        return {ok: true};
      })().then(reply, () => reply({ok: false, why: 'Could not start here.'}));
      return true;
    }
    // The app's reload command (review.js): Chrome reports that reload as a link, not a reload, so the panel says it first (the app asked on the person's word).
    if (message?.type === 'panelReloading' && sender.tab) { tabReloaded(sender.tab.id); reply({ok: true}); return false; }
    // The app asked to see this form: its tab and window come forward (the extension knows the tab; no Mac scripting).
    if (message?.type === 'panelShowTab' && sender.tab) {
      chrome.tabs.update(sender.tab.id, {active: true})
        .then(() => chrome.windows.update(sender.tab.windowId, {focused: true}))
        .then(() => reply({ok: true}), () => reply({ok: false}));
      return true;
    }
    // "Go there" on a tab the application has moved on from: the tab the app says continues it comes forward (a tab id from the app's own answer).
    if (message?.type === 'panelGoTab' && sender.tab && Number.isInteger(message.tab)) {
      chrome.tabs.update(message.tab, {active: true})
        .then(tab => chrome.windows.update(tab.windowId, {focused: true}))
        .then(() => reply({ok: true}), () => reply({ok: false}));
      return true;
    }
    // The application was cancelled in the app: this form's tab closes.
    if (message?.type === 'panelCloseTab' && sender.tab) {
      chrome.tabs.remove(sender.tab.id).then(() => reply({ok: true}), () => reply({ok: false}));
      return true;
    }
    // "Take over with Claude": the person asks the app to start its Claude session for this application, from this page. The job is the
    // posting that led here (jobOf), the page is where Claude picks up.
    if (message?.type === 'panelTakeOver' && sender.tab) {
      (async () => {
        const job = String(await jobOf(sender.tab)).split('#')[0];
        const host = (() => { try { return new URL(sender.tab.url).hostname; } catch { return ''; } })();
        decide('panel', 'asked Claude to take over', {host});
        const data = await api(await settings(), '/extension/event', {method: 'POST', body: JSON.stringify({type: 'take-over', url: job, page: sender.tab.url.split('#')[0], host, consent: !!message.consent})});
        reply({ok: !!data?.ok});
      })().catch(() => reply({ok: false}));
      return true;
    }
    // "Always let Claude finish when I'm stuck" ticked or cleared in the panel's offer: the app keeps it as settings.claudeAuto (the same switch as Settings).
    if (message?.type === 'panelClaudeAuto' && sender.tab) {
      (async () => {
        decide('panel', 'always let Claude finish: ' + (message.on ? 'on' : 'off'), {});
        const data = await api(await settings(), '/extension/event', {method: 'POST', body: JSON.stringify({type: 'claude-auto', on: !!message.on})});
        reply({ok: !!data?.ok});
      })().catch(() => reply({ok: false}));
      return true;
    }
    // The form panel's tip line: one tip from the same pool as the app's Application sessions page, the least recently shown, for this application system and, when
    // one fits, the topic the form is at (knockout questions, tailoring, the CV).
    if (message?.type === 'panelTip') {
      (async () => {
        const host = String(message.host || ''), ats = /greenhouse\.io$/.test(host) ? 'greenhouse' : /lever\.co$/.test(host) ? 'lever' : /ashbyhq\.com$/.test(host) ? 'ashby'
          : /myworkdayjobs\.com$|workday\.com$/.test(host) ? 'workday' : /smartrecruiters\.com$/.test(host) ? 'smartrecruiters' : '';
        const {tipsSeen = []} = await chrome.storage.local.get('tipsSeen');
        const fits = TIPS.filter(tip => !tip.for && (!tip.ats || tip.ats === ats));   // a tip with an IT example is for the app, which knows the candidate
        const topical = fits.filter(tip => tip.category === message.prefer);
        const pool = topical.length ? topical : fits;
        const next = [...pool].sort((a, b) => tipsSeen.indexOf(a.id) - tipsSeen.indexOf(b.id) || (Math.random() - 0.5))[0];   // never shown first, then the oldest
        if (!next) return reply({ok: false});
        await chrome.storage.local.set({tipsSeen: [...tipsSeen.filter(id => id !== next.id), next.id].slice(-60)});
        reply({ok: true, text: next.text, evidence: next.evidence});
      })().catch(() => reply({ok: false}));
      return true;
    }
    // "Tailor my CV for this job": the person asks the app to write a CV from this job's posting; the form is filled again afterwards.
    if (message?.type === 'panelTailor' && sender.tab) {
      (async () => {
        const job = String(await jobOf(sender.tab)).split('#')[0];
        decide('panel', 'asked the app to tailor the CV', {});
        const data = await api(await settings(), '/extension/event', {method: 'POST', body: JSON.stringify({type: 'tailor-cv', url: job, page: sender.tab.url.split('#')[0]})});
        reply({ok: !!data?.ok});
      })().catch(() => reply({ok: false}));
      return true;
    }
    // "Add this job" (shown when Tailor found the job not in the list): the app reads the posting and adds it, like Jobs → Add by link.
    if (message?.type === 'panelAddJob' && sender.tab) {
      (async () => {
        const job = String(await jobOf(sender.tab)).split('#')[0];
        decide('panel', 'asked the app to add this job to the list', {});
        const data = await api(await settings(), '/extension/event', {method: 'POST', body: JSON.stringify({type: 'add-job', url: job, page: sender.tab.url.split('#')[0]})});
        reply({ok: !!data?.ok});
      })().catch(() => reply({ok: false}));
      return true;
    }
    // "Review my answer" on an open written question (panel-written.js): the app's AI reads the person's text or the draft; the answer is shown, never typed (worker/src/written-answer.js).
    if (message?.type === 'panelReviewAnswer' && sender.tab) {
      (async () => {
        const job = String(await jobOf(sender.tab)).split('#')[0];
        decide('panel', 'asked for a review of one written answer', {});
        const data = await api(await settings(), '/extension/review-answer', {method: 'POST', body: JSON.stringify({url: job, question: String(message.question || '').slice(0, 600), text: String(message.text || '').slice(0, 6000)})});
        reply(data?.error || !data ? {ok: false, error: data?.error || ''} : {ok: true, ...data});
      })().catch(() => reply({ok: false}));
      return true;
    }
    if (message?.type === 'panelOpenApp') {
      settings().then(config => api(config, '/extension/open', {method: 'POST', body: JSON.stringify({session: message.session})}))
        .then(data => reply({ok: !!data.ok}), () => reply({ok: false}));
      return true;
    }
    // The form page's ring (review.js): what's left there, to the app's session page; back: what to watch and show.
    return undefined;   // not one of this group's messages: the next group looks
  };
}
