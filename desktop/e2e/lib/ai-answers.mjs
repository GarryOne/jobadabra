// Serve reviewed AI replies by stable question identity before caches or live transports.
// Job: serve stored answers
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const GOLDEN = new URL('../fixtures/golden/', import.meta.url);
const TABLE = fileURLToPath(new URL('ai-answers.json', GOLDEN));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const refusals = new Map();
const suiteOf = env => env.E2E_SUITE || env.E2E_STEPS_SUITE || 'default';
const artifactsOf = env => path.resolve(env.E2E_ARTIFACTS || fileURLToPath(new URL(`../artifacts/${suiteOf(env)}/`, import.meta.url)));

/** Read the answer mode; unknown settings fail rather than silently allowing live AI. */
export function answersMode(env = process.env) {
  const mode = env.E2E_AI_ANSWERS ?? 'off';
  if (!['off', 'backbone', 'record'].includes(mode)) throw new Error(`invalid E2E_AI_ANSWERS: ${mode}`);
  return mode;
}

/** Load a versioned table whose entries hold complete, object-shaped provider replies. */
export function loadTable(file = TABLE) {
  const table = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (table?.v !== 1) throw new Error(`AI answers: unsupported v in ${file}`);
  if (!object(table.answers)) throw new Error(`AI answers: answers must be an object in ${file}`);
  for (const [operation, entries] of Object.entries(table.answers)) {
    if (!object(entries)) throw new Error(`AI answers: ${operation} must be an object`);
    for (const [id, entry] of Object.entries(entries)) if (!object(entry?.reply)) throw new Error(`AI answers: ${operation}/${id} reply must be an object`);
  }
  return table;
}

const parsed = body => {
  if (object(body) && !Buffer.isBuffer(body)) return body;
  try { return JSON.parse(String(body || '{}')); } catch { return {}; }
};
const textOf = content => typeof content === 'string' ? content : (Array.isArray(content) ? content.map(part => part.text || '').join('\n') : '');
const actionOf = (headers, body) => new Headers(headers || {}).get('x-jp-action') || String(body.prompt_cache_key || '').replace(/^job-pilotto-/, '');

function scoreQuestion(body, persona) {
  const messages = body.messages || (Array.isArray(body.input) ? body.input : [{role: 'user', content: body.input}]);
  const text = messages.filter(item => item.role === 'user').map(item => textOf(item.content)).join('\n');
  const identities = [...text.matchAll(/^Title: ([^\r\n]+)\r?\nCompany: ([^\r\n]+)\r?\nLocation: ([^\r\n]*)/gm)];
  const golden = persona ? new URL(`../fixtures/golden-${persona}/`, import.meta.url) : GOLDEN;
  const truth = JSON.parse(fs.readFileSync(new URL('truth.json', golden), 'utf8'));
  const sources = JSON.parse(fs.readFileSync(new URL('sources.json', golden), 'utf8'));
  const matches = truth.filter(item => identities.some(([, title, company, location]) =>
    item.title === title.trim() && (item.company || sources[0].company) === company.trim() && item.location === location.trim()));
  if (identities.length !== 1 || matches.length !== 1) return {unkeyable: 'app.score: posting title, company and location must match exactly one golden row'};
  return {operation: 'app.score', id: persona ? `${persona}/${matches[0].id}` : String(matches[0].id)};
}

/** Identify a score or fact-judge question within the environment's golden persona; default IDs stay unchanged. */
export function questionOf({url, headers, body, hint}, env = process.env) {
  // Why (#2450): golden personas reuse posting IDs, so their stored scores and verdicts must never share an answer.
  const persona = env.E2E_QUALITY_PERSONA || '';
  if (hint?.operation === 'judge.facts' && typeof hint.id === 'string' && hint.id.trim()) return {operation: hint.operation, id: persona ? `${persona}/${hint.id}` : hint.id};
  const data = parsed(body), action = actionOf(headers, data);
  if (action === 'score') return scoreQuestion(data, persona);
  if (action === 'decide') return {unkeyable: 'decide: topic and item keys are not in the request'};
  return {unkeyable: `${action || hint?.operation || 'unknown'}: question identity is not in the request${!action && !hint ? ` (${url || 'unknown path'})` : ''}`};
}

