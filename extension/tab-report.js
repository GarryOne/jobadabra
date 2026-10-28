// Telling the app which tabs are open (moved out of background.js, 8 Oct 2026): the report of open job and form tabs (the app's "Opened in Chrome" and "form closed"), every 30 s
// and when a tab changes, the badge that says whether the app is reachable, and looking at an armed page that finished loading before anything looked at it. A FLOW FILE
// (docs/flows/applying.md). Guards: the tab-pages, forms-open and tab-memory tests in desktop/test and the matrix (npm run flows).
import {IDENTITY_KEYS} from './tab-identity.js';
import {JOB_SITES} from './flow.js';
import {NOT_CONNECTED} from './flow.js';
import {NO_APP} from './flow.js';
import {api} from './flow.js';
import {autoRead} from './visit.js';
import {consider, tabReloaded} from './fill-flow.js';
import {decide} from './log.js';
import {ensureAlarm} from './report-alarm.js';
import {fillKey} from './fill-flow.js';
import {neverForm} from './tab-pages.js';
import {readTabs} from './tab-pages.js';
import {readingNow} from './visit.js';
import {reportedIds} from './tab-pages.js';
import {sessionGet} from './tab-memory.js';
import {settings} from './flow.js';
import {stopFromApp} from './stop.js';
import {pollBackgroundApply} from './background-apply.js';
import {mayReloadSelf} from './self-reload.js';

// This browser (one Chrome profile), the same across its restarts, unlike `boot`: the app keeps each browser's tabs apart, so a second
// profile or a test Chrome with this extension never makes this one's forms look closed (8 Oct 2026). A random id, nothing about you.
let browserKept = null;
const browserId = () => (browserKept ||= chrome.storage.local.get('browserId').then(async ({browserId: kept}) => {
  if (kept) return String(kept);
  const made = crypto.randomUUID();
  await chrome.storage.local.set({browserId: made});
  return made;
}).catch(() => ''));

