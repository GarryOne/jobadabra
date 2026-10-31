// A local Messages endpoint that answers through the Codex broker, for a program that only knows how to call the Anthropic API (the central scout's Python SDK client).
//   const relay = await startRelay({cap: 40});   relay.url -> 'http://127.0.0.1:<port>' (JOB_PILOTTO_AI_BASE_URL);   relay.stats; await relay.close();
// Why (31 Oct 2026, owner: "Why Anthropic is reached? We should use fully the Codex"; coordinator: the relay binds 127.0.0.1 only): the scout's judgments run in the PUBLIC engine (src/ai/decide.py), which
// calls the Anthropic SDK. The relay lets it keep doing that with a dummy key while every call is answered by lib/broker-relay.mjs; a broker "no" is an error answer, never another provider.
// Why a purpose-built server and not lib/ai-proxy.mjs (31 Oct 2026): that one is the test harness's (stored replays, faults, canned answers, a test-key upstream); a production job needs none of it, and its
// maxCalls check sits after the relay branch.
// A spent Codex budget latches: the first "ai-capped" answer is returned as HTTP 429 ("AI limit reached"), which decide.py reads as a spent limit and stops asking for the run; every later call is
// answered 429 at once, without another broker call (run 41192760002 logged 1,417 failed calls one by one).
// Job: report health
import http from 'node:http';
import {answerViaBroker} from './broker-relay.mjs';

// Why (31 Oct 2026, Gitar on #2715): the Anthropic SDK retries 429 and 5xx twice by default (it reads retry-after-ms first); `x-should-retry: false` is the header it checks before anything else. Without it every refused call
// became three, spending budget and the run's cap three times over and tripling the failure counts. A relay refusal is final (the repo rule: never retry a 429).
const json = (res, status, type, message) => {
  const body = Buffer.from(JSON.stringify({type: 'error', error: {type, message}}));
  res.writeHead(status, {'content-type': 'application/json', 'content-length': body.length, 'x-should-retry': 'false'});
  res.end(body);
};

/**
 * Takes {cap: calls this relay may send to the broker (0 = no cap), answer: (body, {env}) -> {status, contentType, body} (default lib/broker-relay.mjs), env}.
 * Returns {url, stats: {calls, ok, failed, capHit, latched, reasons[]}, close()}. `calls` counts requests that reached the broker; `capHit` those refused past the cap; `latched` is the broker's reason once it said "capped".
 */
export async function startRelay({cap = 0, answer = answerViaBroker, env = process.env} = {}) {
  const stats = {calls: 0, ok: 0, failed: 0, capHit: 0, latched: '', reasons: []};
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.method !== 'POST' || !/^\/v1\/messages(\?|$)/.test(req.url)) return json(res, 404, 'not_found_error', `the Codex relay answers POST /v1/messages only, not ${req.method} ${req.url}`);
    if (stats.latched) { stats.failed++; return json(res, 429, 'rate_limit_error', `AI limit reached: ${stats.latched}`); }
    if (cap && stats.calls >= cap) { stats.capHit++; return json(res, 429, 'rate_limit_error', `AI limit reached: this run's cap of ${cap} calls is used (items wait for the next run)`); }
    stats.calls++;
    let answered;
    try { answered = await answer(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'), {env}); }
    catch (error) { answered = {status: 502, contentType: 'application/json', body: Buffer.from(JSON.stringify({type: 'error', error: {type: 'api_error', message: `relay: ${error.message}`}}))}; }
    if (answered.status === 200) {
      stats.ok++;
      res.writeHead(200, {'content-type': answered.contentType, 'content-length': answered.body.length});
      return res.end(answered.body);
    }
    stats.failed++;
    let message = '';
    try { message = JSON.parse(answered.body.toString('utf8')).error?.message || ''; } catch { /* a body that is not JSON has no message */ }
    message = message || `HTTP ${answered.status}`;
    if (stats.reasons.length < 5) stats.reasons.push(message);
    if (/^ai-capped:/.test(message)) { stats.latched = message.replace(/^ai-capped:\s*/, ''); return json(res, 429, 'rate_limit_error', `AI limit reached: ${stats.latched}`); }
    res.writeHead(answered.status, {'content-type': answered.contentType, 'content-length': answered.body.length, 'x-should-retry': 'false'});
    res.end(answered.body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));   // 127.0.0.1 only: nothing off this runner reaches the broker through it
  return {url: `http://127.0.0.1:${server.address().port}`, stats, address: () => server.address(), close: () => { server.closeAllConnections?.(); return new Promise(resolve => server.close(resolve)); }};
}
