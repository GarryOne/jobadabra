// Serve reviewed AI replies by stable question identity before caches or live transports.
// Job: serve stored answers
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decideQuestion} from './ai-answers-decide.mjs';
import {placeQuestion} from './ai-answers-place.mjs';
import {engineQuestion, itemOperation, validateItemEntry} from './ai-answers-engine.mjs';
import {canonical, hash, object} from './ai-answers-engine-items.mjs';

/** Opening of desktop/lib/learnings.js INSTRUCTIONS: the only way to tell its header-less call (kind learn_from_form) apart. */
export const LEARN_FORM_PREFIX = "A job-application form was just filled. You keep the applicant's learnings:";
const GOLDEN = new URL('../fixtures/golden/', import.meta.url);
const TABLE = fileURLToPath(new URL('ai-answers.json', GOLDEN));
const refusals = new Map();
const suiteOf = env => env.E2E_SUITE || env.E2E_STEPS_SUITE || 'default';
const artifactsOf = env => path.resolve(env.E2E_ARTIFACTS || fileURLToPath(new URL(`../artifacts/${suiteOf(env)}/`, import.meta.url)));

/** Wrap stored text with the same Messages reply used by the proxy's canned answers. */
// Why (#2450 slice 3): score and decide replay share the existing wrapper without a circular proxy dependency.
export const message = text => ({id: 'msg_e2e', type: 'message', role: 'assistant', model: 'e2e-canned', stop_reason: 'end_turn', stop_sequence: null,
  content: [{type: 'text', text}], usage: {input_tokens: 1, output_tokens: 1}});

/** Read the answer mode; unknown settings fail rather than silently allowing live AI. */
export function answersMode(env = process.env) {
  const mode = env.E2E_AI_ANSWERS ?? 'off';
  if (!['off', 'backbone', 'record'].includes(mode)) throw new Error(`invalid E2E_AI_ANSWERS: ${mode}`);
  return mode;
}

/** Load reviewed replies, optional decide items and declared kind answers, validating each shape. */
export function loadTable(file = TABLE) {
  const table = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (table?.v !== 1) throw new Error(`AI answers: unsupported v in ${file}`);
  if (!object(table.answers)) throw new Error(`AI answers: answers must be an object in ${file}`);
  for (const [operation, entries] of Object.entries(table.answers)) {
    if (!object(entries)) throw new Error(`AI answers: ${operation} must be an object`);
    for (const [id, entry] of Object.entries(entries)) if (!object(entry?.reply)) throw new Error(`AI answers: ${operation}/${id} reply must be an object`);
  }
  checkItems(table);
  checkKinds(table.kinds);
  return table;
}

/** Validate kind declarations: a caption identity, or exactly one reply or named failure. */
function checkKinds(kinds) {
  if (kinds === undefined) return;
  if (!object(kinds)) throw new Error('AI answers: kinds must be an object');
  for (const [kind, entry] of Object.entries(kinds)) {
    // Why (29 Oct 2026, ap): a caption-keyed kind has no blanket answer; unknown rounds must fail by their own name.
    if (entry?.identity === 'caption' && Object.keys(entry).length === 1) continue;
    if (entry?.identity !== undefined) throw new Error(`AI answers: ${kind} needs only a supported caption identity`);
    const answer = entry?.answer;
    // Why (29 Oct 2026, ap): declared refusals use only failureFor's named API failures, never a blanket fallback for unknown kinds.
    const valid = object(answer) && Object.keys(answer).length === 1 &&
      (object(answer.reply) || ['rate-limit', 'server-error', 'invalid-key', 'no-credit'].includes(answer.refuse));
    if (!valid) throw new Error(`AI answers: ${kind} needs an answer with an object reply or known refuse name`);
  }
}

/** Validate the optional item table with the same errors as complete-reply validation. */
function checkItems(table) {
  if (table.items !== undefined) {
    if (!object(table.items)) throw new Error('AI answers: items must be an object');
    for (const [operation, entries] of Object.entries(table.items)) {
      if (!object(entries)) throw new Error(`AI answers: ${operation} items must be an object`);
      for (const [key, entry] of Object.entries(entries)) {
        validateItemEntry(operation, entry, key);
      }
    }
  }
}

const parsed = body => {
  if (object(body) && !Buffer.isBuffer(body)) return body;
  try { return JSON.parse(String(body || '{}')); } catch { return {}; }
};
// Why (30 Oct 2026, qu): score/caption identities and refusal previews retain their permissive text extraction; engine parsers require strict text-only blocks.
const textOf = content => typeof content === 'string' ? content : (Array.isArray(content) ? content.map(part => part?.text || '').join('\n') : '');
const actionOf = (headers, body) => new Headers(headers || {}).get('x-jp-action') || String(body.prompt_cache_key || '').replace(/^job-pilotto-/, '');

