// Resolve stored prompt references, rotate samples and report drift without choosing a transport.
// Job: serve stored answers
// Invariants: identities use the replay registry; stale bodies fail before calls; prose never votes agreement.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTable, questionOf, answerFor} from './ai-answers.mjs';
import {itemOperation} from './ai-answers-engine.mjs';
import {canonical, hash, object, replyData, requestParts} from './ai-answers-engine-items.mjs';
import {normalizedPlace} from './ai-answers-places.mjs';
import {problems} from '../../lib/ai/schema.js';

const GOLDEN = fileURLToPath(new URL('../fixtures/golden/', import.meta.url));
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const schemaOf = body => body.output_config?.format?.schema ?? body.text?.format?.schema;

/** Load the prompt-reference sidecar; bodies remain in their original fixture. */
export const loadRequests = (file = path.join(GOLDEN, 'ai-answer-requests.json')) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Resolve and validate every declared key with the same table and question registry as offline replay. */
export function resolveRequest(entry, {golden = GOLDEN, table = loadTable()} = {}) {
  const filename = path.resolve(golden, entry.source.file);
  if (!filename.startsWith(`${path.resolve(golden)}${path.sep}`)) throw new Error('request source must be inside golden fixtures');
  let body = JSON.parse(fs.readFileSync(filename, 'utf8'));
  for (const part of entry.source.path) body = body?.[part];
  if (!object(body) || hash(canonical(body)) !== entry.source.sha256) throw new Error(`stale body sha256: ${entry.id}`);
  const request = {url: '/v1/messages', body, headers: entry.action ? {'x-jp-action': entry.action} : {}};
  const question = questionOf(request, {E2E_AI_ANSWERS: 'backbone', E2E_QUALITY_PERSONA: entry.persona || ''}, table);
  if (question.operation !== entry.kind || question.unkeyable) throw new Error(`request identity changed: ${entry.id}`);
  if (!entry.keys.length || new Set(entry.keys).size !== entry.keys.length) throw new Error(`invalid stored keys: ${entry.id}`);
  const rows = entry.keys.map(key => {
    if (question.items) {
      const item = question.items.find(item => item.key === key);
      const found = item && answerFor({...question, items: [item]}, table);
      if (!found?.reply) throw new Error(`unknown stored key: ${entry.kind}/${key}`);
      return {key, text: item.text, stored: table.items[entry.kind][key].answer};
    }
    const found = question.id === key && answerFor(question, table);
    if (!found?.reply || entry.kind === 'app.kind') throw new Error(`unknown stored key: ${entry.kind}/${key}`);
    const stored = replyData(found.reply);
    if (stored === undefined) throw new Error(`stored reply is not completed JSON: ${entry.kind}/${key}`);
    return {key, stored};
  });
  return {entry, request, question, rows};
}

/** Choose at most limit prompts, balanced across kinds and oldest-checked first inside each kind. */
export function pickSample(entries, history = {}, limit = 20) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('sample limit must be a non-negative integer');
  const age = entry => {
    const saved = history[entry.id], value = object(saved) ? saved.lastChecked : saved;
    if (!value) return -Infinity;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) throw new Error(`invalid lastChecked: ${entry.id}`);
    return time;
  };
  const oldest = (a, b) => cmp(age(a), age(b)) || cmp(a.id, b.id);
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.kind)) groups.set(entry.kind, []);
    groups.get(entry.kind).push(entry);
  }
  for (const group of groups.values()) group.sort(oldest);
  const sample = [];
  while (sample.length < limit && groups.size) {
    const round = [...groups].sort((a, b) => oldest(a[1][0], b[1][0]) || cmp(a[0], b[0]));
    for (const [kind, group] of round) {
      if (sample.length === limit) break;
      sample.push(group.shift());
      if (!group.length) groups.delete(kind);
    }
  }
  return sample;
}

