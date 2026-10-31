// Names where the time of a slow extension request went: when it arrived, when it ended, and how long its AI calls waited for a CLI slot versus ran.
// Why (31 Oct 2026, a8, owner "Evidence first"; nightly run 41162490590): the first page-kind answer of a form tab came 106 s after the tab opened and the app's log
// has only the line written AFTER the judgment, so nothing says whether the request waited for a CLI slot, ran 100 s, or arrived late. Logging only: no decision,
// no limiter, no deadline changes here. A request under SLOW_MS writes nothing (the extension asks the app many times a second).
import {AsyncLocalStorage} from 'node:async_hooks';

export const SLOW_MS = 2000;
const context = new AsyncLocalStorage();
let nextId = 0;

/** Add one CLI call's wait for a slot and its run time to the extension request this async chain belongs to (none: a call outside a request counts nowhere). */
export function noteAiLimiter(queueMs, runMs) {
  const request = context.getStore();
  if (!request) return;
  request.queueMs += queueMs; request.runMs += runMs; request.calls += 1;
}

/**
 * Run `handle(req, res)` as one timed extension request. A request still open after SLOW_MS writes "phase=open" once; a request that took SLOW_MS or more
 * writes "phase=finish" when its response closes, with the AI limiter wait and run time of the calls it made. Invariant: never throws into or delays the handler.
 * `log(area, text)`; `now`, `after`, `cancel` are for tests.
 */
export function timed(req, res, handle, {log, now = Date.now, after = setTimeout, cancel = clearTimeout} = {}) {
  const id = ++nextId, began = now(), path = String(req.url || '').split('?')[0].slice(0, 80);
  const request = {queueMs: 0, runMs: 0, calls: 0};
  const say = (phase, extra) => { try { log('ext-http', `${id} ${path} phase=${phase} elapsed_ms=${now() - began}${extra}`); } catch { /* a log that fails never fails a request */ } };
  const timer = after(() => say('open', ''), SLOW_MS);
  timer?.unref?.();
  res.once('close', () => {
    cancel(timer);
    if (now() - began >= SLOW_MS) say('finish', ` ai_queue_ms=${request.queueMs} ai_run_ms=${request.runMs} ai_calls=${request.calls}`);
  });
  return context.run(request, () => handle(req, res));
}