/** Identify one posting by its golden row, or by its trimmed feed identity when no golden row matches. */
// Why (30 Oct 2026, qu+ap): a suite scoring its own feed postings needs stored answers keyed by the question.
function scoreQuestion(body, persona) {
  const messages = body.messages || (Array.isArray(body.input) ? body.input : [{role: 'user', content: body.input}]);
  const text = messages.filter(item => item.role === 'user').map(item => textOf(item.content)).join('\n');
  const identities = [...text.matchAll(/^Title: ([^\r\n]+)\r?\nCompany: ([^\r\n]+)\r?\nLocation: ([^\r\n]*)/gm)];
  const golden = persona ? new URL(`../fixtures/golden-${persona}/`, import.meta.url) : GOLDEN;
  const truth = JSON.parse(fs.readFileSync(new URL('truth.json', golden), 'utf8'));
  const sources = JSON.parse(fs.readFileSync(new URL('sources.json', golden), 'utf8'));
  const matches = truth.filter(item => identities.some(([, title, company, location]) =>
    item.title === title.trim() && (item.company || sources[0].company) === company.trim() && item.location === location.trim()));
  if (identities.length !== 1 || matches.length > 1) return {unkeyable: 'app.score: request must carry exactly one posting identity matching at most one golden row'};
  if (matches.length === 0) {
    const [, title, company, location] = identities[0];
    const id = `feed/${hash(canonical({company: company.trim(), location: location.trim(), title: title.trim()}))}`;
    return {operation: 'app.score', id: persona ? `${persona}/${id}` : id};
  }
  return {operation: 'app.score', id: persona ? `${persona}/${matches[0].id}` : String(matches[0].id)};
}

/** Identify the explicit caption before transcript text; transcript lines cannot supply or override it. */
function captionQuestion(body, action) {
  const messages = body.messages || (Array.isArray(body.input) ? body.input : [{role: 'user', content: body.input}]);
  const captions = messages.filter(item => item.role === 'user').flatMap(item => {
    const text = textOf(item.content).split(/\r?\nTranscript or notes:\r?\n/, 1)[0];
    return [...text.matchAll(/^Caption: ([^\r\n]+)$/gm)].map(match => match[1].trim());
  });
  if (captions.length !== 1 || !captions[0] || captions[0] === '(none)') return {unkeyable: `${action}: request needs exactly one non-empty caption`};
  return {operation: `app.${action}`, id: captions[0]};
}

/** Identify scores, decide items, declared kinds or fact questions; an explicit table keeps kind lookup pure. */
export function questionOf({url, headers, body, hint}, env = process.env, table) {
  // Why (#2450): golden personas reuse posting IDs, so their stored scores and verdicts must never share an answer.
  const persona = env.E2E_QUALITY_PERSONA || '';
  if (hint?.operation === 'judge.facts' && typeof hint.id === 'string' && hint.id.trim()) return {operation: hint.operation, id: persona ? `${persona}/${hint.id}` : hint.id};
  const data = parsed(body), action = actionOf(headers, data);
  const engine = engineQuestion(data, persona); if (engine) return engine;
  const system = textOf(data.system ?? data.instructions);
  if (action === 'score' || system.startsWith('You rank job postings for one candidate.')) return scoreQuestion(data, persona);
  if (action === 'decide' || system.startsWith('You decide what short pieces of content mean')) return decideQuestion(data, persona);
  // Why (30 Oct 2026, qu): a recognized place SYSTEM owns its malformed-request reason; header-only scout asks may still belong to a declared kind.
  const placeSystem = system.startsWith('You decide where job postings are, for one job seeker.');
  if (placeSystem || action === 'scout' || action === 'place_triage') {
    const place = placeQuestion(data, persona);
    if (!place.unkeyable || placeSystem) return place;
  }
  // Why (30 Oct 2026, PR #2562, Gitar): background form-learning calls omit action headers, so the header-less call is recognised by its system prompt's opening, LEARN_FORM_PREFIX; applyflows-backbone.test.mjs fails if the product's INSTRUCTIONS stop starting with it.
  const kind = action || (system.startsWith(LEARN_FORM_PREFIX) ? 'learn_from_form' : '');
  const kinds = (table ?? loadTable(env.E2E_AI_ANSWERS_FILE || TABLE)).kinds;
  // Why (30 Oct 2026, Gitar on #2505): kinds (the action header, or learn_from_form for that header-less call, #2562) are declared per backbone suite; live suites in off and record mode keep their replay and live path, for caption-keyed kinds too (30 Oct 2026, ap: interviews).
  if (object(kinds) && Object.hasOwn(kinds, kind) && answersMode(env) === 'backbone') {
    if (kinds[kind].identity === 'caption') return captionQuestion(data, kind);
    // Why (29 Oct 2026, ap): kind-only answers (the id is the kind: the action, or learn_from_form) have no stable request identity; caption-keyed reviews must never fall through here.
    return {operation: 'app.kind', id: kind};
  }
  return {unkeyable: `${action || hint?.operation || 'unknown'}: question identity is not in the request${!action && !hint ? ` (${url || 'unknown path'})` : ''}`};
}

