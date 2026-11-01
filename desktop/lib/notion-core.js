// Notion, the shared core: the paced, retrying call(), the page-tree cache state, title helpers, the discovery search and listChildren.
// The other notion-*.js files and notion.js build on it; notion.js re-exports the public names. Pace and clock stay ONE binding here
// (useSleep / useClock set it). Guarded by desktop/test/notion-retry.test.js, notion-cache.test.js and notion.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {log} from './log.js';
import * as sharedPace from './notion-pace.js';
import * as requestLog from './request-log.js';
import {ROOT as REPO} from './root.js';   // the repo's folder only: pipeline.js would bring the engine runner and the AI client (see schema.js)

// The end-to-end tests put a Notion stand-in in between that can fail on purpose (desktop/e2e/lib/notion-proxy.mjs); honoured only in a test run.
const API = process.env.JOBADABRA_E2E && process.env.JOBADABRA_E2E_NOTION_BASE_URL ? `${process.env.JOBADABRA_E2E_NOTION_BASE_URL.replace(/\/$/, '')}/v1/` : 'https://api.notion.com/v1/';
export const TEMPLATE = JSON.parse(fs.readFileSync(path.join(REPO, 'config', 'notion_template.json'), 'utf8'));

// Notion answers 429 when a workspace sends more than ~3 requests a second (the app often reads several things at
// once) and 502/503/504 when it's briefly down: wait (its Retry-After, else 0.5, 1, 2, 4 s) and try again, so a busy
// moment never fails an unrelated read (it once left a form without your name). retries: 0 for callers that
// throttle and retry themselves (the export).
const RETRY = new Set([429, 502, 503, 504]);
let sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function useSleep(fn) { sleep = fn; }  // for tests
// The clock the pace reads (tests pass a fake one, so waits don't depend on how busy the machine is).
let clock = Date.now;
export function useClock(fn) { clock = fn || Date.now; }
// One pace for the whole app: Notion allows about 3 requests a second per integration, and fills in several tabs,
// the background polls and statistics would otherwise burst past it (429). Each call waits for its turn (spaced
// GAP_MS apart), and after a 429 every call waits out the pause Notion asked for, not only the one that got it.
// The turns are shared with the other processes on this computer that use the same connection (lib/notion-pace.js).
const GAP_MS = sharedPace.GAP_MS;
let nextSlot = 0, calmUntil = 0;
// A real connection shares its cool-down; the stand-in keeps only the individual call's retry backoff.
async function calmConnection(token, wait, pace) {
  if (sharedPace.isStandIn()) return;
  calmUntil = Math.max(calmUntil, clock() + wait);
  if (pace) await sharedPace.calmUntil(token, calmUntil);
}

async function turn(token, now = clock) {
  const shared = await sharedPace.claim(token, now);
  const at = shared ?? Math.max(nextSlot, calmUntil, now());
  if (shared === null) nextSlot = at + GAP_MS;
  const wait = Math.max(at, calmUntil) - now();
  if (wait > 0) await sleep(wait);
}
export const _pace = {reset: token => { nextSlot = 0; calmUntil = 0; if (token) fs.rmSync(sharedPace.paceFile(token), {force: true}); },
  state: () => ({nextSlot, calmUntil})};  // tests
