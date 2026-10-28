// Job: wait on state (e2e reliability design rule B): wait for a line the app logs when something is over, never for a clock; the cap only catches a hang.
import {appLogText} from './app-log.mjs';

/** Waits until every app start in `profile`'s log has `done` logged after it (as many `done` lines as `[app] start ` lines); throws after `capMs` (a hang), naming `what`. */
export async function waitForLogLine(profile, done, {what = done.source, capMs = 90000} = {}) {
  const settled = () => { const log = appLogText(profile); return (log.match(done) || []).length >= (log.match(/\[app\] start /g) || []).length; };
  for (const stop = Date.now() + capMs; !settled(); await new Promise(next => setTimeout(next, 250))) if (Date.now() > stop) throw new Error(`${what} never finished (no "${done.source}" in the app's log)`);
}