/** Return a complete stored reply, or name the precise question that has no answer. */
export function answerFor(question, table) {
  const operation = itemOperation(question.operation);
  if (operation) {
    const found = operation.answer(question, table);
    return found.missing ? found : {reply: message(JSON.stringify(found.data))};
  }
  if (question.operation === 'app.kind') {
    const entry = object(table.kinds) && Object.hasOwn(table.kinds, question.id) ? table.kinds[question.id] : null;
    return entry ? {...entry.answer} : {missing: `app.kind/${question.id}`};
  }
  const entries = table.answers[question.operation];
  if (!object(entries) && !['app.score', 'judge.facts'].includes(question.operation)) return {unkeyable: `${question.operation || 'unknown'}: no answer kind identifies the question`};
  const entry = object(entries) && Object.hasOwn(entries, question.id) ? entries[question.id] : null;
  return entry ? {reply: entry.reply} : {missing: `${question.operation}/${question.id}`};
}

/** Extract only the bounded identity fields authorized for an unidentifiable refusal. */
function requestPreview(request) {
  const data = parsed(request?.body), body = object(data) ? data : {};
  const messages = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : [];
  const user = messages.find(item => item?.role === 'user')?.content ?? (typeof body.input === 'string' ? body.input : '');
  const prefix = (content, limit) => textOf(content).replace(/\s+/g, ' ').slice(0, limit);
  // Why (30 Oct 2026, supervisor): unknown refusals need enough identity to classify them; the rest of the prompt must never enter this diagnostic.
  return {'x-jp-action': new Headers(request?.headers || {}).get('x-jp-action') || 'none',
    system: prefix(body.system ?? body.instructions, 160), user: prefix(user, 100), model: typeof body.model === 'string' && body.model ? body.model : 'none'};
}

/** Build the shared refusal, adding bounded diagnostics only when no question can be identified. */
export function refusal(suite, question, why, request) {
  const name = question?.unkeyable || (question?.operation ? `${question.operation}/${question.id}` : 'unknown: question identity is not in the request');
  const preview = why === 'is unkeyable' || !question?.operation ? `; request=${JSON.stringify(requestPreview(request))}` : '';
  const error = new Error(`${suite}: ${name} ${why} (E2E_AI_ANSWERS=backbone): add it with a record run (E2E_AI_ANSWERS=record)${preview}`);
  error.code = 'E2E_AI_ANSWER_MISSING';
  return error;
}

/** Write keyed live replies or validated items for review; never write the committed table. */
export function recordCandidate(dir, question, reply) {
  if (question.unkeyable) return;
  if (!object(reply)) throw new Error('AI answer candidate reply must be an object');
  const operation = itemOperation(question.operation);
  if (operation) {
    const items = operation.candidates(question, reply);
    if (!items.length) return;
    fs.mkdirSync(dir, {recursive: true});
    for (const {key, text, answer, name} of items) {
      // Why (30 Oct 2026, qu; #2450 slice 3): all registered items remain independently reviewed; recording never changes the committed table.
      const table = {v: 1, about: 'Live AI item answer awaiting human review.', answers: {}, items: {[question.operation]: {[key]: {text, answer}}}};
      fs.writeFileSync(path.join(dir, name), `${JSON.stringify(table, null, 2)}\n`);
    }
    return;
  }
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
  const mode = answersMode(env), table = loadTable(env.E2E_AI_ANSWERS_FILE || TABLE), question = questionOf(request, env, table) || {unkeyable: 'unknown: question identity is not in the request'}, dir = artifactsOf(env);
  // Why (29 Oct 2026, ap; owner-approved rule A): beta 4 missed 47 hash-keyed questions after setup text changed; question and declared-kind answers share one validated table before every cache and transport; a request no kind identifies is refused here too, never passed on.
  const found = (question.unkeyable ? {} : answerFor(question, table)) || {};
  // Why (29 Oct 2026, ap): an explicit kind refusal is a stored answer, so it must stop before caches and live transports too.
  if (found.reply || found.refuse) return found;
  // Why (29 Oct 2026, a8; owner approved the sketch): those 47 misses reached live AI in strict replay, so backbone misses must refuse before cache, relay, broker or CLI selection.
  if (mode === 'backbone') {
    // Why (#2450 slice 3): the registry must name the first missing item (or, for an unidentifiable request, its bounded preview), even when product code swallows the refusal.
    const failure = found.unkeyable || found.missing;
    const error = refusal(suiteOf(env), failure ? {...question, unkeyable: failure} : question, question.unkeyable || found.unkeyable || !found.missing ? 'is unkeyable' : 'has no stored answer', request);
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