// How many requests the app sends, logged once a minute (app.log): "[notion] last minute: 12 requests (GET blocks 9, …)".
const counted = new Map();
let countTimer = null;
function count(method, route) {
  const kind = `${method} ${route.split(/[/?]/)[0]}`;
  counted.set(kind, (counted.get(kind) || 0) + 1);
  countTimer ??= setTimeout(() => {
    const total = [...counted.values()].reduce((a, b) => a + b, 0);
    log('notion', `last minute: ${total} requests (${[...counted].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')})`);
    counted.clear();
    countTimer = null;
  }, 60_000);
  countTimer.unref?.();
}
// pace: real Notion calls take their turn; a fake fetcher (tests) runs at once unless asked.
export async function call(token, method, route, body, fetcher = globalThis.fetch, {retries = 4, pace = fetcher === globalThis.fetch} = {}) {
  for (let attempt = 0; ; attempt++) {
    if (pace) { await turn(token); count(method, route); }
    if (method !== 'GET' && !isRead(method, route)) forgetWrite(route);  // the app changed something: the page it wrote is read again, the others checked
    const started = Date.now();
    const response = await fetcher(API + route, {
      method,
      headers: {Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json'},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (pace) requestLog.write({method, route, status: response.status, ms: Date.now() - started, attempt});
    if (response.ok) return data;
    if (RETRY.has(response.status) && attempt < retries) {
      const after = Number(response.headers?.get?.('retry-after'));
      const wait = Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt, 10_000);
      if (response.status === 429) await calmConnection(token, wait, pace);
      // A retried 429 is expected (Notion's limit is shared, e.g. with a GitHub run): it's in notion-requests.log,
      // not on the terminal; only a request that finally fails is shown (the error thrown below).
      if (response.status !== 429) log('notion', `${response.status} on ${method} ${route.split('?')[0]}: retry ${attempt + 1}/${retries} in ${wait} ms`);
      await sleep(wait);
      continue;
    }
    throw Object.assign(new Error(data.message || `Notion ${response.status}`), {status: response.status});
  }
}

// Titles compared without emoji, punctuation spacing or case: "💠 Applications — Job Tracker" = "Applications — Job Tracker".
export const normalise = title => title.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
export const titleOf = item => (item.object === 'database' ? item.title : Object.values(item.properties || {})
  .find(p => p.type === 'title')?.title || []).map(t => t.plain_text).join('');

export async function searchAll(token, kind, fetcher) {
  const found = [];
  let cursor;
  do {
    const page = await call(token, 'POST', 'search', {filter: {property: 'object', value: kind}, page_size: 100,
      ...(cursor ? {start_cursor: cursor} : {})}, fetcher);
    found.push(...page.results.filter(item => !item.archived && !item.in_trash));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return found;
}


// An archived workspace (an older reset, until 16 Oct 2026, renamed its page to
// "Job Pilotto (archived 28 Sep 2026)"): still shared with the connection, but never connected to again, so
// everything inside it is left out. Renaming the page back brings it back.
// Remove when: no connected Notion still holds a workspace archived by a reset before 16 Oct 2026, not when installs update.
export const ARCHIVED = /\(archived\b[^)]*\)\s*$/i;
export function liveOnly(databases, pages) {
  const parent = new Map([...databases, ...pages].map(i => [i.id, i.parent?.page_id || i.parent?.database_id || i.parent?.block_id]));
  const archived = new Set(pages.filter(p => ARCHIVED.test(titleOf(p))).map(p => p.id));
  const inArchive = item => {
    for (let id = item.id, depth = 0; id && depth < 20; id = parent.get(id), depth++) if (archived.has(id)) return true;
    return false;
  };
  return [databases.filter(i => !inArchive(i)), pages.filter(i => !inArchive(i))];
}


// Every child block of a page or block. Notion's cursor is the id of a block: if another writer archives that block between two reads, the cursor dies ("The start_cursor
// provided is invalid", 2 Oct 2026, strategy e2e: a whole save failed). The listing then starts again from the top, a few times, instead of failing its caller.
const staleCursor = error => /start_cursor/i.test(error.message || '') && /invalid/i.test(error.message || '');
export async function listChildren(token, id, fetcher) {
  for (let attempt = 0; ; attempt++) {
    const found = [];
    let cursor;
    try {
      do {
        const page = await call(token, 'GET', `blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, null, fetcher);
        found.push(...page.results);
        cursor = page.has_more ? page.next_cursor : null;
      } while (cursor);
      return found;
    } catch (error) {
      if (!staleCursor(error) || attempt >= 3) throw error;
    }
  }
}
export const listBlocks = (token, pageId, fetcher) => listChildren(token, pageId, fetcher);

// ---- Page trees, kept in memory ----
// A page's text means opening every toggle and table inside it: 20-40 requests for the Profile. Several features
// read the same pages (contact details, standard answers, the Profile for AI calls, form knowledge), so a page's
// blocks are kept and read again only when Notion says the page changed: one cheap request for its
// last_edited_time. Notion rounds that time to the minute, so a page edited in the last 2 minutes is always read
// again. A check less than 20 s old is reused (a fill reads 3 pages at once); a write drops the page it touched and clears the
// checks; everything is read again at least every 10 minutes. Notion stays the source of truth.
export const trees = new Map();    // "token|page" -> {edited, blocks, checkedAt, readAt}
export const reading = new Map();  // reads under way, shared by everyone asking for the same page
export const CHECKED_MS = 20_000, SETTLE_MS = 120_000, MAX_AGE_MS = 10 * 60_000;
export const _trees = {reset: () => { trees.clear(); reading.clear(); }};  // tests
// A write drops the kept page it touched (the page itself, or one of its blocks at any kept depth): Notion's edit time can stay the same after it
// (17 Oct 2026: the Your details move read its own sections back from the kept page and wrote them twice). Every other kept page is checked again.
// A read under way while the app writes is not kept (it may have missed the write).
const bare = id => String(id || '').replace(/-/g, '');
const holds = (blocks, id) => (blocks || []).some(block => bare(block.id) === id || holds(block.children, id));
export const writes = {count: 0};
// Notion reads that need POST (a database query, a search) change nothing: they must not reset the kept pages' checks
// (17 Oct 2026: ~4 queries a minute made every Profile tab open pay a check per page, or a 20-40 request tree read).
const isRead = (method, route) => method === 'POST' && /^(databases\/[^/?]+\/query|search)(\?|$)/.test(route);
function forgetWrite(route) {
  writes.count++;
  const [kind, id] = route.split(/[?]/)[0].split('/'), target = ['blocks', 'pages'].includes(kind) ? bare(id) : '';
  for (const [key, tree] of trees) {
    if (target && (bare(key.split('|').pop()) === target || holds(tree.blocks, target))) trees.delete(key);
    else tree.checkedAt = 0;
  }
}
