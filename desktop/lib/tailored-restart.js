// When a CV tailored for a job is ready, that job's open form starts again from the top, so the tailored CV goes in from the first field instead of being swapped in
// mid-fill (owner, 27 Oct 2026: "I don't think the extension is that smart to adapt on the fly and replace the general CV with the tailored one, once it got tailored").
// Called by cv-handlers.js after the session page's Tailor finishes. Guard: desktop/test/tailored-restart.test.js.
import * as review from './review.js';
import * as terminals from './terminals.js';
import {forUrl} from './cv.js';

/**
 * Ask every live form tab of one job to reload: its fill mark fills the form again from the start, now with the tailored CV (review.queueReload, the same restart a second Apply press uses).
 * @param {object} storage the app's data folder (reads the tailored CVs)
 * @param {string} code the job's code, whose CV was just tailored
 * @param {object} [seams] tests replace the session list, the tab check, the reload and the CV lookup
 * @returns {string[]} the session ids asked to reload (none when no form of that job is open)
 */
export function restartFormsOf(storage, code, {sessions = terminals.list(), tabOpen = review.tabOpen, reload = review.queueReload, tailoredFor = url => forUrl(storage, url)?.job?.code} = {}) {
  if (!code) return [];
  // Why (27 Oct 2026): only a form still open in Chrome and not stopped: a submitted, closed or stopped form is the person's, never refilled behind their back.
  const ids = sessions.filter(session => session.kind === 'form' && !session.outcome && session.stuck !== 'stopped' && tabOpen(session.id) === true && String(tailoredFor(session.url) || '') === String(code))
    .map(session => session.id);
  for (const id of ids) reload(id);
  return ids;
}