export function createTabReport(ctx) {
  const {WORKER, armedLogged, bootId, fillsNow, jobOf, keepMemory, newer, readyHandoff, reportCorrections, started} = ctx;
  // The version this copy runs: the manifest's, or the one it last reloaded itself for when that is higher. A development copy (Chrome loads the checkout's extension/) keeps the manifest's
  // base version ("0.9") while the app reports a stamped one (desktop/lib/server-env.js latestExtension); after the reload it must not look stale (15 Oct 2026: a pulled change never reached it).
  const runningVersion = async () => {
    const manifest = chrome.runtime.getManifest().version, {reloadedFor} = await chrome.storage.local.get('reloadedFor');
    return reloadedFor && newer(reloadedFor, manifest) ? reloadedFor : manifest;
  };
  // Tell the Jobadabra app which job pages are open, so its Jobs list shows "Opened in Chrome" only while they are.
  async function reportTabs() {
    const config = await settings();
    if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return;  // your own Worker: no app here
    const open = await chrome.tabs.query({url: JOB_SITES});
    const urls = open.map(tab => tab.url);
    const stored = await sessionGet(null).catch(() => ({}));
    const armedIds = Object.keys(stored).filter(key => key.startsWith('armed:') && stored[key]).map(key => Number(key.slice(6))).filter(Number.isInteger);
    const every = await chrome.tabs.query({});
    // Read sites: the tabs reading a site, by ticket, so the app sees each one open and notices one you closed (as for a form tab).
    const kept = Object.fromEntries(Object.keys(stored).filter(key => key.startsWith('read:')).map(key => [Number(key.slice(5)), stored[key]]));
    const {reading, mark} = readTabs(every, kept);
    if (Object.keys(mark).length) await chrome.storage.session.set(Object.fromEntries(Object.entries(mark).map(([id, ticket]) => [`read:${id}`, ticket]))).catch(() => {});
    const ids = reportedIds({jobSiteIds: open.map(tab => tab.id), armedIds: [...armedIds, ...Object.values(reading)], existingIds: every.map(tab => tab.id)});
    for (const id of armedIds) reportCorrections(config, id);
    // Which tabs exist (ids), and which browser run they belong to: Chrome numbers tabs again after a restart.
    const boot = await bootId(), browser = await browserId();
    // Doubles as the connection check (reconnecting by itself, see api()): a red ! on the icon while it fails.
    try {
      // Which session each open tab belongs to, from the tabs' own memory: the app binds a session to its tab from this alone, so it never
      // has to guess by address (a restarted app, a form on another site than the posting).
      const alive = new Set(every.map(tab => tab.id));
      const sessions = Object.fromEntries(Object.entries(stored).filter(([key, id]) => /^session:\d+$/.test(key) && id && alive.has(Number(key.slice(8))))
        .map(([key, id]) => [key.slice(8), String(id)]));
      const running = await runningVersion();
      const answer = await api(config, '/extension/tabs', {method: 'POST', body: JSON.stringify({urls, ids, boot, browser, worker: WORKER, reading, sessions, version: running})});
      connected(true);
      await pollBackgroundApply(config);
      await chrome.storage.local.set({appBuild: answer?.build ? {...answer.build, version: running} : null}).catch(() => {});   // what the panel shows: the commit this copy runs, and the fixes it lacks (desktop/lib/build-state.js)
      await stopFromApp(answer);   // the app's Stop button reaches a tab with no panel too (stop.js)
      // Sites this extension was reading before it started again (a reload, an update, Chrome stopping its worker): read again from where each
      // tab is, under the mark it was opened with (desktop/lib/visits.js noteTabs; 7 Oct 2026: a reload left 3 of 5 sites "stopped answering").
      for (const {tab, ticket, mark} of Array.isArray(answer?.reread) ? answer.reread : []) {
        const open = await chrome.tabs.get(Number(tab)).catch(() => null);
        if (open?.url && /^https?:/.test(open.url) && /^jp-(read(-filter)?|posting)$/.test(String(mark)) && /^[a-z0-9]{4,16}$/.test(String(ticket))) {
          autoRead(open.id, `${open.url.split('#')[0]}#${mark}-${ticket}`);
        }
      }
      // The app has a newer copy of this extension (its folder was updated): load it. Once per version, so a copy
      // that can't update (a store install) doesn't reload over and over.
      // Never while a form is being filled (fillsNow) or a site is being read: a reload ends every reading at once (7 Oct 2026: an update landed mid-run and a site died); the next
      // report after the last one ends does it.
      // Why (2026-10-28, e2e proof of Background automation): the hidden browser's copy never reloads (extension/self-reload.js): Chrome disables a reloaded unpacked extension there.
      const {reloadedFor} = await chrome.storage.local.get('reloadedFor');
      if (mayReloadSelf({latest: answer?.latest, running, reloadedFor, busy: readingNow() || fillsNow.size > 0, owned: globalThis.__jobPilottoBackgroundOwned === true, newer})) {
        await chrome.storage.local.set({reloadedFor: answer.latest});
        await keepMemory().catch(() => {});   // the newest copy of the tabs' memory: the tabs outlive the reload (extension/tab-memory.js)
        await decide('worker', `reloading for version ${answer.latest}`);
        chrome.runtime.reload();
      }
    } catch (error) {
      connected(false, error.status ? NOT_CONNECTED : NO_APP);
    }
  }

  // The panel asks which build this copy is (extension/review.js foot) and can ask it to load the newer copy the app already has.
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type === 'panelBuild' && sender.tab) { chrome.storage.local.get('appBuild').then(({appBuild}) => reply(appBuild || null), () => reply(null)); return true; }
    if (message?.type === 'panelReload' && sender.tab) {
      if (!mayReloadSelf({panel: true, owned: globalThis.__jobPilottoBackgroundOwned === true})) { reply({ok: false}); return false; }   // the hidden browser's copy never reloads (extension/self-reload.js)
      keepMemory().catch(() => {}).then(() => { reply({ok: true}); chrome.runtime.reload(); }); return true; }
    return undefined;
  });

  function connected(ok, why = '') {
    chrome.action.setBadgeText({text: ok ? '' : '!'}).catch(() => {});
    chrome.action.setTitle({title: ok ? 'Jobadabra' : `Jobadabra: ${why}`}).catch(() => {});
  }
  // A closed tab's id comes back for another tab: forget everything kept for it, so no fill and no submitted-check is
  // ever carried over to whatever opens next (tab-pages.js).
  // A refresh the person pressed is a new document: its page is looked at again (one fill per document, not one per page for the life of the tab; owner, 9 Oct 2026).
  chrome.webNavigation.onCommitted.addListener(details => {
    if (details.frameId !== 0 || details.transitionType !== 'reload') return;
    tabReloaded(details.tabId);
  });
  chrome.tabs.onRemoved.addListener(async tabId => {
    reportTabs();  // the app's session page learns that a form tab was closed without waiting for the 30 s report
    await chrome.storage.session.remove([...IDENTITY_KEYS(tabId), `role:${tabId}`, `armed:${tabId}`, `submit:${tabId}`, `judged:${tabId}`, `read:${tabId}`]).catch(() => {});
    for (const mark of [...armedLogged]) if (mark.startsWith(`${tabId}:`)) armedLogged.delete(mark);
    // A closed tab's id is reused for the next tab. `started` holds that id as a number, so a string check never
    // matched it and the new tab was treated as already filled.
    for (const key of [...started]) {
      if (key === tabId || (typeof key === 'string' && key.startsWith(`${tabId} `))) started.delete(key);
    }
    reportTabs();
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url || info.status === 'complete') reportTabs(); });
  chrome.runtime.onStartup.addListener(reportTabs);
  // Also every 30 s, so an app started after the tabs were opened still learns about them. Only if it isn't there
  // already: creating an alarm that exists resets it, and this worker wakes far more often than every 30 s.
  ensureAlarm({get: name => chrome.alarms.get(name), create: (name, info) => chrome.alarms.create(name, info)});
  // Every 30 s: an armed page that finished loading and that nothing looked at (its load event came while the worker was starting, or before the tab was armed)
  // is looked at now. A page that has a fill state, or that `consider` already took, is left alone.
  async function considerMissed() {
    const stored = await sessionGet(null).catch(() => ({}));
    for (const key of Object.keys(stored).filter(name => name.startsWith('armed:') && stored[name])) {
      const tab = await chrome.tabs.get(Number(key.slice(6))).catch(() => null);
      if (!tab || tab.status !== 'complete' || !/^https:/.test(tab.url || '') || neverForm(tab.url) || started.has(tab.id) || started.has(fillKey(tab.id, tab.url))) continue;
      const [row] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => document.documentElement?.dataset.jobpilottoFill || ''}).catch(() => []);
      if (!row || row.result) continue;   // unreadable, or it already has a state
      let host = '';
      try { host = new URL(tab.url).hostname; } catch { /* not a url */ }
      decide('fill', 'a loaded page nobody had looked at: looking now', {host});
      if (await readyHandoff.takeLate(tab.id, tab.url)) continue;   // Open in my browser: the night's page first, as on a load (ready-handoff.js); that load fills it
      await consider(tab, await jobOf(tab));
    }
  }
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'report-tabs') { reportTabs(); considerMissed(); } });
  reportTabs();
  return {reportTabs, considerMissed, connected};
}
