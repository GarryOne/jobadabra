// The network recorder and replayer of a live row (spec docs/superpowers/specs/2026-10-13-replay-by-network.md): the recorder keeps every response the browser
// got (request headers and request bodies never; cookies only the kind a page script reads, see cookiesOf); the replayer serves it back by the spec's rules. Guard: e2e/test/record/net-record.test.mjs.
import fs from 'node:fs';
import {normalise} from '../../lib/ai/model-memo.js';
import {EMAIL, PHONE} from '../../lib/live-capture.js';
import {KEEP_HEADER, keepRecord, normUrl, prefetchedCode, recordable, repairUnlabeledText, sha, siteOf} from '../../lib/net-keep.js';
export {keepRecord, normUrl, prefetchedCode, recordable, repairUnlabeledText};   // the keep rules live in desktop/lib/net-keep.js (shared with the product's report)
const pathOf = url => { const u = new URL(url); return `${u.protocol}//${u.host}${normalise(u.pathname)}`; };
// The request body as a key, never the body: multipart parts by name (a file part by its bytes' hash, text normalised), a binary body by hash, text normalised.
export function bodyKey(buf, contentType = '') {
  if (!buf || !buf.length) return '';
  const boundary = /boundary=([^;]+)/i.exec(contentType)?.[1];
  if (boundary) {
    return 'multi:' + buf.toString('latin1').split(`--${boundary}`).slice(1, -1).map(part => {
      const at = part.indexOf('\r\n\r\n'), head = part.slice(0, at), body = part.slice(at + 4).replace(/\r\n$/, '');
      const name = /name="([^"]*)"/.exec(head)?.[1] || '';
      return /filename="/.test(head) ? `${name}=file:${sha(Buffer.from(body, 'latin1')).slice(0, 16)}` : `${name}=${normalise(body)}`;
    }).join('&');
  }
  if (buf.includes(0) || /octet-stream|pdf/.test(contentType)) return `bin:${sha(buf).slice(0, 16)}`;
  return `txt:${sha(normalise(buf.toString('utf8'))).slice(0, 16)}`;
}
// A header the site sent as raw UTF-8 bytes (a redirect to ".../Genève/...") reaches the recorder read as Latin-1 ("GenÃ¨ve"); the live browser read
// the bytes as UTF-8. The replay hands them back the browser's way, or it follows a double-encoded address that was never recorded (14 Oct 2026,
// Breitling: the fill never started). A value that is not valid UTF-8 that way is kept as it is. -> string
export const headerText = value => { const text = String(value ?? ''); if (!/[\u0080-\u00ff]/.test(text) || /[^\u0000-\u00ff]/.test(text)) return text;
  const utf8 = Buffer.from(text, 'latin1').toString('utf8'); return utf8.includes('\ufffd') ? text : utf8; };