const EXACT = new Set(['kind', 'cc', 'country', 'tier', 'confidence', 'answer', 'role_family', 'on_call', 'contract', 'posted', 'deadline', 'id', 'application', 'round', 'quality', 'overall', 'home', 'clarity', 'format']);
const IDS = new Set(['id', 'application', 'application_id', 'round_id', 'fact_id', 'covered_by']);
const normalizedSet = values => [...new Set(values.map(normalizedPlace))].sort(cmp);

function addField(fields, field, stored, live, status, extra = {}) {
  fields.push({path: field, stored: stored === undefined ? null : stored, live: live === undefined ? null : live, status, ...extra});
}

function placeSet(kind, name, a, b) {
  if (kind !== 'app.places' || !['names', 'countries'].includes(name)) return undefined;
  if (!Array.isArray(a) || !Array.isArray(b) || ![...a, ...b].every(value => typeof value === 'string')) return undefined;
  if (canonical(normalizedSet(a)) === canonical(normalizedSet(b))) return 'same';
  return name === 'names' ? 'needs-judge' : 'changed';
}

function scalarFields(ctx, a, b, field, rule) {
  const name = field.split('.').at(-1), {fields, notes, kind, posting} = ctx;
  if (typeof a !== typeof b || a === null || b === null) {
    addField(fields, field, a, b, a === b ? 'same' : 'changed'); return;
  }
  const discrete = rule?.enum || typeof a === 'boolean' || IDS.has(name) || kind === 'app.decide' || EXACT.has(name);
  if (discrete) { addField(fields, field, a, b, a === b ? 'same' : 'changed'); return; }
  if (typeof a === 'number') {
    addField(fields, field, a, b, a === b ? 'same' : 'numeric-delta', {delta: b - a}); return;
  }
  if (['app.place', 'app.placeReading'].includes(kind) && ['where', 'nearest'].includes(name)) {
    addField(fields, field, a, b, normalizedPlace(a) === normalizedPlace(b) ? 'same' : 'needs-judge'); return;
  }
  if (kind === 'app.enrich' && name === 'evidence' && b && !posting.includes(b)) notes.push(`ungrounded-evidence:${field}`);
  addField(fields, field, a, b, 'needs-judge');
}

function collectFields(ctx, a, b, field = '', rule) {
  if (a === undefined || b === undefined) { addField(ctx.fields, field, a, b, 'missing'); return; }
  const setStatus = placeSet(ctx.kind, field.split('.').at(-1), a, b);
  if (setStatus) { addField(ctx.fields, field, a, b, setStatus); return; }
  if (Array.isArray(a) || Array.isArray(b)) {
    collectArray(ctx, a, b, field, rule); return;
  }
  if (object(a) || object(b)) {
    collectObject(ctx, a, b, field, rule); return;
  }
  scalarFields(ctx, a, b, field, rule);
}

function collectArray(ctx, a, b, field, rule) {
  if (!Array.isArray(a) || !Array.isArray(b)) { addField(ctx.fields, field, a, b, 'changed'); return; }
  for (let i = 0; i < Math.max(a.length, b.length); i++) collectFields(ctx, a[i], b[i], `${field}.${i}`, rule?.items);
}

function collectObject(ctx, a, b, field, rule) {
  if (!object(a) || !object(b)) { addField(ctx.fields, field, a, b, 'changed'); return; }
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(cmp)) {
    collectFields(ctx, a[key], b[key], field ? `${field}.${key}` : key, rule?.properties?.[key]);
  }
}

function geoNotes(stored, live) {
  const notes = [];
  if ([stored?.kind, live?.kind].some(value => ['unknown', 'remote'].includes(value))) notes.push('unknown-sentinel');
  for (const [key, min, max] of [['lat', -90, 90], ['lon', -180, 180], ['r_km', 1, live?.kind === 'city' ? 60 : 400]]) {
    if (typeof live?.[key] === 'number' && !['unknown', 'remote', 'country'].includes(live?.kind) && (live[key] < min || live[key] > max)) notes.push(`range-violation:${key}`);
  }
  return notes;
}

