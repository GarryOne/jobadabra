// Names where the time of a slow extension request went: when it arrived, when it ended, and how long its AI calls waited for a CLI slot versus ran.
// Why (31 Oct 2026, a8, owner "Evidence first"; nightly run 41162490590): the first page-kind answer of a form tab came 106 s after the tab opened and the app's log
// has only the line written AFTER the judgment, so nothing says whether the request waited for a CLI slot, ran 100 s, or arrived late. Logging only: no decision,
// no limiter, no deadline changes here. A request under SLOW_MS writes nothing (the extension asks the app many times a second).
// Why (#2608, a8, 1 Nov 2026): in applyflows reds the extension's calls to the app stalled 22-38 s while the app's 16 s timer ran on time and no handler was slow
// (41262512109, 41263356357), so the wait is before the handler. The finish line now also says how long a fresh connection waited from accept to handler start and
// which /extension/* routes held the other connections then (Chrome allows 6 per host: a hypothesis this line proves or refutes). Route and timings only.
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
 * The open connections of the app's local server and the /extension/* requests running on them, for the slow-request line.
 * `opened(socket, at)` is called for each accepted connection (server.on('connection')); a socket's first request reads its accept-to-handler wait.
 */
export function createConnections() {
  const sockets = new Map();   // socket → {acceptedAt, requests}
  const running = new Map();   // request id → route
  return {
    opened(socket, at = Date.now()) {
      if (!socket || sockets.has(socket)) return;
      sockets.set(socket, {acceptedAt: at, requests: 0});
      socket.once?.('close', () => sockets.delete(socket));
    },
    /** -> {waitMs (null on a reused connection or one never seen), conns, held: 'route:n,…'} as of now; call before `start`. */
    look(socket, at) {
      const seen = sockets.get(socket), first = seen && seen.requests++ === 0;
      const byRoute = {};
      for (const route of running.values()) byRoute[route] = (byRoute[route] || 0) + 1;
      const held = Object.entries(byRoute).sort(([a], [b]) => a.localeCompare(b)).slice(0, 8).map(([route, n]) => `${route}:${n}`).join(',') || 'none';
      return {waitMs: first ? at - seen.acceptedAt : null, conns: sockets.size, held};
    },
    start(id, route) { running.set(id, route); },
    end(id) { running.delete(id); },
  };
}
const shared = createConnections();
/** Tell the slow-request line about a connection the moment the server accepts it. */
export const noteConnection = (socket, at) => shared.opened(socket, at);

/**
 * Run `handle(req, res)` as one timed extension request. A request still open after SLOW_MS writes "phase=open" once; a request that took SLOW_MS or more
 * writes "phase=finish" when its response closes, with the AI limiter wait and run time of the calls it made. A fresh connection whose request reached the handler
 * SLOW_MS or more after the accept writes it too (accept_wait_ms, handler_ms, the open connections and the routes holding them). Invariant: never throws into or delays the handler.
 * `log(area, text)`; `now`, `after`, `cancel`, `connections` are for tests.
 */
export function timed(req, res, handle, {log, now = Date.now, after = setTimeout, cancel = clearTimeout, connections = shared} = {}) {
  const id = ++nextId, began = now(), path = String(req.url || '').split('?')[0].slice(0, 80);
  const request = {queueMs: 0, runMs: 0, calls: 0};
  const seen = (() => { try { return connections.look(req.socket, began); } catch { return {waitMs: null, conns: 0, held: 'none'}; } })();   // taken before this request counts itself
  connections.start(id, path);
  const say = (phase, extra) => { try { log('ext-http', `${id} ${path} phase=${phase} elapsed_ms=${now() - began}${extra}`); } catch { /* a log that fails never fails a request */ } };
  const timer = after(() => say('open', ''), SLOW_MS);
  timer?.unref?.();
  res.once('close', () => {
    cancel(timer);
    connections.end(id);
    const handlerMs = now() - began;
    if (handlerMs >= SLOW_MS || (seen.waitMs ?? 0) >= SLOW_MS) {
      say('finish', ` ai_queue_ms=${request.queueMs} ai_run_ms=${request.runMs} ai_calls=${request.calls} accept_wait_ms=${seen.waitMs ?? '-'} handler_ms=${handlerMs} conns=${seen.conns} held=${seen.held}`);
    }
  });
  return context.run(request, () => handle(req, res));
}