// The live side. -> {flush(), settle(maxMs), result(): {entries, bodies}}
// settle: a request still in flight when the window ends is never recorded (no 'finished' or 'failed' event yet), so a press the site had not answered left the record
// stopping at a spinning button (15 Oct 2026, record-once spec). settle waits for the open ones, capped; -> {waitedMs, unfinished, kinds: {resource type: count}}.
const HOLD_MS = 1500;   // a paused reply is let go after at most this long, body or not (the page's own request never waits longer on the recorder)
export function netRecorder(context, {startedAt = Date.now(), owner = new Map()} = {}) {
  const entries = [], bodies = new Map(), t0 = new Map(), pending = new Set(), inFlight = new Set();
  context.on('request', request => { if (recordable(request.url())) { t0.set(request, Date.now()); inFlight.add(request); } });
  // A reply's body must be taken while the browser still holds it. A page that navigates away right after a reply (a form built from an answer and submitted: SuccessFactors' Apply,
  // POST /services/cas/createpayload/, 16 Oct 2026) has lost the body by the time ANY read after the load finishes (Playwright's, or a DevTools Network.getResponseBody at loadingFinished:
  // measured on a local page, 2-4 runs in 10 lost it; the early Playwright read of #1022 did not help). So an XHR or fetch reply is taken at the Fetch domain's RESPONSE stage, where the
  // browser keeps it paused until we continue it: 20 of 20 runs kept it. The rest (documents, scripts) keep the Playwright read, early then late; a body no read could get is flagged bodyLost.
  const paused = new Map(), early = new Map();   // 'METHOD url' -> [body taken at the response stage]; request -> the early Playwright read
  const holding = new Set();   // the DevTools sessions being attached: ready() waits for them
  const hold = page => { const attaching = attach(page); holding.add(attaching); attaching.finally(() => holding.delete(attaching)); return attaching; };
  const attach = async page => {
    try {
      const cdp = await context.newCDPSession(page);
      cdp.on('Fetch.requestPaused', async event => {
        const atResponse = event.responseStatusCode !== undefined || event.responseErrorReason !== undefined;   // only the response stage is asked for; a request stage would just be let go
        const type = String((event.responseHeaders || []).find(header => /^content-type$/i.test(header.name))?.value || '');
        if (atResponse && event.responseStatusCode !== undefined && recordable(event.request.url) && !/event-stream/i.test(type)) {   // an event stream is let go at once, unread: it never ends
          try {
            // getResponseBody waits for the WHOLE body: a reply that stays open must not stall the page's own request (measured: a 6 s stream delivered its headers after 6013 ms instead of 31 ms), so it is let go after HOLD_MS
            let timer; const slow = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('too slow')), HOLD_MS); });
            const got = await Promise.race([cdp.send('Fetch.getResponseBody', {requestId: event.requestId}), slow]).finally(() => clearTimeout(timer)), key = `${event.request.method} ${event.request.url}`;
            if (!paused.has(key)) paused.set(key, []);
            paused.get(key).push(Buffer.from(got.body, got.base64Encoded ? 'base64' : 'utf8'));
          } catch { /* a redirect or an empty reply has no body to take: the later reads decide */ }
        }
        const release = event.responseErrorReason !== undefined ? ['Fetch.failRequest', {requestId: event.requestId, errorReason: event.responseErrorReason}]
          : [atResponse ? 'Fetch.continueResponse' : 'Fetch.continueRequest', {requestId: event.requestId}];
        await cdp.send(...release).catch(() => {});   // every paused reply is let go as what it was
      });
      await cdp.send('Fetch.enable', {patterns: [{resourceType: 'XHR', requestStage: 'Response'}, {resourceType: 'Fetch', requestStage: 'Response'}]});
    } catch { /* a page without a DevTools session (a worker, a closed page): the later reads */ }
  };
  for (const page of context.pages?.() || []) hold(page);
  context.on('page', page => { hold(page); });
  context.on('response', response => { const request = response.request(); if (recordable(request.url())) early.set(request, response.body().then(body => ({body}), () => ({lost: true}))); });
  const done = async (request, failed) => {
    inFlight.delete(request);
    if (!recordable(request.url())) return;
    // A request reported failed AFTER its reply came (the page stopped reading it, e.g. a CV upload to storage: Ashby, 14 Oct 2026) keeps that reply: replayed as failed, the
    // site shows "failed to upload" where live went on. Only a request with no reply at all is replayed as failed.
    const began = t0.get(request) ?? Date.now(), ended = Date.now(), response = await request.response().catch(() => null);
    let body = null, lost = false;
    const taken = paused.get(`${request.method()} ${request.url()}`)?.shift();   // the reply as the browser held it at the response stage, when there was one
    if (taken) { body = taken; early.delete(request); }
    else if (early.has(request)) { const got = await early.get(request); early.delete(request); body = got.body ?? null; lost = !!got.lost; }
    else { try { body = response ? await response.body() : null; } catch { body = null; lost = true; } }   // no 'response' event seen (a request reported at once): the late read, as before
    const headers = response ? await response.allHeaders().catch(() => response.headers()) : {}, sent = await request.allHeaders().catch(() => request.headers());
    body = repairUnlabeledText(body, headers['content-type']);   // the inspector's double-encoded unlabeled text, back to the bytes the browser read
    const hash = body ? sha(body) : '';
    if (body) bodies.set(hash, body);
    entries.push({method: request.method(), url: request.url(), type: request.resourceType(), mode: sent['sec-fetch-mode'] || '', startMs: began - startedAt, waitMs: ended - began,
      bodyKey: bodyKey(request.postDataBuffer(), sent['content-type'] || ''), status: response?.status() ?? 0, failed: !response, ...(failed ? {error: String(request.failure()?.errorText || '').slice(0, 80)} : {}),
      headers: Object.fromEntries(Object.entries(headers).filter(([name]) => KEEP_HEADER.test(name))), hadCookie: 'set-cookie' in headers, cookies: cookiesOf(headers['set-cookie'], request.url(), owner), hash, size: body?.length || 0, ...(lost ? {bodyLost: true} : {})});   // bodyLost: its reply could not be read: the replay would serve an EMPTY answer; the guard refuses the row (lib/record-guard.mjs)
  };
  const track = promise => { pending.add(promise); promise.finally(() => pending.delete(promise)); };
  context.on('requestfinished', request => track(done(request, false)));
  context.on('requestfailed', request => track(done(request, true)));
  const settle = async (maxMs = 0, {pollMs = 200} = {}) => {
    const began = Date.now();
    while (inFlight.size && Date.now() - began < maxMs) await new Promise(resolve => setTimeout(resolve, pollMs));
    const kinds = {};   // the open requests by resource type (fetch, xhr, script, document...): a kind only, never an address
    for (const request of inFlight) { const kind = String((typeof request.resourceType === 'function' && request.resourceType()) || 'other'); kinds[kind] = (kinds[kind] || 0) + 1; }
    return {waitedMs: Date.now() - began, unfinished: inFlight.size, kinds};
  };
  return {settle, ready: () => Promise.all([...holding]), flush: () => Promise.all([...pending]), result: () => ({entries: [...entries].sort((a, b) => a.startMs - b.startMs), bodies})};
}

