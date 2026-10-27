// After a reload (moved out of background.js, 13 Oct 2026, a pure move to keep that file under its size limit): put the panel back on tabs the app opened, and take it off every
// other page (Calendly, a job site you were reading). The old script's listeners die with the reload; the pill they drew does not.
import {decide} from './log.js';
import {sessionGet} from './tab-memory.js';
import {stripMark, tabArmed} from './tab-pages.js';
import {bindMark, fromOf, startJob} from './tab-identity.js';

// memoryReady: a function returning the promise of background.js's tab memory (the armed: marks of the worker before a reload); arm: background.js's.
export function createSettleOpenTabs({arm, memoryReady}) {
  return async function settleOpenTabs() {
    await memoryReady();
    const tabs = await chrome.tabs.query({}).catch(() => []);
    for (const tab of tabs) {
      if (tab.id == null || !/^https:/.test(tab.url || '')) continue;
      const key = `armed:${tab.id}`;
      const armed = tabArmed({url: tab.url, armed: (await sessionGet(key).catch(() => ({})))[key]});
      if (armed) {
        // A tab the app opened while this worker was still booting (a Chrome the app started, a worker waking): its mark event was missed, so nobody bound its session or posting;
        // its next page (the form after Apply) then had no job and no kit (e2e Windows, 14 Oct 2026). The mark in its address names both: taken now.
        if (String(tab.url).includes('#jobpilotto-fill') && !(await fromOf(tab.id))) { await startJob(tab.id, stripMark(tab.url)); await bindMark(tab.id, tab.url); }
        await arm(tab.id, 'still open'); continue;
      }
      const frames = await chrome.scripting.executeScript({target: {tabId: tab.id, allFrames: true}, func: () => {
        let removed = 0;
        window.__jobPilottoOverlay?.off();   // before the sweep: a layer removed from outside is put back while a run is on (panel-overlay.js)
        for (const id of ['jobpilotto-review-host', 'jobpilotto-progress', 'jobpilotto-note', 'jobpilotto-fill-overlay']) {
          const node = document.getElementById(id);
          if (node) { node.remove(); removed++; }
        }
        return removed;
      }}).catch(() => []);
      const removed = frames.reduce((n, frame) => n + (frame.result || 0), 0);
      if (!removed) continue;
      let host = '';
      try { host = new URL(tab.url).hostname; } catch { /* not a url */ }
      decide('panel', 'removed a panel from a page the app did not open', {host, removed});
    }
  };
}
