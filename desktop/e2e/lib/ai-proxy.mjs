// A pass-through proxy for the engine's AI calls that holds each request for `delayMs` before forwarding it, to reproduce a slow AI deterministically
// (2 Oct 2026: a friend's Jobs check scored 60 jobs for 35 minutes with nothing to show). Real answers, real cost, only slower.
// It can also fail on purpose (setMode): the API answering 429 / 500 / 401, an empty credit balance, or never answering, so the failure states of a run are tested
// without a real outage and without spending anything.
import http from 'node:http';
import {HUNG_REPORTS, markPlanted} from './planted.mjs';
import {keyFingerprint} from './key-check.mjs';
import {capMessage, capReached, noteCapped} from './ai-cap.mjs';
import {count, countError, countReplay, keep, keepMiss, recall, requestKey, usageOf} from './ai-meter.mjs';

// The stub modes any proxy of this run was armed with: a refusal that matches one came from the suite's own stub, not from the account (lib/ai-refused.mjs).
export const STUBBED = new Set();

// What the Anthropic API sends for each failure the app must survive (bodies copied from the real API's error shape).
export const FAILURES = {
  'rate-limit': {status: 429, type: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit'},
  'server-error': {status: 500, type: 'api_error', message: 'Internal server error'},
  'invalid-key': {status: 401, type: 'authentication_error', message: 'invalid x-api-key'},
  'no-credit': {status: 400, type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'},
};
// -> {status, body} for a failure mode, or null for "pass the request through" (and for 'hang', which never answers).
export function failureFor(mode) {
  const failure = FAILURES[mode];
  return failure ? {status: failure.status, body: JSON.stringify({type: 'error', error: {type: failure.type, message: failure.message}})} : null;
}

// kind / metered: the tally a paid call goes to and which API path is a model call (Anthropic: /messages; OpenAI: /responses, kind 'app-openai').
// follow: the Claude proxy of the same suite, whose controls (canned answers, fault mode, delay) this one obeys, so a suite's stand-ins and faults work on an OpenAI
// turn too (9 Oct 2026: the first OpenAI run let every stand-in pass through to the real model). shape 'openai': the Responses API, translated both ways.
export async function startAiProxy({delayMs = 0, target = 'https://api.anthropic.com', kind = 'app', metered = /\/messages(\?|$)/, shape = 'anthropic', follow = null, maxCalls = 0} = {}) {   // maxCalls: the refill's per-row cap on paid calls (lib/refill.mjs): the next one is refused here, before Anthropic
  const stats = {calls: 0, delayMs, mode: 'pass', canned: 0, armed: 0, failed: 0};   // armed / failed: the runner's check that a step's fault fired (lib/faults.mjs)
  let canned = null;   // (request body as an object) -> the text a model would answer, or null to pass the call through to Anthropic
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    stats.calls++;
    if (follow) follow.stats.calls++;   // the suite's proxy counts every AI call of the turn, as it counts the faults below: steps compare its `calls` before and after (10 Oct 2026: apply failed on an OpenAI turn, "the AI was never asked")
    const control = follow ? follow.stats : stats, openai = shape === 'openai';   // the faults and the delay a step set on the suite's proxy
    await new Promise(resolve => setTimeout(resolve, control.delayMs));
    if (control.mode !== 'pass') { control.failed++; markPlanted(`ai ${control.mode}`, control.mode === 'hang' ? HUNG_REPORTS : undefined); }
    if (control.mode === 'hang') return;   // never answers; the connection closes with the proxy
    const failure = openai ? openaiFailureFor(control.mode) : failureFor(control.mode);
    if (failure) { res.writeHead(failure.status, {'content-type': 'application/json', 'content-length': Buffer.byteLength(failure.body), 'retry-after-ms': '10'}); res.end(failure.body); return; }   // retry-after-ms: the SDK retries a 429 / 500 after what the answer says, not after seconds of backoff
    const answerWith = follow ? follow.canned() : canned;
    if (answerWith) {
      const asked = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const text = await answerWith(openai ? asAnthropic(asked) : asked);   // may be async (the live run asks a real model)
      if (text?.refuse) {   // a stand-in may also refuse a call the way the API does (a FAILURES mode), for the calls it must not answer and must not pass on
        const refusal = openai ? openaiFailureFor(text.refuse) : failureFor(text.refuse);
        stats.failed++; STUBBED.add(text.refuse);
        res.writeHead(refusal.status, {'content-type': 'application/json', 'content-length': Buffer.byteLength(refusal.body), 'retry-after-ms': '10'}); res.end(refusal.body); return;
      }
      if (text != null) {
        stats.canned++;
        if (follow) follow.stats.canned++;
        if (openai && asked.stream) {   // the app's streamed calls (lib/ai/openai-api.js stream): the same answer as server-sent events
          res.writeHead(200, {'content-type': 'text/event-stream'});
          res.end(streamOf(text));
          return;
        }
        const body = Buffer.from(JSON.stringify(openai ? responseOf(text) : message(text)));
        res.writeHead(200, {'content-type': 'application/json', 'content-length': body.length});
        res.end(body);
        return;
      }
    }
    // Replay (CI, lib/ai-meter.mjs): the same request answered before is answered from the cache, free; anything new is paid, counted, and kept for next time.
    const body = Buffer.concat(chunks), key = requestKey(req.url, body), kept = recall(key);
    if (!kept) keepMiss(key, req.url, body);   // what changed since a run replay could answer (lib/ai-meter.mjs keepMiss)
    if (kept) {
      countReplay(kind, usageOf(kept.body.toString('utf8'), kept.contentType));
      res.writeHead(kept.status, {'content-type': kept.contentType, 'content-length': kept.body.length});
      res.end(kept.body);
      return;
    }
    if (kind === 'app-free') {   // the day's cap on CI's Workers AI neurons (lib/ai-cap.mjs): a miss past it is refused, never paid
      const cap = await capReached();
      if (cap.capped) { noteCapped(cap.neurons); res.writeHead(503, {'content-type': 'application/json'}); res.end(JSON.stringify({type: 'error', error: {type: 'api_error', message: capMessage(cap.neurons)}})); return; }
    }
    if (maxCalls && stats.paid >= maxCalls) { res.writeHead(400, {'content-type': 'application/json'}); res.end(JSON.stringify({type: 'error', error: {type: 'invalid_request_error', message: `proxy: the cap of ${maxCalls} paid calls is reached`}})); return; }
    stats.paid = (stats.paid || 0) + 1;
    stats.inflight = (stats.inflight || 0) + 1;
    try {
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !['host', 'connection', 'content-length', 'accept-encoding'].includes(name)));
      const answer = await fetch(`${target}${req.url}`, {method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body});
      const answered = Buffer.from(await answer.arrayBuffer()), contentType = answer.headers.get('content-type') || 'application/json';
      if (!answer.ok) { countError(answer.status, answered.toString('utf8')); describeRefusal(stats, answer, req, body); }   // Anthropic's own answer: which limit, which error (lib/ai-meter.mjs); the first few with the request's shape
      if (answer.ok && metered.test(req.url)) { count(kind, usageOf(answered.toString('utf8'), contentType)); keep(key, {status: answer.status, contentType, body: answered}); }
      stats.inflight--;
      res.writeHead(answer.status, {'content-type': contentType, 'content-length': answered.length});
      res.end(answered);
    } catch (error) {
      stats.inflight--;
      res.writeHead(502, {'content-type': 'application/json'});
      res.end(JSON.stringify({type: 'error', error: {type: 'api_error', message: `proxy: ${error.message}`}}));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, stats, setDelay: ms => { stats.delayMs = ms; },
    // 'pass' (default), 'hang', or a key of FAILURES. Every call after this one is answered that way.
    setMode: mode => { if (mode !== 'pass' && mode !== 'hang' && !FAILURES[mode]) throw new Error(`unknown proxy mode: ${mode}`); if (mode !== 'pass') { stats.armed++; STUBBED.add(mode); } stats.mode = mode; },
    // From now on, calls `answer` returns a text for are answered with it (no model, no cost); the rest go through.
    setCanned: answer => { canned = answer; }, canned: () => canned, close: () => { server.closeAllConnections?.(); return new Promise(resolve => server.close(resolve)); }};
}