function comparisonStatus(fields, notes) {
  if (fields.some(f => ['changed', 'missing'].includes(f.status)) || notes.some(note => note.startsWith('ungrounded-') || note.startsWith('range-'))) return 'changed';
  if (fields.some(f => f.status === 'needs-judge')) return 'needs-judge';
  return fields.some(f => f.status === 'numeric-delta') ? 'numeric-delta' : 'same';
}

/** Compare semantic values by family: discrete facts exact, numbers as deltas, prose always unjudged. */
export function compareAnswer(kind, stored, live, {schema, posting = ''} = {}) {
  const ctx = {kind, posting, fields: [], notes: kind === 'app.geo' ? geoNotes(stored, live) : []};
  collectFields(ctx, stored, live, '', schema);
  const {fields, notes} = ctx;
  const exact = fields.filter(f => !['needs-judge', 'numeric-delta'].includes(f.status) && !('delta' in f));
  return {status: comparisonStatus(fields, notes), fields, notes, exact: {checked: exact.length, same: exact.filter(f => f.status === 'same').length}};
}
function inventory(table) {
  const kinds = {};
  for (const section of [table.items || {}, table.answers]) for (const [kind, entries] of Object.entries(section)) {
    kinds[kind] ??= new Set();
    Object.keys(entries).forEach(key => kinds[kind].add(key));
  }
  return kinds;
}

function rowSchema(question, body) {
  const schema = schemaOf(body);
  if (!question.items || question.operation === 'app.enrich') return schema;
  const row = Object.values(schema?.properties || {}).find(value => value.type === 'array')?.items;
  return row?.properties?.answer && question.operation === 'app.decide' ? row.properties.answer : row;
}

// An invalid typed row can still explain a numeric delta or missing field. It is diagnostic only:
// the registry still owns validity, and an invalid batch contributes zero exact agreement votes.
function diagnosticRows(question, body, reply) {
  const data = object(reply) ? replyData(reply) : undefined, schema = schemaOf(body);
  const root = Object.keys(schema?.properties || {}).find(key => Array.isArray(data?.[key]) && schema.properties[key].items?.type === 'object');
  if (!root) return new Map();
  const properties = schema.properties[root].items.properties;
  const selector = ['n', 'index', 'word'].find(key => Object.hasOwn(properties, key));
  if (!selector) return new Map();
  const rows = data[root], seen = new Set(), found = new Map();
  for (const row of rows) {
    if (!object(row) || seen.has(row[selector])) return new Map();
    seen.add(row[selector]);
    const item = question.items.find(item => (selector === 'word' ? item.raw : item[selector]) === row[selector]);
    if (!item) return new Map();
    const answer = question.operation === 'app.decide' ? row.answer : Object.fromEntries(Object.entries(row).filter(([key]) => key !== selector));
    found.set(item.key, answer);
  }
  return found;
}

function liveRows(resolved, reply) {
  const {question, entry, request} = resolved;
  if (!object(reply)) return {rows: new Map(), invalid: true};
  if (!question.items) {
    const data = replyData(reply), schema = schemaOf(request.body);
    return {rows: new Map([[question.id, data]]), invalid: data === undefined || !!schema && problems(data, schema).length > 0};
  }
  const candidates = itemOperation(entry.kind).candidates(question, reply);
  if (candidates.length !== question.items.length) return {rows: diagnosticRows(question, request.body, reply), invalid: true};
  return {rows: new Map(candidates.map(item => [item.key, item.answer])), invalid: false};
}

