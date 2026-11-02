// A pass-through stand-in for the Notion API that can fail on purpose (5 Oct 2026), as lib/ai-proxy.mjs does for the AI: a busy Notion (429), a server error,
// Job: run the backbone
// an HTML error page instead of JSON (#266 met that by chance), no answer at all, or a refused connection (the network gone). The app and the engine use it only in a
// test run (JOBADABRA_E2E_NOTION_BASE_URL). `fail(mode, {times, writes})` fails the next `times` calls (all calls when omitted), or only the writes.
import http from 'node:http';
import {upstreamCredentials} from './proxy-credentials.mjs';
import {HUNG_REPORTS, markPlanted} from './planted.mjs';

export const NOTION_FAILURES = {
  'rate-limit': {status: 429, type: 'json', body: {object: 'error', status: 429, code: 'rate_limited', message: 'You have been rate limited. Please try again in a few minutes.'}},
  'server-error': {status: 500, type: 'json', body: {object: 'error', status: 500, code: 'internal_server_error', message: 'Unexpected error occurred.'}},
  'unavailable': {status: 503, type: 'json', body: {object: 'error', status: 503, code: 'service_unavailable', message: 'Notion is unavailable, please try again later.'}},
  'html': {status: 502, type: 'html', body: '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>'},
};
export const MODES = ['pass', 'hang', 'offline', ...Object.keys(NOTION_FAILURES)];
const WRITES = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
// A query is a POST but reads: only page and block changes count as writes.
export const isWrite = (method, url) => WRITES.has(method) && !/\/(?:databases|data_sources)\/[^/]+\/query|\/search\b/.test(url);

// -> 'pass' or the failure to answer this call with, given the plan. Pure, so the rule is tested without a server.
export function decide(plan, method, url) {
  if (plan.mode === 'pass') return 'pass';
  if (plan.writes && !isWrite(method, url)) return 'pass';
  if (plan.every) { plan.seen = (plan.seen || 0) + 1; if (plan.seen % plan.every !== 0) return 'pass'; }   // a flaky network: every Nth call fails, the rest get through
  if (plan.times != null) { if (plan.times <= 0) return 'pass'; plan.times--; }
  return plan.mode;
}

// The proxy's far side: the in-memory Notion when the run has one, never real Notion behind it (9 Oct 2026: on the stand-in the proxy sent the
// stand-in's placeholder token to api.notion.com, 401). Real Notion only for a run on the real test page.
export const farSide = standIn => (standIn ? standIn.url : 'https://api.notion.com');

/** Start a fault-controlled Notion proxy; exact aliases gain credentials only on the upstream hop. */
export async function startNotionProxy({target = 'https://api.notion.com', credentials = {}} = {}) {
  const stats = {calls: 0, failed: 0, writes: 0, armed: 0};
  let plan = {mode: 'pass'};
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    stats.calls++;
    if (isWrite(req.method, req.url)) stats.writes++;
    const mode = decide(plan, req.method, req.url);
    if (mode !== 'pass') { stats.failed++; markPlanted(`notion ${mode}`, mode === 'hang' ? HUNG_REPORTS : undefined); }
    if (mode === 'hang') return;
    if (mode === 'offline') { req.socket.destroy(); return; }
    const failure = NOTION_FAILURES[mode];
    if (failure) {
      const body = failure.type === 'json' ? JSON.stringify(failure.body) : failure.body;
      res.writeHead(failure.status, {'content-type': failure.type === 'json' ? 'application/json' : 'text/html', 'content-length': Buffer.byteLength(body), ...(failure.status === 429 ? {'retry-after': '1'} : {})});
      res.end(body);
      return;
    }
    try {
      const headers = upstreamCredentials(Object.fromEntries(Object.entries(req.headers).filter(([name]) => !['host', 'connection', 'content-length', 'accept-encoding'].includes(name))), credentials);
      const answer = await fetch(`${target}${req.url}`, {method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)});
      const body = Buffer.from(await answer.arrayBuffer());
      res.writeHead(answer.status, {'content-type': answer.headers.get('content-type') || 'application/json', 'content-length': body.length});
      res.end(body);
    } catch (error) {
      res.writeHead(502, {'content-type': 'application/json'});
      res.end(JSON.stringify({object: 'error', status: 502, code: 'proxy_error', message: `proxy: ${error.message}`}));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, stats,
    fail: (mode, {times = null, writes = false, every = 0} = {}) => { if (!MODES.includes(mode)) throw new Error(`unknown Notion proxy mode: ${mode}`); stats.armed++; plan = {mode, times, writes, every}; },
    pass: () => { plan = {mode: 'pass'}; },
    close: () => { server.closeAllConnections?.(); return new Promise(resolve => server.close(resolve)); }};
}