/** Return a complete stored reply, or name the precise question that has no answer. */
export function answerFor(question, table) {
  const entries = table.answers[question.operation];
  const entry = object(entries) && Object.hasOwn(entries, question.id) ? entries[question.id] : null;
  return entry ? {reply: entry.reply} : {missing: `${question.operation}/${question.id}`};
}

/** Build the actionable refusal used by both app and judge entry points. */
export function refusal(suite, question, why) {
  const name = question.unkeyable || `${question.operation}/${question.id}`;
  const error = new Error(`${suite}: ${name} ${why} (E2E_AI_ANSWERS=backbone): add it with a record run (E2E_AI_ANSWERS=record)`);
  error.code = 'E2E_AI_ANSWER_MISSING';
  return error;
}

/** Merge a keyed live reply into review candidates; the committed table is never written. */
export function recordCandidate(dir, question, reply) {
  if (question.unkeyable) return;
  if (!object(reply)) throw new Error('AI answer candidate reply must be an object');
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, 'ai-answers-candidates.json');
  const table = fs.existsSync(file) ? loadTable(file) : {v: 1, about: 'Live AI answers awaiting human review.', answers: {}};
  table.answers[question.operation] ??= {};
  table.answers[question.operation][question.id] = {reply};
  fs.writeFileSync(file, `${JSON.stringify(table, null, 2)}\n`);
}

/** List refusals independently of product handling, scoped to this suite's artifact directory. */
export function refusedQuestions(env = process.env) {
  return [...(refusals.get(artifactsOf(env)) || [])];
}

/** Apply the shared table-first rule; E2E_AI_ANSWERS_FILE permits isolated test tables. */
export function storedAnswer(request, env = process.env) {
  const mode = answersMode(env), question = questionOf(request, env), dir = artifactsOf(env);
  // Why (29 Oct 2026, a8; owner approved the sketch): beta 4 missed 47 hash-keyed questions after setup text changed, so stable question answers precede every cache and transport.
  const found = question.unkeyable ? {} : answerFor(question, loadTable(env.E2E_AI_ANSWERS_FILE || TABLE));
  if (found.reply) return {reply: found.reply};
  // Why (29 Oct 2026, a8; owner approved the sketch): those 47 misses reached live AI in strict replay, so backbone misses must refuse before cache, relay, broker or CLI selection.
  if (mode === 'backbone') {
    const error = refusal(suiteOf(env), question, question.unkeyable ? 'is unkeyable' : 'has no stored answer');
    const list = refusals.get(dir) || [];
    list.push({code: error.code, message: error.message, question});
    refusals.set(dir, list);
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'ai-answer-refusals.json'), JSON.stringify(list, null, 2));
    throw error;
  }
  return {mode, question, dir: env.E2E_AI_CANDIDATES || dir};
}

/** Keep a successful live reply only for a keyed record-mode miss, never a hash replay. */
export function keepCandidate(state, reply) {
  if (state.mode === 'record') recordCandidate(state.dir, state.question, reply);
}

/** Decode a successful provider body, including a completed stream, for candidate review. */
export function keepCandidateBody(state, body) {
  if (state.mode !== 'record' || state.question.unkeyable) return;
  const raw = String(body);
  try { keepCandidate(state, JSON.parse(raw)); return; } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  let reply;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    let event;
    try { event = JSON.parse(line.slice(5)); } catch { continue; }
    reply = streamedReply(reply, event);
  }
  if (!object(reply)) throw new Error('AI answer candidate has no complete reply object');
  keepCandidate(state, reply);
}

function streamedReply(reply, event) {
  if (event.type === 'response.completed') return event.response;
  if (event.type === 'message_start') return {...event.message, content: []};
  if (!reply) return reply;
  if (event.type === 'content_block_start') reply.content[event.index] = {...event.content_block};
  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') reply.content[event.index].text += event.delta.text;
  if (event.type === 'message_delta') { Object.assign(reply, event.delta); reply.usage = {...reply.usage, ...event.usage}; }
  return reply;
}
