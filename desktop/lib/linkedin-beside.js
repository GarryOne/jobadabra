// LinkedIn jobs on every Find jobs, PR 2/3: the real seams of the step (lib/linkedin-headless.js) for this app: the owned browser, visits.runAll, the engine's list of
// searches (src.desktop linkedin-searches, the strategy's own words) and the existing light scoring run. Registered once by the visits handlers (lib/search-beside.js).
// `deps` lets a test inject every seam; nothing here starts a browser until the switch is on and a Find jobs is pressed.
import {createBackgroundBrowser} from './background-browser.js';
import {linkedinStep} from './linkedin-headless.js';
import {extensionToken} from './server-env.js';
import * as pipeline from './pipeline.js';
import * as visits from './visits.js';

/** -> {step(signal, onLine), searches(), score(fits, onLine)} for withLinkedin (lib/search-beside.js). */
export function linkedinSeams(storage, {browser = null, runEngine = pipeline.run, run = visits.runAll, end = visits.done, port = Number(process.env.JOB_PILOTTO_PORT || 47111)} = {}) {
  let owned = browser;
  const searches = async () => {
    const {code, stdout} = await runEngine(storage, ['src.desktop', 'linkedin-searches']).catch(() => ({code: 1, stdout: ''}));
    try { return code === 0 ? JSON.parse(String(stdout).trim().split('\n').pop()).searches || [] : []; } catch { return []; }
  };
  const step = (signal, onLine) => linkedinStep({storage, browser: (owned ||= createBackgroundBrowser(storage)), run, end, tee: onLine, signal, searches, port, token: () => extensionToken(storage)});   // read only when the browser starts (the switch is on)
  const score = (fits, onLine) => runEngine(storage, pipeline.visitsArgs(storage, fits), onLine);
  return {step, searches, score};
}
