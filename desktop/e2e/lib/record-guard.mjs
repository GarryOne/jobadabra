// The recording-side guards (owner, 15 Oct 2026, after 7 rows were lost while every check stayed green): what records-publish.mjs refuses to put on the release. Each refusal
// prints why and what to run. Per record, on its own: its page text decodes cleanly (no UTF-8 read as Latin-1), it carries the live run's kept answers, and its own replay reaches
// the step live reached. Against the record it replaces: it must reach at least that one's step or outcome, and a PINNED row (replay-faithful.json) must replay same as live
// before it replaces anything. Only the owner's "<row> — <reason>" (passed as --accept) overrides, for that row only (the replay-accepts.mjs format; never posted by a session).
// The garbled-page definition is the charset repair's own (desktop/lib/net-keep.js repairUnlabeledText, 15 Oct 2026): windows-1252 as well as Latin-1; never a grep for "Ã".
// Pure but for the two folder readers; the replays are run by records-publish.mjs and passed in. Guard: e2e/test/harness/record-guard.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {isSame} from '../replay-records.mjs';
import {acceptNamed} from '../replay-accepts.mjs';
import {rank} from './record-sites.mjs';
import {repairUnlabeledText} from '../../lib/net-keep.js';

// A record folder -> the kept bodies (hash names) that are double-encoded: a text reply with no charset whose stored bytes are the windows-1252 image of its UTF-8 ("dÃ©tail â€“").
// The definition is the repair's own (desktop/lib/net-keep.js repairUnlabeledText, a6's charset fix #812): a body is garbled when repairing it changes it. A missing entry list means no check.
export function mojibakeBodies(dir) {
  const folder = path.join(dir, 'bodies');
  let entries = [];
  try { entries = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')).entries || []; } catch { return []; }
  const bad = new Set();
  for (const entry of entries) {
    if (!entry.hash || bad.has(entry.hash)) continue;
    let body; try { body = fs.readFileSync(path.join(folder, entry.hash)); } catch { continue; }
    if (repairUnlabeledText(body, entry.headers?.['content-type'] || '') !== body) bad.add(entry.hash);
  }
  return [...bad];
}

// A record folder -> '' or why its kept answers are missing: the live run asked (asks.jsonl has lines) but model-memo.json has no answers.
export function memoProblem(dir) {
  const read = name => { try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch { return ''; } };
  const asked = read('asks.jsonl').split('\n').filter(Boolean).length;
  let kept = 0;
  try { const memo = JSON.parse(read('model-memo.json') || '{}'); kept = Array.isArray(memo) ? memo.length : Object.keys(memo.entries || memo.answers || memo).length; } catch { return 'model-memo.json does not parse'; }
  if (!read('model-memo.json')) return asked ? `the live run asked ${asked} time(s) but model-memo.json is missing` : '';
  return asked && !kept ? `the live run asked ${asked} time(s) but model-memo.json keeps no answer` : '';
}

// (the live outcome of the new record's replay, of the replaced one's) -> '' or why the new one is worse: a lower step, or the same step with fewer boxes filled.
export function notWorse(now, old) {
  if (!now || !old) return '';
  if (rank(now.reached) < rank(old.reached)) return `reaches ${now.reached}, the record it replaces reaches ${old.reached}`;
  if (rank(now.reached) === rank(old.reached) && old.filled != null && now.filled != null && now.filled < old.filled) return `fills ${now.filled}, the record it replaces fills ${old.filled}`;
  return '';
}

// A redirect has no body and a font, picture or media file is never an answer the page reads: their lost bodies do not make a replay answer empty.
// A HEAD reply never has a body, and a request the page itself cancelled (a tracking beacon aborted by a navigation) was never read by the page.
// A page (document) the site answered with a 4xx is a refusal, not an answer the page reads (owner, 17 Oct 2026: a third-party widget frame refused with 403 and gone at the navigation held two
// Recruitee recordings back); the replay serves the same refusal. A fetch or xhr 4xx keeps its body (a 422's validation message is read by the page), so its loss still counts.
const NO_ANSWER = entry => /^3\d\d$/.test(String(entry.status)) || /^(font|image|media)$/.test(entry.type || '') || entry.method === 'HEAD' || (entry.type === 'document' && /^4\d\d$/.test(String(entry.status)))
  || (/^(fetch|xhr|ping)$/.test(entry.type || '') && entry.error === 'net::ERR_ABORTED');

// The replies a recording could not read (record.json entries flagged bodyLost by lib/net-record.mjs): -> [host + path, ...]. A record whose reply was lost replays an EMPTY answer where live had one.
export function lostBodies(dir) {
  try { return (JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')).entries || []).filter(entry => entry.bodyLost && !NO_ANSWER(entry)).map(entry => { try { const u = new URL(entry.url); return u.host + u.pathname; } catch { return 'an address'; } }); } catch { return []; }
}

const RUN = (name, why) => `node records-publish.mjs <dir with only this row> --accept "${name} — <reason>" (the owner's word only), or re-record it: ${why}`;

// (items: [{name, dir, replay, replaced}], {pins, accepts: ['<row> — <reason>']}) -> {refusals: [{row, check, why, run}], notes: [text]}.
// replay: this record's own replay result (replay-records fidelity record: outcome, liveOutcome, live, network) or null when none ran;
// replaced: the replay result of the record it would replace, or undefined when there is none to compare with.
export function judgeRecords(items, {pins = [], accepts = []} = {}) {
  const refusals = [], notes = [], names = items.map(item => item.name), entries = accepts.map(text => ({pr: 'owner', text}));
  for (const {name, dir, replay, replaced} of items) {
    const add = (check, why, run = '') => refusals.push({row: name, check, why, run});
    const bad = mojibakeBodies(dir);
    if (bad.length) add('text', `${bad.length} kept page(s) are double-encoded (UTF-8 text stored as a single-byte charset, e.g. body ${bad[0].slice(0, 10)}…)`, 'fix the charset at record time (net-keep.js) and re-record this row');
    const lost = lostBodies(dir);
    if (lost.length) add('answers', `${lost.length} recorded repl${lost.length === 1 ? 'y' : 'ies'} lost ${lost.length === 1 ? 'its' : 'their'} body while recording (the page navigated away right after, e.g. ${lost[0]}): the replay would serve an empty answer`, 're-record this row on a recorder that reads each reply when it arrives (net-record.mjs); never an owner\'s accept');
    const memo = memoProblem(dir);
    if (memo) add('answers', memo, 're-record this row: the live run\'s kept answers must travel with it');
    const accepted = acceptNamed(name, entries, names);   // the owner's named word: it lifts the pinned and worse refusals of this row (acceptedFor), nothing else
    if (!replay) { add('replay', 'its own replay did not run, so nothing proves it reaches the step live reached', 'run it again on the Mac (up to 3 rows at a time)'); continue; }
    const live = replay.liveOutcome, now = replay.outcome;
    if (live && now && rank(now.reached) < rank(live.reached)) add('step', `its replay reaches ${now.reached}, live reached ${live.reached}`, RUN(name, 'the replay must reach the live step'));
    if (pins.includes(name) && !isSame(replay)) add('pinned', `a pinned row must replay same as live before it replaces its record (asks answered ${replay.network?.hit ?? 0}/${replay.live?.asks ?? '?'}, ${replay.network?.extra ?? '?'} extra)`, RUN(name, 'fill-memo, or a better recording'));
    if (replaced === undefined) { if (pins.includes(name)) add('worse', 'the record it replaces was not given, so "not worse" cannot be shown', 'pass --against <dir of the released records> (net-records-fetch.sh)'); else notes.push(`${name}: not compared with the record it replaces (none given)`); continue; }
    const worse = notWorse(replay.liveOutcome, replaced?.liveOutcome);
    if (worse) add('worse', `it ${worse}`, RUN(name, 'a record may not replace a better one'));
    if (accepted && refusals.some(one => one.row === name && ['pinned', 'worse'].includes(one.check))) notes.push(`${name}: its pinned/worse refusal is accepted by the owner (${accepted.reason || 'no reason given'})`);
  }
  return {refusals: refusals.filter(one => !acceptedFor(one, entries, names)), notes};
}

// The owner's named accept covers the pinned and worse checks of that row, never a double-encoded page or missing answers (those cannot be intended).
const acceptedFor = (refusal, entries, names) => ['pinned', 'worse'].includes(refusal.check) && !!acceptNamed(refusal.row, entries, names);

// (the rows, judgeRecords' answer) -> {publish: [rows that passed], refused: [names]}: a refused row never keeps the others back; the caller publishes `publish` and still ends red when `refused` is not empty.
export const partition = (rows, judged) => { const refused = [...new Set(judged.refusals.map(one => one.row))]; return {publish: rows.filter(row => !refused.includes(row.name)), refused}; };

export const report = ({refusals, notes}) => [...refusals.map(one => `refused: ${one.row}: ${one.check}: ${one.why}\n  to proceed: ${one.run}`), ...notes.map(text => `note: ${text}`)].join('\n');

// The two refusals that only mean "this row's live site moved, record it again" (owner, 17 Oct 2026: about 10 rows no longer matched their live sites, so every refill went red): a pinned row that
// no longer replays same as live, and a replay that stops before the step live reached. Everything else (a person's value left after the scrub, double-encoded or lost answers, a record worse than the
// released one, a replay that did not run, a publish error) stays a red failure.
export const NEEDS_RERECORD = ['pinned', 'step'];

// (judgeRecords' answer, rows left by the scrub) -> {rerecord: [{row, why}], hard: [names]}: a row with any other refusal, or a leak, is hard even when it also needs a re-record.
export function classify(judged, leaked = []) {
  const hard = new Set(leaked), soft = new Map();
  for (const one of judged.refusals) { if (NEEDS_RERECORD.includes(one.check)) { if (!soft.has(one.row)) soft.set(one.row, one.why); } else hard.add(one.row); }
  return {rerecord: [...soft].filter(([row]) => !hard.has(row)).map(([row, why]) => ({row, why})), hard: [...hard]};
}
