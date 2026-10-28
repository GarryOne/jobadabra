// The iframes of a hidden-browser tab that run in their own process (another site's form inside the page), each with its own CDP session, for the live view's facts.
// Loopback only: the tab's address names the browser's own debugging port. Guard: test/frame-targets.test.js.
import {openCdpSession} from './cdp-session.js';

/**
 * Sessions on the iframe targets whose parent is the tab at `address` (ws://127.0.0.1:<port>/devtools/page/<id>). list() asks the browser which ones exist now, opens the new
 * ones and drops the gone; close() detaches all. -> {list: async () => [{id, cdp}], close}. A browser that cannot be asked lists none (the page's own frames are still read).
 * Why (2026-10-28, Gitar on #2354): with site isolation on, the page's CDP session cannot see another site's iframe; the browser lists it as its own target with this tab as parent.
 */
export function openFrameTargets(address, openCdp = openCdpSession, fetchJson = async url => (await fetch(url)).json()) {
  const open = new Map();   // target id -> its session
  let url = null;
  try { url = new URL(address); } catch { /* not an address: no frames are listed */ }
  const pageId = url?.pathname.split('/').pop();
  const drop = async id => { const cdp = open.get(id); open.delete(id); await cdp?.detach().catch(() => {}); };
  return {
    async list() {
      if (!url) return [];
      const rows = await fetchJson(`http://${url.host}/json/list`).catch(() => []);
      const mine = (Array.isArray(rows) ? rows : []).filter(row => row.type === 'iframe' && row.parentId === pageId && typeof row.webSocketDebuggerUrl === 'string');
      for (const id of [...open.keys()]) if (!mine.some(row => row.id === id)) await drop(id);
      for (const row of mine) if (!open.has(row.id)) { try { open.set(row.id, await openCdp(row.webSocketDebuggerUrl)); } catch { /* not readable: skipped until it is */ } }
      return [...open].map(([id, cdp]) => ({id, cdp}));
    },
    async close() { for (const id of [...open.keys()]) await drop(id); },
  };
}
