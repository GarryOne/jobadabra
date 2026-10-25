import {setEngineSource, engineNamed} from '../ai-name.js';
import {setCostEngine} from '../ai-cost.js';
import {chosen} from '../ai-engine-view.js';

// State more than one page changes (an imported binding is read-only, so it lives on one object).
export const shared = {
  visitsPreselect: null,   // Run again on a browser run: the sites the dialog ticks (pages/activity.js -> pages/actions.js)
  state: await window.pilot.state(),
  outdatedShown: false,
  openSessionId: null,
  xterm: null,
  xtermFit: null,
  dockOpen: false,  // "Application sessions" starts collapsed: the summary pills say what needs you, the head expands it
  termShownFor: null,
  draft: null,
  rebuildAsked: false,  // Rebuild from CV: the strategy step opens on the note + Build, not the last draft
  allJobs: [],
  logLines: [],  // the running task's lines, live
  idleSeen: true,  // nothing was running at the last check: the next log line starts a new task
  selectedRun: null,  // id of the past run picked in "Recent activity"; null = the latest
  // Job pages open in Chrome now (reported by the extension; refreshed every 2 s), plus ones just opened here.
  openedInChrome: new Set(),
  chromeStartedAt: 0,  // when "Open Chrome" last started it (the app guards the launch itself; this keeps the button on "Starting Chrome…")
  formsOpen: null,  // {known, ids}: which sessions' forms are still open in Chrome (the extension's report)
};

setEngineSource(() => engineNamed(shared.state?.settings?.aiEngine, shared.state?.settings, !!shared.state?.secrets?.ANTHROPIC_API_KEY));   // every {AI} text follows the engine the user chose (renderer/ai-name.js)
setCostEngine(() => chosen(shared.state?.settings || {}, !!shared.state?.secrets?.ANTHROPIC_API_KEY));   // AI costs show only on the user's own API key (ai-cost.js)
