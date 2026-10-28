// What an e2e suite spends on AI, counted from the API's own usage figures, and the answers it can replay instead of paying again (7 Oct 2026: the e2e key billed
// $11.67 on 6 Oct, /ai-cost showed $1.12 of it: only the screenshot review reported; the app under test and the judges spent the rest unseen).
//   app:    every call the app under test makes, as the AI proxy (lib/ai-proxy.mjs) forwards it
//   judges: every call test code makes through lib/model.mjs on the API engine (judge, factjudge, fit)
// Replay (CI): the proxy keeps each paid answer under a hash of its request in E2E_AI_CACHE; with E2E_AI_REPLAY=1 an identical request is answered from there, at no
// cost. Only the scheduled runs ask the model live (e2e.yml); a request seen for the first time always goes to the model and is kept for next time.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {usageCost} from './vision.mjs';

const blank = () => ({calls: 0, usd: 0, unpriced: 0, replayed: 0, saved: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0});
let tally = {app: blank(), 'app-openai': blank(), 'app-free': blank(), 'app-codex': blank(), judges: blank()}, errors = {};   // app-openai: the app under test on an OpenAI engine (reported with provider openai); app-free: on Free AI (Workers AI models: counted, never priced as Claude)
export const usage = () => tally;
/** Takes nothing; zeroes every kind's tally (app, app-openai, app-free, app-codex, judges) and the API error counts, for a fresh suite. */
export const resetUsage = () => { tally = {app: blank(), 'app-openai': blank(), 'app-free': blank(), 'app-codex': blank(), judges: blank()}; errors = {}; };

// A call Anthropic refused: its status and the API's own error type and message (never the request), counted per distinct answer. 7 Oct 2026: the app
// said only "AI limit reached" for both a spend limit and an empty credit balance, and nothing showed which one the e2e key had hit.
export function countError(status, text) {
  let type = '', message = '';
  try { const data = JSON.parse(text); type = data?.error?.type || ''; message = data?.error?.message || ''; } catch { message = String(text || '').slice(0, 200); }
  const key = `${status} ${type}: ${message}`.slice(0, 300);
  errors[key] = (errors[key] || 0) + 1;
}
export const apiErrors = () => errors;

// "claude-haiku-4-5-20251001" -> "claude-haiku-4-5": the API answers with the dated id, the price list has the alias.
export const priceName = model => String(model || '').replace(/-\d{8}$/, '');
const cost = (model, used) => usageCost(priceName(model), used);

// {model, usage} out of a Messages answer: a JSON body, or a stream (message_start carries the model and input, message_delta the final output count).
// OpenAI's Responses usage in the Messages shape the prices read: input without the cached part, the cached part as cache reads.
const fromOpenAi = (model, used) => ({model, usage: {input_tokens: Math.max(0, (used.input_tokens || 0) - (used.input_tokens_details?.cached_tokens || 0)),
  output_tokens: used.output_tokens || 0, cache_read_input_tokens: used.input_tokens_details?.cached_tokens || 0}});
export function usageOf(text, contentType = '') {
  if (!/event-stream/.test(contentType)) {
    try {
      const data = JSON.parse(text);
      if (data?.object === 'response' && data.usage) return fromOpenAi(data.model, data.usage);   // an OpenAI Responses answer
      return data?.usage ? {model: data.model, usage: data.usage} : null;
    } catch { return null; }
  }
  let model = '', used = null;
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('data:')) continue;
    let event; try { event = JSON.parse(line.slice(5)); } catch { continue; }
    if (event.type === 'response.completed' && event.response?.usage) return fromOpenAi(event.response.model, event.response.usage);   // an OpenAI stream's last event
    if (event.type === 'message_start') { model = event.message?.model || ''; used = {...event.message?.usage}; }
    if (event.type === 'message_delta' && event.usage) used = {...used, ...Object.fromEntries(Object.entries(event.usage).filter(([, n]) => n != null))};
  }
  return used ? {model, usage: used} : null;
}