function coverageReport(entries, table, sample) {
  const report = {mode: 'dry-run', sample: sample.map(entry => ({id: entry.id, kind: entry.kind, source: entry.source, provenance: entry.provenance, keys: entry.keys})),
    coverage: {total: 0, eligible: 0, unlinked: 0, checked: 0, unjudged: 0}, kinds: {}, changedKeys: [], results: [], callsUsed: {app: 0, judge: 0, total: 0}};
  for (const [kind, keys] of Object.entries(inventory(table))) {
    const prompts = entries.filter(entry => entry.kind === kind), eligible = new Set(prompts.flatMap(entry => entry.keys)), provenance = {};
    for (const entry of prompts) provenance[entry.provenance] = (provenance[entry.provenance] || 0) + 1;
    report.kinds[kind] = {total: keys.size, eligible: eligible.size, unlinked: keys.size - eligible.size, checked: 0, unjudged: 0,
      changedKeys: [], provenance, callsUsed: {app: 0, judge: 0, total: 0}};
  }
  return report;
}

async function compareRequest(resolved, transport) {
  const {entry, question, request} = resolved;
  const result = {id: entry.id, kind: entry.kind, provenance: entry.provenance, bodySha256: entry.source.sha256, checks: []};
  let reply;
  try { reply = await transport(request); } catch (error) { return {...result, error: String(error.message || error)}; }
  const {rows, invalid} = liveRows(resolved, reply);
  result.invalidReply = invalid;
  if (invalid) result.invalidData = object(reply) ? replyData(reply) ?? null : null;
  const schema = rowSchema(question, request.body);
  const user = requestParts(request.body).user, marker = '\n\nPosting:\n';
  const posting = entry.kind === 'app.enrich' ? user.slice(user.indexOf(marker) + marker.length) : user;
  result.checks = resolved.rows.map(row => {
    const compared = compareAnswer(entry.kind, row.stored, rows.get(row.key), {schema, posting});
    if (invalid) { compared.status = 'changed'; compared.exact = {checked: 0, same: 0}; }
    return {kind: entry.kind, key: row.key, stored: row.stored, live: rows.get(row.key) ?? null, provenance: entry.provenance, ...compared};
  });
  return result;
}

function isChanged(check) {
  if (check.status === 'changed') return true;
  return check.fields.some(field => field.status !== 'same' && canonical(field.stored) !== canonical(field.live));
}

function addResult(report, result) {
  report.results.push(result);
  const kind = report.kinds[result.kind];
  report.callsUsed.app++; report.callsUsed.total++;
  kind.callsUsed.app++; kind.callsUsed.total++;
  const changes = result.checks.filter(isChanged);
  report.changedKeys.push(...changes); kind.changedKeys.push(...changes);
}

function finishCoverage(report) {
  for (const [kind, counts] of Object.entries(report.kinds)) {
    const checks = report.results.filter(result => result.kind === kind).flatMap(result => result.checks);
    counts.checked = new Set(checks.map(check => check.key)).size;
    counts.unjudged = new Set(checks.filter(check => check.fields.some(field => field.status === 'needs-judge')).map(check => check.key)).size;
    for (const key of Object.keys(report.coverage)) report.coverage[key] += counts[key];
  }
  return report;
}

/** Build coverage offline; only a caller-supplied transport can request fresh replies, with no judge calls. */
export async function buildReport({entries = loadRequests(), table = loadTable(), history = {}, limit = 20, transport, stopWhen = () => false, golden = GOLDEN} = {}) {
  // Resolve the entire manifest first: even an unsampled bogus key is an invalid baseline inventory.
  const resolved = entries.map(entry => resolveRequest(entry, {table, golden})), byId = new Map(resolved.map(row => [row.entry.id, row]));
  if (byId.size !== entries.length) throw new Error('duplicate prompt ids');
  const sample = pickSample(entries, history, limit), report = coverageReport(entries, table, sample);
  if (transport) {
    report.mode = 'compare';
    for (const entry of sample) {
      if (stopWhen()) break;
      addResult(report, await compareRequest(byId.get(entry.id), transport));
    }
  }
  return finishCoverage(report);
}
