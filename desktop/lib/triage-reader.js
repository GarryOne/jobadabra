// Apply triage (spec 2026-10-30-apply-triage, PR C2a): the queue of form reads that the hidden browser's extension takes one at a time. A read is not an application: no store row, no session, no saved mode.
import {randomUUID} from 'node:crypto';
import {readFromJudge} from './triage-read.js';

export const READ_TIMEOUT_MS = 90000;

/**
 * One reader per app. `read(url)` queues a job's form read and resolves with the mode table's flags ({eligible, captcha, login, accountCreation, allFactsSaved}) or null when nothing was read.
 * Takes the extension's polls (`take`) and reports (`report`); `set`, `clear` and `uuid` are injectable so a test never waits for a clock.
 * Invariants: at most one read is handed to the extension at a time; a report for an id that is not the active one is refused; a read that gets no report in `timeoutMs` resolves null.
 */
export function createTriageReader({uuid = randomUUID, set = setTimeout, clear = clearTimeout, timeoutMs = READ_TIMEOUT_MS} = {}) {
  const waiting = new Map(), queue = [];
  let active = '';
  function finish(id, value) {
    const row = waiting.get(id);
    if (!row) return false;
    clear(row.timer);
    waiting.delete(id);
    const at = queue.findIndex(item => item.id === id);
    if (at >= 0) queue.splice(at, 1);
    if (active === id) active = '';
    row.resolve(value);
    return true;
  }
  return {
    /** Queues one job's read; resolves with the read flags, or null when the page could not be read in time. Takes the job's URL. */
    read(url) {
      const id = `tr${uuid().slice(0, 8)}`;
      const address = String(url || '');
      return new Promise(resolve => {
        waiting.set(id, {resolve, timer: set(() => finish(id, null), timeoutMs)});
        queue.push({id, url: address});
      });
    },
    /** The next queued read for the extension, or null while one is already out or none waits. Returns {id, url}. */
    take() {
      if (active || !queue.length) return null;
      const next = queue.shift();
      active = next.id;
      return next;
    },
    /** True while a read is queued or out, so a real application is never started beside it. */
    busy: () => waiting.size > 0,
    /** The extension's answer for the active read: {botCheck, loginWall, accountCreation} from the judge, or {unreadable: true} when the page never became a form. Returns false for any other id. */
    report(id, payload = {}) {
      if (!active || id !== active) return false;
      return finish(id, payload.unreadable === true ? null : readFromJudge(payload, {eligible: true}));
    },
    /** Resolves every queued and active read with null (Cancel, the app quitting). Returns how many it ended. */
    cancelAll: () => [...waiting.keys()].filter(id => finish(id, null)).length,
  };
}