// One paid call. An unknown model is counted, not priced (its cost is never guessed).
export function count(kind, found) {
  if (!found) return;
  const row = tally[kind], u = found.usage || {}, usd = cost(found.model, u);
  row.calls++;
  if (usd == null) row.unpriced++; else row.usd += usd;
  row.input += Number(u.input_tokens) || 0; row.output += Number(u.output_tokens) || 0;
  row.cacheRead += Number(u.cache_read_input_tokens) || 0; row.cacheWrite += Number(u.cache_creation_input_tokens) || 0;
}
// One call answered from the replay cache: free; `saved` is what it would have cost.
export function countReplay(kind, found) {
  const row = tally[kind];
  row.replayed++;
  row.saved += (found && cost(found.model, found.usage)) || 0;
}

// The key of a request: the path and the body without the fields that change on every call but not the answer.
export function requestKey(url, body) {
  let data;
  try { data = JSON.parse(body.toString('utf8') || '{}'); } catch { data = {raw: body.toString('base64')}; }
  delete data.metadata;
  return crypto.createHash('sha256').update(`${url}\n${JSON.stringify(data)}`).digest('hex').slice(0, 32);
}

const cacheDir = (env = process.env) => env.E2E_AI_CACHE || '';
export const replaying = (env = process.env) => env.E2E_AI_REPLAY === '1' && !!cacheDir(env);
// Why (#2210, owner 27 Oct 2026: "Code gate + AI rate"): the quality gate on main replays only (e2e.yml E2E_AI_STRICT): a recorded answer never expires, a question with
// no answer is asked (the run goes on) but never kept, so the retry misses it too, and the suite names it (missedQuestions). Guard: test/ai-meter.test.mjs.
export const strict = (env = process.env) => env.E2E_AI_STRICT === '1';
// Everything inside fn asks the model, whatever E2E_AI_REPLAY says; replay is back after it. For a check whose point is a second, independent answer (quality's
// second scoring: replayed, it got the first answers back and always read ±0, 26 Oct 2026). Guard: test/ai-meter.test.mjs.
export async function fresh(fn, env = process.env) {
  const saved = env.E2E_AI_REPLAY;
  env.E2E_AI_REPLAY = '0';
  try { return await fn(); } finally { if (saved === undefined) delete env.E2E_AI_REPLAY; else env.E2E_AI_REPLAY = saved; }   // process.env turns undefined into 'undefined'
}

// A kept answer is replayed for MAX_AGE_DAYS after it was paid for, then asked again live and kept fresh (owner, 7 Oct 2026): replayed forever, a change in
// the model's own behaviour (a model update) would never reach the suites. An answer kept before this rule has no date: it is asked again once.
export const MAX_AGE_DAYS = 3;
const maxAgeMs = env => (Number(env.E2E_AI_MAX_AGE_DAYS) || MAX_AGE_DAYS) * 86400000;

// -> {status, contentType, body: Buffer} kept for this request, or null (none, or older than its maximum age).
export function recall(key, env = process.env, now = Date.now()) {
  if (!replaying(env)) return null;
  try {
    const file = path.join(cacheDir(env), `${key}.json`), kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!strict(env) && !(now - Date.parse(kept.savedAt) < maxAgeMs(env))) return null;   // too old, or undated: asked live, and keep() saves it fresh
    try { const now = new Date(); fs.utimesSync(file, now, now); } catch {}   // still in use: the workflow drops answers untouched for a week
    return {status: kept.status, contentType: kept.contentType, body: Buffer.from(kept.body, 'base64')};
  } catch { return null; }
}
// A request replay could not answer (CI, replaying): kept in the suite's artifacts (ai-misses/<key>.json), so two runs' misses can be compared field by field.
// 7 Oct 2026: interactions paid 14-18 of its ~20 app calls in every gate, on the fixed path: something in its requests changes from run to run, and nothing showed what.
// Test data only (the suites' synthetic workspace), at most MAX_MISSES per suite run.
const MAX_MISSES = 60;
let misses = 0;
export function keepMiss(key, url, body, env = process.env) {
  if (!replaying(env) || !env.E2E_ARTIFACTS || misses >= MAX_MISSES) return;
  let request;
  try { request = JSON.parse(body.toString('utf8') || '{}'); delete request.metadata; } catch { return; }
  try {
    const dir = path.join(env.E2E_ARTIFACTS, 'ai-misses');
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify({url, request}, null, 1));
    misses++;
  } catch {}
}

