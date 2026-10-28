// One lasting CDP connection to a tab of the app's own hidden browser, shaped like a Playwright CDPSession ({send, on, detach}) so the live view's
// core (hosted/ready-fill/live.mjs attachLive) runs on it unchanged. Loopback only. Guard: test/cdp-session.test.js.

/** Open a CDP session on a loopback page socket. send(method, params) -> result (rejects on a protocol error or a closed socket). */
export async function openCdpSession(socketUrl, {WebSocketClass = globalThis.WebSocket, timeout = 5000} = {}) {
  const url = new URL(socketUrl);
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Browser debugging address is not loopback.');
  const socket = new WebSocketClass(socketUrl), waiting = new Map(), listeners = new Map();
  let nextId = 0, closed = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned browser did not answer.')), timeout);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Owned browser connection failed.')); });
  });
  socket.addEventListener('message', event => {
    let row; try { row = JSON.parse(String(event.data)); } catch { return; }
    if (row.id && waiting.has(row.id)) {
      const {resolve, reject} = waiting.get(row.id); waiting.delete(row.id);
      return row.error ? reject(new Error(`Owned browser refused ${row.error.message || 'a command'}.`)) : resolve(row.result || {});
    }
    for (const fn of listeners.get(row.method) || []) fn(row.params || {});
  });
  socket.addEventListener('close', () => { closed = true; for (const {reject} of waiting.values()) reject(new Error('Owned browser connection closed.')); waiting.clear(); });
  return {
    send(method, params = {}) {
      if (closed) return Promise.reject(new Error('Owned browser connection closed.'));
      const id = ++nextId;
      return new Promise((resolve, reject) => { waiting.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params})); });
    },
    on(event, fn) { listeners.set(event, [...(listeners.get(event) || []), fn]); },
    async detach() { closed = true; socket.close(); },
  };
}
