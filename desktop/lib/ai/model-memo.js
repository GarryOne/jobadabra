// The model-call cache of the e2e harness (spec: speed-5x landing 1, owner 11 Oct 2026): a live pool run keeps each answer the model gave, keyed by a hash of the
// request with its volatile parts normalised, so an offline replay of that run gets the same answers at once and asks the model only for what really changed.
// It exists only under the e2e env (JOB_PILOTTO_E2E and JOB_PILOTTO_MODEL_MEMO=<file>): the person's app never memoizes, and never into the app's own folder.
// The file holds the hash and the answer, never the request text. Wired in one place: lib/ai/index.js client(). Guard: desktop/test/model-memo.test.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fakeContacts} from '../live-capture.js';
import {everyRealDataFolder} from '../app-identity.js';

// Volatile parts of a request: an address's query or fragment, a timestamp, a uuid, a long hex id, a run of 6+ digits (an epoch, a job id in a path).
// Short numbers stay (a field id, a count, the digest's [n]); the order of everything stays (a numbered list's number is the answer).
const NORMALISE = [
  [/(https?:\/\/[^\s"'<>?#\\]+)[?#][^\s"'<>\\]*/g, '$1'],
  [/\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)?/g, '<time>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{16,}\b/gi, '<hex>'],
  [/\d{6,}/g, '<n>'],
];
// Contacts last (after the volatile parts, so a long id is not read as a phone), as the page capture scrubs them (lib/live-capture.js fakeContacts): the live run's ask saw the page's real email or phone, its replay sees the
// scrubbed page; both must be one key (11 Oct 2026: every page with an address missed its kept answer).
export const normalise = text => fakeContacts(NORMALISE.reduce((out, [pattern, to]) => out.replace(pattern, to), text));

// The request as the model sees it: model, system, messages, output schema, tools (max_tokens and the like do not change the answer's meaning).
export function memoKey(params = {}) {
  const asked = {model: params.model, system: params.system ?? '', messages: params.messages ?? [], output_config: params.output_config ?? null, tools: params.tools ?? null};
  return crypto.createHash('sha256').update(normalise(JSON.stringify(asked))).digest('hex');
}

// The same request with every pixel size ("width"/"height" in the page's JSON) taken out: a frame's size follows the machine's fonts (14 Oct 2026, coreweave: the
// runner's Greenhouse frame was 6869 px, the Mac's live run 6993, and the replay found no kept answer). Kept as a second key beside the exact one, so a record made
// before it keeps matching by its exact key and a new one also matches on another machine. -> hex
// Both shapes a size takes in a prompt: JSON fields ("height":6993) and the frame line's text (1140x6993; 14 Oct 2026: #713 missed this one, and the same frame
// measured 6993 px live and 6869 in a replay on the same Mac: the size follows when the web fonts land, not the machine alone).
const SIZES = [[/(\\*"(?:width|height)\\*":)\d+(?:\.\d+)?/g, '$1<px>'], [/\b\d{2,5}x\d{2,5}\b/g, '<px>x<px>']];
export const layoutText = text => SIZES.reduce((out, [pattern, to]) => out.replace(pattern, to), text);
export function layoutKey(params = {}) {
  const asked = {model: params.model, system: params.system ?? '', messages: params.messages ?? [], output_config: params.output_config ?? null, tools: params.tools ?? null};
  return crypto.createHash('sha256').update(layoutText(normalise(JSON.stringify(asked)))).digest('hex');
}

// A record made before the size-free key has only exact keys: on a miss, the replay tries the same ask with ONE frame size moved by up to NEAR px (each number of
// each size, one at a time); everything else must match exactly (14 Oct 2026: Databricks' frame 1430 px on the runner, 1426 live; coreweave 6869 vs 6993).
// Runs on a miss only: at most a few thousand hashes. -> the kept key, or ''
export const NEAR = 200;
const SIZE_NUMBERS = /(\\*"(?:width|height)\\*":)(\d+)|\b(\d{2,5})x(\d{2,5})\b/g;
export function nearSizeKey(params = {}, kept = {}, near = NEAR) {
  const asked = {model: params.model, system: params.system ?? '', messages: params.messages ?? [], output_config: params.output_config ?? null, tools: params.tools ?? null};
  const text = normalise(JSON.stringify(asked)), spots = [];
  for (const found of text.matchAll(SIZE_NUMBERS)) {
    if (found[1]) spots.push({at: found.index + found[1].length, value: found[2]});
    else { spots.push({at: found.index, value: found[3]}); spots.push({at: found.index + found[3].length + 1, value: found[4]}); }
  }
  for (const spot of spots.slice(0, 8)) {
    for (let step = 1; step <= near; step++) {
      for (const moved of [Number(spot.value) - step, Number(spot.value) + step]) {
        if (moved < 0) continue;
        const key = crypto.createHash('sha256').update(text.slice(0, spot.at) + moved + text.slice(spot.at + spot.value.length)).digest('hex');
        if (kept[key]) return key;
      }
    }
  }
  return '';
}

// The request's PARTS, as short hashes (never text): the model, each system block, and the user message cut by its <tag> blocks (or, for a message without tags, by its "Label:" lines).
// Kept beside each answer, so a replay's miss can say WHICH part differs from the live ask ("job differs", "system:1 differs") instead of only "not in its kept answers" (12 Oct 2026, Ashby).
const TAGGED = /<([a-z_]+)>([\s\S]*?)<\/\1>/g;
const piece = text => crypto.createHash('sha256').update(normalise(String(text))).digest('hex').slice(0, 12);
const textOf = content => (Array.isArray(content) ? content.map(block => block?.text ?? '').join('\n') : String(content ?? ''));
// The request cut into its named parts: add(name, text) for each (a part name repeated gets #2, #3). Shared by the hashes and the clock-time check.
function walkParts(params, add) {
  const system = params.system ?? '';
  const blocks = Array.isArray(system) ? system.map(block => block?.text ?? '') : [system];
  blocks.forEach((text, i) => { const at = Array.isArray(system) ? `system:${i}` : 'system'; add(at, text); for (const [, tag, inner] of text.matchAll(TAGGED)) add(`${at}:${tag}`, inner); });   // a system block's own <tag> sections too: which one differs
  for (const message of params.messages ?? []) {
    const text = textOf(message.content), tagged = [...text.matchAll(/<([a-z_]+)>([\s\S]*?)<\/\1>/g)];
    if (tagged.length) { for (const [, tag, inner] of tagged) add(`${message.role}:${tag}`, inner); const rest = text.replace(/<([a-z_]+)>[\s\S]*?<\/\1>/g, '').trim(); if (rest) add(`${message.role}:rest`, rest); }
    else for (const line of text.split('\n')) add(`${message.role}:${/^([A-Za-z][^:]{0,30}):/.exec(line)?.[1] || 'line'}`, line);
  }
  add('output', JSON.stringify([withoutAdded(params.output_config ?? null), params.tools ?? null]));
}
// Schema properties added after captures were made, whose absence the code handles (an older answer without it keeps its old meaning): left out of the
// parts' output hash only (the exact key keeps them), so a row case's kept answer still matches loosely. Dated; add one only with that handling in place.
export const ADDED_SCHEMA_KEYS = {fact: '2026-10-12: the saved fact a form answer rests on (worker/src/answer-facts.js; no fact = as before)',
  pay_asks: '2026-10-15: a salary asked in another currency or period, converted by the code (worker/src/pay-convert.js; none = as before)'};
function withoutAdded(value) {
  if (Array.isArray(value)) return value.map(withoutAdded).filter(item => !(typeof item === 'string' && item in ADDED_SCHEMA_KEYS));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !(key in ADDED_SCHEMA_KEYS)).map(([key, item]) => [key, withoutAdded(item)]));
}
export function memoParts(params = {}) {
  const parts = {model: piece(params.model ?? '')};
  walkParts(params, (name, text) => { let at = name, n = 1; while (at in parts) at = `${name}#${++n}`; parts[at] = piece(text); });
  return parts;
}
// The parts whose text carries a clock time or a date after the key's own normalisation (an ISO timestamp is already ignored): "kept from Notion (16:17)" in a prompt means no memo can ever match it
// (12 Oct 2026: the review ask's contact details). A prompt should carry no clock time: fix it at the source, not in the key. -> [part name]
const CLOCK = /\b\d{1,2}:\d\d\b|\b\d{4}-\d\d-\d\d\b/;
export function volatileParts(params = {}) {
  const names = [];
  walkParts(params, (name, text) => { if (CLOCK.test(normalise(String(text))) && /^(system|user|assistant)/.test(name)) names.push(name.replace(/#\d+$/, '')); });
  return [...new Set(names)];
}
// The hash of each line of every <tag> section of the system blocks and the user message: {"system:1:profile": [hash, ...]}, kept beside the answer (hashes only), so a miss can say WHICH LINE of a
// section differs from the live ask (12 Oct 2026: a profile block differed and nothing said where).
export function memoLines(params = {}) {
  const lines = {}, system = params.system ?? '', blocks = Array.isArray(system) ? system.map(block => block?.text ?? '') : [system];
  const section = (name, text) => { lines[name] = String(text).split('\n').map(piece); };
  blocks.forEach((text, i) => { for (const [, tag, inner] of text.matchAll(TAGGED)) section(`${Array.isArray(system) ? `system:${i}` : 'system'}:${tag}`, inner); });
  for (const message of params.messages ?? []) for (const [, tag, inner] of textOf(message.content).matchAll(TAGGED)) section(`${message.role}:${tag}`, inner);
  return lines;
}
// The kept ask nearest to this one (fewest differing parts), among the answers kept with their parts: -> the names of the parts that differ, or null when none was kept with parts.
// -> the names of the parts that differ, with, for a section whose line hashes were kept, the lines that differ ("system:1:profile (lines 33-34)"); or null.
export function nearestDiffers(parts, kept, lines = {}) {
  let best = null, bestKey = '';
  for (const [name, other] of Object.entries(kept)) {
    if (!name.endsWith(PARTS)) continue;
    const names = new Set([...Object.keys(parts), ...Object.keys(other)]), differs = [...names].filter(part => parts[part] !== other[part]);
    if (!best || differs.length < best.length) { best = differs; bestKey = name.slice(0, -PARTS.length); }
  }
  if (!best) return null;
  const was = kept[bestKey + LINES] || {};
  return best.map(part => {
    const mine = lines[part], theirs = was[part];
    if (!mine || !theirs) return part;
    const changed = []; for (let at = 0; at < Math.max(mine.length, theirs.length); at++) if (mine[at] !== theirs[at]) changed.push(at + 1);
    return changed.length ? `${part} (lines ${changed.length > 3 ? `${changed[0]}-${changed.at(-1)}, ${changed.length} in all` : changed.join(', ')} of ${mine.length})` : part;
  });
}
const PARTS = '#parts', LINES = '#lines', VOLATILE = '#volatile', MS = '#ms', LAYOUT = '#layout';   // <layoutKey>#layout -> the exact key

const insideRealData = file => everyRealDataFolder().some(real => (path.resolve(file) + path.sep).startsWith(path.resolve(real) + path.sep));

// -> the cache file for this process, or '' (no cache).
export function memoFile(env = process.env) {
  const file = env.JOB_PILOTTO_E2E ? String(env.JOB_PILOTTO_MODEL_MEMO || '') : '';
  return file && !insideRealData(file) ? file : '';
}

// Memo-only (an offline row replay, e2e/lib/offline-app.mjs): a miss is refused, never asked: the plan's claude -p carries the signed-in account (11 Oct 2026:
// a form answer guessed the owner's name from it), so an offline replay answers only what the live run already asked.
export const memoOnly = (env = process.env) => !!env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_MODEL_MEMO_ONLY === '1';

// Fill (an ask the recording lacks, spec record-once "An ask the recording does not have"): a memo-only replay on the MAC that asks the model for the asks the memo lacks
// (a fix changed what the app asks) and keeps each answer in the memo, so the next replay hits it; a kept ask is still served as before, never asked again.
// e2e env + memo-only + JOB_PILOTTO_MODEL_MEMO_FILL=1, never on CI (no claude -p there). The plan path carries the owner's identity: the caller's tripwire and the fake applicant stay on.
// CI only through the refill workflow's own flag (JP_REFILL_CI, e2e/lib/refill.mjs: its own API key, replay-refill.yml): the asks then go to the API, not the plan.
export const fillOn = (env = process.env) => memoOnly(env) && env.JOB_PILOTTO_MODEL_MEMO_FILL === '1' && ((!env.CI && !env.GITHUB_ACTIONS) || env.JP_REFILL_CI === '1');

// Loose lookup (owner, 12 Oct 2026): the CI replay of a row case (e2e/lib/row-case-run.mjs) and `npm run row --loose` serve a kept answer whose USER-message parts and output schema match although the system side
// (instructions, profile, search, knowledge) or the model changed since the capture: a prompt or seed change would otherwise turn every row case's answer asks cold, and CI has no claude -p. Each such hit is
// appended to the file named by JOB_PILOTTO_MODEL_MEMO_LOOSE (e2e only) with the parts that differ. A changed job / form_fields block is still a miss.
// JOB_PILOTTO_MODEL_MEMO_MISSLOG=<file> (e2e only): each memo-only miss as a JSON line {differs, volatile}, whole (a log line is cut at its length: "differs in use) {"). Read by the row replay.
// JOB_PILOTTO_MODEL_MEMO_LATENCY=1 (e2e only): a replay serves a kept answer after the time the live ask took (recorded as `<key>#ms`, at most LATENCY_CAP_MS): the extension's concurrent flows (a popup dismissed
// while the page-kind ask is out, a widget reacting to the upload) then interleave as they did live, not by how fast this machine answers (12 Oct 2026: a row case green on a Mac, red on the Linux runner).
export const latencyOn = (env = process.env) => !!env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_MODEL_MEMO_LATENCY === '1';
export const LATENCY_CAP_MS = 3000;
// JOB_PILOTTO_MODEL_MEMO_LATENCY_CAP_MS (e2e only): a network replay serves each kept answer at its live time, uncapped (lib/net-record.mjs: the extension's pace as live).
const latencyCap = env => Number(env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_MODEL_MEMO_LATENCY_CAP_MS) || LATENCY_CAP_MS;
// JOB_PILOTTO_MODEL_MEMO_LATENCY_SCALE / _PAD_MS (e2e only): a slowed replay (row-to-case's second speed): every kept answer takes SCALE times as long and PAD ms more, also one with no recorded time.
const later = (ms, env) => { const wait = Math.min(latencyCap(env), Math.max(0, ms || 0) * (Number(env.JOB_PILOTTO_MODEL_MEMO_LATENCY_SCALE) || 1)) + (Number(env.JOB_PILOTTO_MODEL_MEMO_LATENCY_PAD_MS) || 0); return wait > 0 ? new Promise(resolve => setTimeout(resolve, wait)) : null; };
// JOB_PILOTTO_MODEL_MEMO_ORDINAL=<file> (e2e only; CI's row cases, never the row-to-case proof): an ask with no kept answer, exact or loose, gets the n-th kept answer of its kind (same model and system prompt), n = how many
// asks of that kind this replay has made; each is noted in the file. A row case then holds in CI whatever the order the extension's concurrent flows ask in (12 Oct 2026), and the run prints it as a warning.
export const ordinalFile = (env = process.env) => (env.JOB_PILOTTO_E2E ? String(env.JOB_PILOTTO_MODEL_MEMO_ORDINAL || '') : '');
const kindOf = parts => `${parts.model}|${parts.system ?? parts['system:0'] ?? ''}`;
export const missLogFile = (env = process.env) => (env.JOB_PILOTTO_E2E ? String(env.JOB_PILOTTO_MODEL_MEMO_MISSLOG || '') : '');
export const looseFile = (env = process.env) => (env.JOB_PILOTTO_E2E ? String(env.JOB_PILOTTO_MODEL_MEMO_LOOSE || '') : '');
const isPageSide = name => name === 'output' || /^(user|assistant):/.test(name);
export function looseMatch(parts, kept) {
  const mine = Object.entries(parts).filter(([name]) => isPageSide(name));
  let found = null;
  for (const [name, other] of Object.entries(kept)) {
    if (!name.endsWith(PARTS)) continue;
    const theirs = Object.entries(other).filter(([part]) => isPageSide(part));
    if (mine.length !== theirs.length || !mine.every(([part, hash]) => other[part] === hash)) continue;
    found = {key: name.slice(0, -PARTS.length), differs: [...new Set([...Object.keys(parts), ...Object.keys(other)])].filter(part => parts[part] !== other[part])};
  }
  return found;
}

const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };

// Wraps the client's messages.create in place (the adapter keeps its engine, billing, fallback). A failed ask is not kept. -> the same client.
export function withMemo(client, file = memoFile(), {only = memoOnly(), fill = fillOn(), loose = looseFile(), missLog = missLogFile(), latency = latencyOn(), env = process.env, ordinal = ordinalFile(env)} = {}) {
  if (!client || !file) return client;
  const served = {};   // asks made per kind (ordinal)
  const ask = client.messages.create.bind(client.messages);
  client.messages = {...client.messages, create: async (params, options) => {
    const exact = memoKey(params), kept = read(file), alias = kept[layoutKey(params) + LAYOUT], sized = kept[exact] ? exact : alias && kept[alias] ? alias : only ? nearSizeKey(params, kept) : '', key = sized || exact, parts = ordinal ? memoParts(params) : null, kind = parts ? kindOf(parts) : '';
    if (ordinal) served[kind] = (served[kind] || 0) + 1;
    // An offline replay serves the page scrubbed (lib/live-capture.js fakeContacts): the answer the AI gave to the live page is scrubbed the same way, so an address it
    // read off the page (apply_email) is still on the replayed page.
    // JOB_PILOTTO_MODEL_MEMO_HITS=<file> (e2e only): each kept answer served, by key: a replay counts which of the live run's asks it made.
    if (kept[key] && only && env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_MODEL_MEMO_HITS) try { fs.appendFileSync(env.JOB_PILOTTO_MODEL_MEMO_HITS, `${key}\n`); } catch { /* a report only */ }
    if (kept[key]) { if (only && latency) await later(Number(kept[key + MS]), env); return only ? JSON.parse(fakeContacts(JSON.stringify(kept[key]))) : kept[key]; }
    if (only && loose) {
      const hit = looseMatch(memoParts(params), kept);
      if (hit) {
        try { fs.appendFileSync(loose, `${JSON.stringify({differs: hit.differs})}\n`); } catch { /* the count is a report only */ }
        if (latency) await later(Number(kept[hit.key + MS]), env);
        return JSON.parse(fakeContacts(JSON.stringify(kept[hit.key])));
      }
    }
    if (only && ordinal) {
      // Among the kept answers of the kind (several variants of one ask: each cold round records the ask a little differently) the one whose parts differ from this ask in the FEWEST places; a tie goes by order (the n-th).
      const same = Object.entries(kept).filter(([name, other]) => name.endsWith(PARTS) && kindOf(other) === kind).map(([name, other]) => ({key: name.slice(0, -PARTS.length), gap: [...new Set([...Object.keys(parts), ...Object.keys(other)])].filter(part => parts[part] !== other[part]).length}));
      const best = Math.min(...same.map(item => item.gap)), tied = same.filter(item => item.gap === best), taken = served[kind] <= same.length ? (tied[Math.min(served[kind] - 1, tied.length - 1)] || {}).key : '';   // more asks of the kind than the live run made: a miss (a retry loop must not be fed for ever)
      if (taken && kept[taken]) {
        try { fs.appendFileSync(ordinal, `${JSON.stringify({n: served[kind], of: same.length, differs: nearestDiffers(parts, kept, memoLines(params)) || []})}\n`); } catch { /* a report only */ }
        if (latency) await later(Number(kept[taken + MS]), env);
        return JSON.parse(fakeContacts(JSON.stringify(kept[taken])));
      }
    }
    if (only && !fill) {
      // JOB_PILOTTO_MODEL_MEMO_MISSES=<file> (e2e only): the normalised request of each miss, to see what differs from the live run's ask.
      if (process.env.JOB_PILOTTO_E2E && process.env.JOB_PILOTTO_MODEL_MEMO_MISSES) try { fs.appendFileSync(process.env.JOB_PILOTTO_MODEL_MEMO_MISSES, `${normalise(JSON.stringify({model: params.model, system: params.system ?? '', messages: params.messages ?? [], output_config: params.output_config ?? null, tools: params.tools ?? null}))}\n`); } catch { /* a debug aid */ }
      const differs = nearestDiffers(memoParts(params), kept, memoLines(params)), volatile = volatileParts(params);
      if (missLog) try { fs.appendFileSync(missLog, `${JSON.stringify({differs: differs || [], volatile})}\n`); } catch { /* a report only */ }
      throw new Error(`model memo: not in the row's kept answers (an offline replay never asks the model)${differs ? `; the nearest kept ask differs in: ${differs.join(', ') || 'nothing I can see (the same parts)'}` : ''}${volatile.length ? `; a clock time or date in ${volatile.join(', ')} can never match` : ''}`);
    }
    const askedAt = Date.now(), answer = await ask(params, options), tookMs = Date.now() - askedAt;
    try {
      fs.mkdirSync(path.dirname(file), {recursive: true});
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({...read(file), [key]: answer, [layoutKey(params) + LAYOUT]: key, [key + PARTS]: memoParts(params), [key + LINES]: memoLines(params), [key + MS]: tookMs, ...(volatileParts(params).length ? {[key + VOLATILE]: volatileParts(params)} : {})}));
      fs.renameSync(tmp, file);
    } catch { /* the cache is only a speed-up */ }
    return answer;
  }};
  return client;
}
