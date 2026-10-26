// Reviews the journey's screenshots (artifacts/ui-<view>.png) with AI and writes artifacts/ai-findings.json.
//   E2E_ANTHROPIC_KEY=… node review-ui.mjs        (about half a cent a page on Sonnet through the Batch API; the app itself runs on Haiku)
// A request already answered (the same picture, facts, rules and model, byte for byte) is not asked again: its findings come from the
// review cache (E2E_REVIEW_CACHE, kept between CI runs), so an unchanged page costs nothing and its issues are still "seen again".
// The rest go direct, 4 at a time; 20 or more go as ONE Message Batches request (half the price, same model and prompt); whatever the batch has not answered within
// E2E_REVIEW_BATCH_WAIT_S (default 360 s) is cancelled and asked directly, so a slow batch never costs a review.
// An answer cut off by the token cap is not a clean page: it is listed as not reviewed. Every call's tokens and cost are logged,
// and the totals written to artifacts/ai-review-usage.json.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {ARTIFACTS, DESKTOP} from './lib/app.mjs';
import {judgeFamily} from './lib/engine.mjs';
import {MODEL, buildRequest, fingerprint, parseFindingsDetailed, usageCost} from './lib/vision.mjs';

// CI on Free AI (owner, 26 Oct 2026: "Let's just switch to Free AI"): the relay reads no pictures, so the review waits for its Workers AI vision model instead of
// failing on the Claude key (CI's Anthropic credit is out). E2E_JUDGE_FAMILY=claude brings it back.
if (judgeFamily() === 'free') { console.log('Screenshot review: paused while CI runs on Free AI (the relay reads no pictures; the vision review comes next).'); process.exit(0); }
const key = process.env.E2E_ANTHROPIC_KEY;
if (!key) { console.error('E2E_ANTHROPIC_KEY is needed.'); process.exit(2); }
const API = process.env.E2E_ANTHROPIC_URL || 'https://api.anthropic.com';   // a test points this at a fake
const HEADERS = {'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'};
const BATCH_WAIT_MS = Number(process.env.E2E_REVIEW_BATCH_WAIT_S || 360) * 1000;
const POLL_MS = Number(process.env.E2E_REVIEW_POLL_MS || 10000);
const skill = path.resolve(DESKTOP, '..', '.claude', 'skills', 'ui-look-and-feel', 'SKILL.md');
const rules = fs.existsSync(skill) ? fs.readFileSync(skill, 'utf8').replace(/^---[\s\S]*?---/, '') : '';
const CACHE = process.env.E2E_REVIEW_CACHE || path.join(DESKTOP, 'e2e', '.review-cache');
const CACHE_DAYS = 14;   // an answer older than this is asked again (and the file pruned): the reviewer's judgement may have moved on
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const all = [];
// A skipped suite (no token yet) or a suite that stopped early leaves nothing to look at: that is not an error.
if (!fs.existsSync(ARTIFACTS) || !fs.readdirSync(ARTIFACTS).some(name => /^(ui|failed)-.+\.png$/.test(name))) { console.log('No screenshots to review.'); process.exit(0); }
fs.mkdirSync(CACHE, {recursive: true});
for (const name of fs.readdirSync(CACHE)) {
  const file = path.join(CACHE, name);
  if (Date.now() - fs.statSync(file).mtimeMs > CACHE_DAYS * 86400000) fs.rmSync(file, {force: true});
}
let rejected = 0;
// Which pages the AI really looked at, and which it could not (no credit, rate limit, an outage, a cut-off answer): ui-findings reads this. A page nobody reviewed is not a page that came back clean.
const reviewed = [], unreviewed = [];
const usage = {model: MODEL, calls: 0, batched: 0, cached: 0, failed: 0, cutOff: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0};
const names = fs.readdirSync(ARTIFACTS);
// The pages the journey photographed, and the window at the moment a step failed (at most two): a failure screenshot shows the whole app, the sidebar and the bottom bar too.
const jobs = [...names.filter(name => /^ui-.+\.png$/.test(name)).sort().map(name => ({view: name.slice(3, -4), png: name, factsFile: path.join(ARTIFACTS, `ui-${name.slice(3, -4)}.json`)})),
  ...names.filter(name => /^failed-.+\.png$/.test(name)).sort().slice(0, 2).map(name => ({view: 'failure-screenshot', png: name, factsFile: ''}))]
  .map((job, index) => {
    const facts = job.factsFile && fs.existsSync(job.factsFile) ? JSON.parse(fs.readFileSync(job.factsFile, 'utf8')) : null;
    const request = buildRequest({view: job.view, pngBase64: fs.readFileSync(path.join(ARTIFACTS, job.png)).toString('base64'), rules, facts});
    const body = JSON.stringify(request);
    return {...job, id: `r${index}`, request, body, cached: path.join(CACHE, `${crypto.createHash('sha256').update(body).digest('hex')}.json`)};
  });