// 18 Oct 2026 (strategy): every app call was refused "credit balance is too low" while the key, the balance and a preflight call were fine, and the log showed no more than that.
// The first three refusals of a proxy print what the request was (never the key or the prompt): the API's request-id, model, max_tokens, input size, how many calls were in flight,
// and an 8-hex SHA-256 fingerprint of the key the app sent, to compare with the CI secret's (lib/key-check.mjs prints the secret's).
export function describeRefusal(stats, answer, req, body, log = console.log) {
  if ((stats.described = (stats.described || 0) + 1) > 3) return;
  let asked = {};
  try { asked = JSON.parse(body.toString('utf8')); } catch { /* not JSON: the size still shows */ }
  const sent = String(req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const fingerprint = keyFingerprint(sent);
  log(`  ai-proxy refusal ${answer.status}: request-id ${answer.headers.get('request-id') || answer.headers.get('x-request-id') || '?'}, model ${asked.model || '?'}, max_tokens ${asked.max_tokens ?? asked.max_output_tokens ?? '?'}, input ${body.length} bytes, ${stats.inflight || 0} in flight, key fingerprint ${fingerprint}`);
}

// What the Messages API returns for a reply that is `text`.
export const message = text => ({id: 'msg_e2e', type: 'message', role: 'assistant', model: 'e2e-canned', stop_reason: 'end_turn', stop_sequence: null,
  content: [{type: 'text', text}], usage: {input_tokens: 1, output_tokens: 1}});

// ---- The OpenAI side (shape 'openai'): the Responses API the app's OpenAI engine calls (desktop/lib/ai/openai-api.js body / fromResponse) ----
// A Responses request as the Messages body the suites' stand-ins read: instructions -> system; one text part -> a string content; files -> document, images -> image.
export function asAnthropic(body) {
  const part = item => (item.type === 'input_text' ? {type: 'text', text: item.text} : item.type === 'input_file' ? {type: 'document'} : item.type === 'input_image' ? {type: 'image'} : item);
  const messages = (Array.isArray(body.input) ? body.input : [{role: 'user', content: String(body.input || '')}]).map(entry => {
    const parts = Array.isArray(entry.content) ? entry.content.map(part) : [{type: 'text', text: String(entry.content || '')}];
    return {role: entry.role, content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts};
  });
  const schema = body.text?.format?.schema;   // the answer's fixed shape, where the Messages API carries it (output_config.format.schema): a stand-in tells a scoring call by it
  return {model: body.model, ...(body.instructions ? {system: body.instructions} : {}), ...(schema ? {output_config: {format: {type: 'json_schema', schema}}} : {}), messages};
}
// What the Responses API returns for a reply that is `text`.
export const responseOf = text => ({id: 'resp_e2e', object: 'response', status: 'completed', model: 'e2e-canned', output_text: text,
  output: [{type: 'message', id: 'msg_e2e', role: 'assistant', status: 'completed', content: [{type: 'output_text', text, annotations: []}]}],
  usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: {cached_tokens: 0}}});
// The same, streamed: one delta and the completed response.
export const streamOf = text => [{type: 'response.created', response: {...responseOf(''), status: 'in_progress', output: []}}, {type: 'response.output_text.delta', delta: text},
  {type: 'response.completed', response: responseOf(text)}].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
// OpenAI's error bodies for the same failures (its codes: lib/ai/openai-api.js contractError reads status and code).
export const OPENAI_FAILURES = {
  'rate-limit': {status: 429, type: 'requests', code: 'rate_limit_exceeded', message: 'Rate limit reached for requests'},
  'server-error': {status: 500, type: 'server_error', code: null, message: 'The server had an error while processing your request.'},
  'invalid-key': {status: 401, type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key provided'},
  'no-credit': {status: 429, type: 'insufficient_quota', code: 'insufficient_quota', message: 'You exceeded your current quota, please check your plan and billing details.'},
};
export function openaiFailureFor(mode) {
  const failure = OPENAI_FAILURES[mode];
  return failure ? {status: failure.status, body: JSON.stringify({error: {message: failure.message, type: failure.type, param: null, code: failure.code}})} : null;
}