// The questions replay could not answer in this run (its ai-misses/): key, path and the first words of the last user message, for a red that names them.
export function missedQuestions(env = process.env) {
  const dir = path.join(env.E2E_ARTIFACTS || '', 'ai-misses');
  if (!env.E2E_ARTIFACTS || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort().map(file => {
    try {
      const {url, request} = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const last = [...(request?.messages || [])].reverse().find(message => message.role === 'user')?.content;
      const text = typeof last === 'string' ? last : (last || []).map(part => part.text || '').join(' ');
      return {key: file.slice(0, -5), url, about: text.replace(/\s+/g, ' ').trim().slice(0, 100)};
    } catch { return {key: file.slice(0, -5), url: '', about: ''}; }
  });
}

// Keep a successful answer (CI only: E2E_AI_CACHE is set by the workflow; a Mac never records).
// Why (#2231): an answer that says nothing is never kept: Free AI's relay once answered a quality judge with a 200 and an empty text, it was kept, and every retry replayed
// the same "did not answer with JSON" (#2205's run 40451177894, 27 Oct 2026; quality's answers never expire). A JSON Messages or OpenAI answer counts when one
// block holds text or a tool call; any other answer (a stream, another shape) is kept as it came. Guard: test/ai-meter.test.mjs.
export function usable(contentType, body) {
  if (!/json/i.test(contentType || '')) return true;
  let data;
  try { data = JSON.parse(Buffer.from(body).toString('utf8')); } catch { return false; }
  const said = text => typeof text === 'string' && text.trim() !== '';
  if (Array.isArray(data?.content)) return data.content.some(block => block?.type === 'tool_use' || said(block?.text));
  if (Array.isArray(data?.choices)) return data.choices.some(choice => said(choice?.message?.content) || choice?.message?.tool_calls?.length);
  return true;
}

export function keep(key, {status, contentType, body}, env = process.env) {
  const dir = cacheDir(env);
  if (!dir || status !== 200 || strict(env) || !usable(contentType, body)) return;
  try { fs.mkdirSync(dir, {recursive: true}); fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify({status, contentType, savedAt: new Date().toISOString(), body: Buffer.from(body).toString('base64')})); } catch {}
}

// The suite's figures, one file per kind, in the shape ai-cost-report.mjs --file reads ({usd, calls}); the rest is for the log and the artifact.
export function writeUsage(dir) {
  const lines = [];
  for (const [kind, row] of Object.entries(tally)) {
    if (!row.calls && !row.replayed) continue;
    fs.writeFileSync(path.join(dir, `ai-usage-${kind}.json`), JSON.stringify({...row, usd: Math.round(row.usd * 1e6) / 1e6, saved: Math.round(row.saved * 1e6) / 1e6}, null, 1));
    lines.push(`AI ${kind}: ${row.calls} paid call(s) $${row.usd.toFixed(4)}${row.unpriced ? ` (+${row.unpriced} unpriced)` : ''}, ${row.replayed} replayed (saved $${row.saved.toFixed(4)})`);
  }
  const refused = Object.entries(errors);
  if (refused.length) {
    fs.writeFileSync(path.join(dir, 'ai-errors.json'), JSON.stringify(errors, null, 1));
    lines.push(...refused.map(([what, n]) => `AI refused ${n}x: ${what}`));
  }
  if (lines.length) console.log(`  ${lines.join('\n  ')}`);
}