// One failed call (HTTP, or a batch item's error): a request we got wrong fails the step; the key's own limit or a busy service is a warning.
function failed(job, status, detail) {
  usage.failed++;
  const billing = /credit balance|usage limit|spend limit|rate limit/i.test(detail);   // the test key's own limit: a warning, not a product bug
  // An HTTP status (direct call) or an error type (batch item); a 4xx other than 429 means our request is wrong.
  const ours = !billing && (typeof status === 'number' ? status >= 400 && status < 500 && status !== 429
    : ['invalid_request_error', 'authentication_error', 'permission_error', 'not_found_error', 'request_too_large'].includes(status));
  if (ours) { console.log(`::error::AI review of ${job.view} was rejected (${status}): ${detail}`); rejected++; }
  else console.log(`::warning::AI review of ${job.view} failed (${status}): ${String(detail).slice(0, 160)}; skipped`);
  console.log(`- ${job.view}: review failed (${status})`);
  unreviewed.push({view: job.view, why: billing ? 'no credit' : String(status)});
}

// One answered call: count its cost, keep a whole answer for next time, and say when it was cut off (then the page is not reviewed).
function answered(job, message, {batch = false} = {}) {
  const u = message.usage || {}, usd = usageCost(MODEL, u, {batch});
  usage.calls++; if (batch) usage.batched++;
  usage.input += u.input_tokens || 0; usage.cacheWrite += u.cache_creation_input_tokens || 0; usage.cacheRead += u.cache_read_input_tokens || 0; usage.output += u.output_tokens || 0;
  usage.usd += usd || 0;
  console.log(`  ${job.view}: ${u.input_tokens || 0} in, ${u.cache_read_input_tokens || 0} cache read, ${u.cache_creation_input_tokens || 0} cache write, ${u.output_tokens || 0} out${usd == null ? '' : ` = $${usd.toFixed(4)}`}${batch ? ' (batch)' : ''}`);
  const text = (message.content || []).filter(block => block.type === 'text').map(block => block.text).join('');
  if (message.stop_reason !== 'end_turn') {
    usage.cutOff++;
    console.log(`::warning::AI review of ${job.view} stopped early (${message.stop_reason}, ${u.output_tokens || 0} tokens): not reviewed, nothing filed or cleared for it`);
    unreviewed.push({view: job.view, why: `answer cut off (${message.stop_reason})`});
    return null;
  }
  fs.writeFileSync(job.cached, JSON.stringify({view: job.view, model: MODEL, text}));
  return text;
}

async function direct(job) {
  const response = await fetch(`${API}/v1/messages`, {method: 'POST', headers: HEADERS, body: job.body, signal: AbortSignal.timeout(90000)}).catch(error => error);
  if (response instanceof Error) return failed(job, 0, `no answer: ${response.message}`);   // a page the AI never answered is a warning, not a stuck job
  if (!response.ok) return failed(job, response.status, (await response.text().catch(() => '')).slice(0, 300));
  return answered(job, await response.json());
}

// The batch: submit, wait up to BATCH_WAIT_MS, then take what it answered. -> Map id -> text|null for the jobs it settled; the rest go direct.
async function batch(pending) {
  const settled = new Map();
  const created = await fetch(`${API}/v1/messages/batches`, {method: 'POST', headers: HEADERS,
    body: JSON.stringify({requests: pending.map(job => ({custom_id: job.id, params: job.request}))})});
  if (!created.ok) {
    console.log(`::warning::the review batch was not accepted (HTTP ${created.status}): ${(await created.text().catch(() => '')).slice(0, 200)}; asking each page directly`);
    return settled;
  }
  let state = await created.json();
  console.log(`Review batch ${state.id}: ${pending.length} page(s), waiting up to ${Math.round(BATCH_WAIT_MS / 1000)} s`);
  const started = Date.now();
  while (state.processing_status !== 'ended' && Date.now() - started < BATCH_WAIT_MS) {
    await sleep(POLL_MS);
    const polled = await fetch(`${API}/v1/messages/batches/${state.id}`, {headers: HEADERS}).catch(() => null);
    if (polled?.ok) state = await polled.json();
  }
  if (state.processing_status !== 'ended') {
    // Too slow: cancel it. Pages it already answered are kept (and billed); the others are asked directly below.
    console.log(`Review batch ${state.id} not done after ${Math.round((Date.now() - started) / 1000)} s: cancelling, the rest go direct`);
    await fetch(`${API}/v1/messages/batches/${state.id}/cancel`, {method: 'POST', headers: HEADERS}).catch(() => null);
    for (let i = 0; i < 12 && state.processing_status !== 'ended'; i++) {
      await sleep(POLL_MS / 2);
      const polled = await fetch(`${API}/v1/messages/batches/${state.id}`, {headers: HEADERS}).catch(() => null);
      if (polled?.ok) state = await polled.json();
    }
    if (state.processing_status !== 'ended') return settled;
  }
  console.log(`Review batch ${state.id} ended after ${Math.round((Date.now() - started) / 1000)} s: ${JSON.stringify(state.request_counts || {})}`);
  const results = await fetch(state.results_url, {headers: HEADERS}).catch(() => null);
  if (!results?.ok) { console.log(`::warning::the review batch's results could not be read (HTTP ${results?.status}); asking each page directly`); return settled; }
  const byId = new Map(pending.map(job => [job.id, job]));
  for (const line of (await results.text()).split('\n').filter(Boolean)) {
    const item = JSON.parse(line), job = byId.get(item.custom_id);
    if (!job) continue;
    if (item.result?.type === 'succeeded') settled.set(job.id, answered(job, item.result.message, {batch: true}));
    else if (item.result?.type === 'errored') {
      const error = item.result.error?.error || item.result.error || {};
      failed(job, error.type || 'error', String(error.message || ''));
      settled.set(job.id, null);
    }   // canceled / expired: not settled, asked directly
  }
  return settled;
}