const MAX_HOPS = 10;   // a redirect chain longer than this (a loop) is not followed
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// The echo rule: a reply that echoes a per-run value the page sent (an upload key built from the time and a random number) gets the replay's own value in place of
// the live one. A value is per-run when it is long and mixes digits and letters; its live twin in the reply has the same shape (each run of letters/digits the same length,
// the same punctuation between). -> the reply body, rewritten when exactly one twin is found per value.
const parts = (buf, contentType) => {
  const boundary = /boundary=([^;]+)/i.exec(contentType || '')?.[1];
  if (!buf || !boundary) return [];
  return buf.toString('latin1').split(`--${boundary}`).slice(1, -1).map(part => { const at = part.indexOf('\r\n\r\n'), head = part.slice(0, at); return /filename="/.test(head) ? '' : part.slice(at + 4).replace(/\r\n$/, ''); }).filter(Boolean);
};
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function echo(body, sentValues) {
  let text = body.toString('utf8'), changed = 0;
  for (const value of sentValues) {
    if (value.length < 16 || !/\d/.test(value) || !/[a-z]/i.test(value) || text.includes(value)) continue;
    const shape = new RegExp(value.split(/([^A-Za-z0-9]+)/).map((run, i) => (i % 2 ? escape(run) : `[A-Za-z0-9]{${run.length}}`)).join(''), 'g');
    const twins = [...new Set(text.match(shape) || [])];
    if (twins.length !== 1) continue;
    for (const [from, to] of [[twins[0], value], [encodeURIComponent(twins[0]), encodeURIComponent(value)]]) if (text.includes(from)) { text = text.split(from).join(to); changed += 1; }
  }
  return changed ? Buffer.from(text) : body;
}
// Cookies (owner decision 15 Oct 2026: "record first-party cookies that are NOT HttpOnly, never HttpOnly"; before it a record kept no cookie at all, and a site that picks
// an A/B variant from a cookie the server set replayed with the default: jobs.ch's survey box, 3 of 3 replays). Kept: the name, value, path, secure flag and the
// Domain of a cookie a page script can read. Never kept: an HttpOnly cookie (a login, a session), a Domain outside the request's own site, a deleted one (Max-Age 0 or a past
// Expires), a value over 1024 characters, an e-mail address, a phone number or any value of the person (`owner`: the app's personal values, as a Map). The record is
// encrypted like the rest; keepRecord drops a third party's. Guard: test/record/net-record.test.mjs. -> [{name, value, path, secure, domain?}]
export function cookiesOf(header, url, owner = new Map()) {
  const host = new URL(url).hostname, out = [];
  for (const line of String(header || '').split('\n')) {
    const [pair, ...rest] = line.split(';').map(part => part.trim()), at = pair.indexOf('=');
    if (at < 1) continue;
    const name = pair.slice(0, at), value = pair.slice(at + 1), attr = {};
    for (const part of rest) { const eq = part.indexOf('='); attr[(eq < 0 ? part : part.slice(0, eq)).toLowerCase()] = eq < 0 ? true : part.slice(eq + 1); }
    if (attr.httponly) continue;
    if (attr['max-age'] !== undefined && Number(attr['max-age']) <= 0) continue;
    if (attr.expires && Date.parse(attr.expires) < Date.now()) continue;
    const domain = typeof attr.domain === 'string' ? attr.domain.replace(/^\./, '').toLowerCase() : '';
    if (domain && siteOf(domain) !== siteOf(host)) continue;
    const text = `${name}=${value}`.toLowerCase();
    if (value.length > 1024 || /@/.test(value) || new RegExp(EMAIL.source).test(text) || new RegExp(PHONE.source).test(value) || [...owner.keys()].some(mine => mine && text.includes(String(mine).toLowerCase()))) continue;
    out.push({name, value, path: typeof attr.path === 'string' ? attr.path : '/', secure: !!attr.secure, ...(domain ? {domain} : {})});
  }
  return out.slice(0, 30);
}

const netLog = line => { if (process.env.JP_NET_LOG) try { fs.appendFileSync(process.env.JP_NET_LOG, `${Date.now()} ${line}\n`); } catch { /* a report only */ } };
// The replay side (§2-§7): one route serves the record. -> {counts}
export async function netReplay(context, {entries, bodies}, {slow = false, say = () => {}} = {}) {
  const counts = {exact: 0, normalised: 0, order: 0, notRecorded: [], thirdPartyMisses: 0, sockets: 0, dropped: 0};
  const firstParty = new Set(entries.filter(entry => entry.type === 'document').map(entry => siteOf(new URL(entry.url).host)));
  const group = keyOf => { const map = new Map(); for (const entry of entries) { const key = keyOf(entry); if (!map.has(key)) map.set(key, []); map.get(key).push(entry); } return map; };
  const byExact = group(entry => `${entry.method} ${entry.url} ${entry.bodyKey}`), byNorm = group(entry => `${entry.method} ${normUrl(entry.url)} ${entry.bodyKey}`), byPath = group(entry => `${entry.method} ${pathOf(entry.url)}`);
  const used = new Set();
  const take = (list, method) => { if (!list?.length) return null; const next = list.find(entry => !used.has(entry)); if (next) { used.add(next); return next; } return method === 'GET' ? list.at(-1) : null; };
  // One lookup for a direct request and for a redirect's target: exact address, then the normalised one, then by path in order (the same rules, never a second path).
  const lookup = (method, url, key) => {
    let entry = take(byExact.get(`${method} ${url} ${key}`), method), rule = 'exact';
    if (!entry) { entry = take(byNorm.get(`${method} ${normUrl(url)} ${key}`), method); rule = 'normalised'; }
    if (!entry) { entry = take(byPath.get(`${method} ${pathOf(url)}`), method); rule = 'order'; }
    return {entry, rule};
  };
  await context.routeWebSocket(/.*/, ws => { counts.sockets += 1; ws.close(); });
  await context.route('**/*', async route => {
    const request = route.request(), url = request.url();
    if (!recordable(url)) return route.continue();
    const method = request.method(), sent0 = await request.allHeaders().catch(() => request.headers()), key = bodyKey(request.postDataBuffer(), sent0['content-type'] || '');
    if (process.env.JP_NET_LOG && method !== 'GET') { const raw = (request.postDataBuffer() || Buffer.alloc(0)).toString('latin1'); netLog(`body ${method} ${url.slice(0, 80)}: ${(raw.match(/name="key"\r\n\r\n[^\r]*/) || [''])[0].replace(/\r\n/g, ' ')}`); }
    let {entry, rule} = lookup(method, url, key);
    if (!entry) {
      const first = firstParty.has(siteOf(new URL(url).host)) && ['document', 'script', 'fetch', 'xhr'].includes(request.resourceType());
      if (first) counts.notRecorded.push(`${method} ${pathOf(url)} (${request.resourceType()})`); else counts.thirdPartyMisses += 1;
      netLog(`404 ${method} ${url.slice(0, 160)} key=${key.slice(0, 40)} type=${request.resourceType()}`);
      return route.fulfill({status: 404, body: ''});
    }
    counts[rule] += 1;
    netLog(`${rule} ${method} ${url.slice(0, 160)} key=${key.slice(0, 40)} -> ${entry.status}${entry.failed ? ' failed' : ''} wait=${entry.waitMs} served=${entry.method} ${entry.url.slice(0, 160)} @${entry.startMs} hash=${(entry.hash || '').slice(0, 12)}`);
    if (rule === 'order') say(`loose: ${method} ${url} served the recording of ${entry.url}`);
    await wait(Math.min(8000, entry.waitMs) * (slow ? 1.6 : 1));
    if (entry.cookies?.length && context.addCookies) await context.addCookies(entry.cookies.map(({domain, ...cookie}) => ({...cookie, domain: domain || new URL(url).hostname}))).catch(() => {});   // the reply that set them, as live
    if (entry.dropped) { counts.dropped += 1; return route.fulfill({status: 404, body: ''}); }
    if (entry.failed) return route.abort().catch(() => {});
    // A recorded redirect of a page load: Chromium does not follow a fulfilled 3xx on a navigation (the load fails, the page is loaded again), so it is
    // served as a page that moves on at once, keeping the address's #fragment (the fill mark) as a real redirect does.
    const to = entry.headers?.location ? headerText(entry.headers.location) : '';
    if (to && entry.status >= 300 && entry.status < 400 && request.isNavigationRequest()) {
      counts.redirects = (counts.redirects || 0) + 1;
      return route.fulfill({status: 200, contentType: 'text/html', body: `<!doctype html><script>location.replace(${JSON.stringify(new URL(to, url).href)} + location.hash)</script>`}).catch(() => {});
    }
    // A recorded redirect of a SUBRESOURCE (a script, a fetch, a font): Chromium does not follow a fulfilled 3xx there either (Workday sends every asset through a 307: the
    // redirect's target was never asked, no script ran, the page stayed a shell; 14 Oct 2026, Richemont). The chain is followed INSIDE the record: each Location is resolved
    // against the address it came from and looked up like a direct request; the original request is answered with the final entry (its status, headers, so its CORS ones, and body).
    // A target the record lacks, or a chain longer than MAX_HOPS, counts as not recorded.
    for (let hops = 0; entry.status >= 300 && entry.status < 400 && entry.headers?.location; hops++) {
      let next = '';
      try { next = new URL(headerText(entry.headers.location), entry.url).href; } catch { /* not an address */ }
      const target = next && hops < MAX_HOPS ? lookup('GET', next, '') : {};
      if (!target.entry) { counts.notRecorded.push(`GET ${pathOf(next || url)} (redirect target of ${request.resourceType()})`); netLog(`404 redirect target ${next.slice(0, 160)} of ${url.slice(0, 100)}`); return route.fulfill({status: 404, body: ''}); }
      counts.redirects = (counts.redirects || 0) + 1;
      netLog(`${target.rule} GET ${next.slice(0, 160)} -> ${target.entry.status} wait=${target.entry.waitMs} (redirect of ${url.slice(0, 100)})`);
      await wait(Math.min(8000, target.entry.waitMs) * (slow ? 1.6 : 1));
      entry = target.entry;
      if (entry.failed) return route.abort().catch(() => {});
    }
    let body = bodies.get(entry.hash) || Buffer.alloc(0), headers = entry.headers?.location ? {...entry.headers, location: headerText(entry.headers.location)} : entry.headers;
    const real = repairUnlabeledText(body, headers?.['content-type']);   // an older record holds the inspector's double encoding: served as the bytes the live page read
    if (real !== body) { counts.repaired = (counts.repaired || 0) + 1; netLog(`repaired unlabeled text replies: ${counts.repaired} (${url.slice(0, 100)})`); body = real; }
    if (method !== 'GET' && body.length && body.length < 1e5) {
      const sent = parts(request.postDataBuffer(), sent0['content-type']), echoed = echo(body, sent);
      if (echoed !== body) { counts.echoed = (counts.echoed || 0) + 1; netLog(`echo ${method} ${url.slice(0, 80)}`); body = echoed; headers = Object.fromEntries(Object.entries(headers).map(([name, v]) => [name, echo(Buffer.from(String(v)), sent).toString()])); }
    }
    return route.fulfill({status: entry.status, headers, body}).catch(() => {});
  });
  return {counts};
}