const answers = new Map(), fromCache = new Set(), droppedByShape = [];   // findings the AI raised that the shape rules dropped (lib/vision.mjs), with why
for (const job of jobs) {
  try {
    const text = JSON.parse(fs.readFileSync(job.cached, 'utf8')).text;
    if (typeof text === 'string') { answers.set(job.id, text); fromCache.add(job.id); usage.cached++; fs.utimesSync(job.cached, new Date(), new Date()); }   // still in use: keep it past CACHE_DAYS
  } catch { /* not answered before */ }
}
const pending = jobs.filter(job => !answers.has(job.id));
// A batch only for many pages (6 Oct 2026: 4 pages waited 3-6 min in a batch to save about a cent; the owner wants every suite job short). Fewer go direct, 4 at a time.
const BATCH_MIN = Number(process.env.E2E_REVIEW_BATCH_MIN || 20), PARALLEL = 4;
const fromBatch = pending.length >= BATCH_MIN && process.env.E2E_REVIEW_BATCH !== '0' ? await batch(pending) : new Map();
for (const [id, text] of fromBatch) answers.set(id, text);
const left = pending.filter(job => !fromBatch.has(job.id));
for (let at = 0; at < left.length; at += PARALLEL) {
  const slice = left.slice(at, at + PARALLEL);
  (await Promise.all(slice.map(job => direct(job)))).forEach((answer, i) => answers.set(slice[i].id, answer));
}

for (const job of jobs) {
  const answer = answers.get(job.id);
  if (typeof answer !== 'string') continue;   // failed or cut off: already listed as not reviewed
  const parsed = parseFindingsDetailed(answer, job.view);
  droppedByShape.push(...parsed.dropped);
  const found = parsed.kept.map(item => ({...item, id: fingerprint(item), file: job.png}));   // file: the picture the finding was seen on
  reviewed.push(job.view);
  console.log(`${found.length ? '!' : '✓'} ${job.view}: ${found.length} finding(s)${fromCache.has(job.id) ? ' (unchanged since an earlier run: not asked again)' : ''}${found.map(item => `\n    [${item.severity}] ${item.title}: ${item.detail}`).join('')}`);
  all.push(...found);
}
fs.writeFileSync(path.join(ARTIFACTS, 'ai-findings.json'), JSON.stringify({model: MODEL, findings: all, reviewed, unreviewed, dropped: droppedByShape}, null, 2));
fs.writeFileSync(path.join(ARTIFACTS, 'ai-review-usage.json'), JSON.stringify({...usage, usd: Number(usage.usd.toFixed(4))}, null, 2));
const line = `AI review: ${usage.calls} call(s) (${usage.batched} by batch, half price), ${usage.cached} unchanged (not asked again), ${usage.failed} failed, ${usage.cutOff} cut off; ${usage.input} in + ${usage.cacheRead} cache read + ${usage.cacheWrite} cache write, ${usage.output} out = $${usage.usd.toFixed(4)} (${MODEL})`;
console.log(`\n${all.length} finding(s) written to ai-findings.json\n${line}${unreviewed.length ? `\nNOT reviewed (${unreviewed.map(item => `${item.view}: ${item.why}`).join(', ')}): no finding is filed or cleared for these pages from this run.` : ''}`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
if (rejected) process.exit(1);
