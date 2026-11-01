// Job: report health
// The shadow question's agree / would_act / worse table (spec docs/superpowers/specs/2026-10-12-one-next-move.md, switch-on criteria per dead end): every real stop of a pool row ("dead end: <why>", the
// door's id in its fields) joined by that id to the question the fallback asked at it ("dead end fallback (shadow)", the same `door`), and judged from the row's REAL ending, never by hand:
//   not_asked  the question did not run (the digest was asked already, the page moved on, or the line is missing)
//   agree      the fallback would not act (a person is needed, the way is not listed, unsure, a floor refused, one ask, two asks disagreed): it says what the stop said
//   would_act     the fallback would act (sure, past the floors, two agreeing asks) where the stop was unresolved: a move the stop did not make; a candidate until the CI pool acts (box 8)
//   worse      the fallback would act where the stop handed the page to the person (ending handed): any such row blocks the switch-on
// A silent stop (seen in shadow, `shadow: true` plus a door id) is a stop of its own kind ('silent'): the question is asked at it too (owner, 13 Oct 2026); a seen notice with no door id is not a stop. The page kind the run judged last is kept on the stop (an account page is told apart for the acting run's judgement). Pure: callers provide the logs; lib/measure.mjs reads captures. Guard: e2e/test/pool/pool-shadow.test.mjs.
const STOP = /^(\S+Z) \[extension\] fill: dead end: ([a-z_-]+) (\{.*\})\s*$/;
const KIND = /^(\S+Z) \[extension\] fill: page kind: ([a-z_-]+) /;   // the page kind the run judged last: an account page is any kind that starts with "account"
const PICTURE = /^(\S+Z) \[extension\] fill: dead end fallback \(picture\) (\{.*\})\s*$/;   // the look with the picture after "asked already" (ladder/fallback.js, CI pool only)
const ASKED = /^(\S+Z) \[extension\] fill: dead end fallback \(shadow\)(?:: ([a-z ]+))? (\{.*\})\s*$/;
const parsed = text => { try { return JSON.parse(text); } catch { return {}; } };

// appLog -> [{door, why, ending, host, asked: 'fields' | 'asked already' | 'the page moved on' | '', actWhy, wouldAct, agree, confidence, verb, number, usd}], one per real stop, in log order
export function stopsOf(appLog = '') {
  const stops = [], asks = new Map(), looks = new Map();
  let page = '';
  for (const text of String(appLog).split('\n')) {
    const stop = STOP.exec(text), ask = ASKED.exec(text), kind = KIND.exec(text), look = PICTURE.exec(text);
    if (look) { const fields = parsed(look[2]); if (Number.isInteger(fields.door)) looks.set(fields.door, String(fields.look || '')); }
    if (kind) page = kind[2].startsWith('account') ? 'account' : kind[2];
    // a stop the run admitted, or a silent one SEEN in shadow (it has a door id once the question is asked at it: a seen notice without one is not a stop)
    if (stop && parsed(stop[3]).level === 'control') continue;   // a control's door (ladder/control-door.js): no page question is asked there
    if (stop) { const fields = parsed(stop[3]); if (fields.shadow !== true || Number.isInteger(fields.door)) stops.push({door: fields.door, why: stop[2], ending: fields.ending || '', host: fields.host || '', page}); }
    else if (ask) { const fields = parsed(ask[3]); if (Number.isInteger(fields.door)) asks.set(fields.door, {note: ask[2] || '', fields}); }
  }
  return stops.map(stop => {
    const ask = asks.get(stop.door), fields = ask?.fields || {};
    const asked = !ask ? 'missing' : ask.note ? ask.note : 'asked';
    return {...stop, asked, actWhy: fields.actWhy || '', wouldAct: fields.wouldAct === true, agree: fields.agree, confidence: fields.confidence ?? -1, verb: fields.verb || '', look: looks.get(stop.door) || '', number: fields.number ?? -1, usd: Number(fields.usd) || 0};
  });
}

// One stop -> 'not_asked' | 'agree' | 'would_act' | 'worse'
export function verdictOf(stop) {
  if (stop.asked !== 'asked') return 'not_asked';
  if (!stop.wouldAct) return 'agree';   // at an account page, handing the page to the person (sign in / create account) is agree; a move that would act there is NOT judged here: the floors already refuse sign-in, register, create-account and "apply with" (tab-pages.js NOT_APPLY), the one press that passes (guest / without an account) is judged by its effect in the acting run (worse = it led to a sign-in or password page, or left the application; owner, 13 Oct 2026)
  return stop.ending === 'handed' ? 'worse' : 'would_act';
}

// rows: [{row, log}] -> {byWhy: {why: {agree, would_act, worse, not_asked}}, total, worse: [{row, door, why}], would_act: [...], usd}
export function shadowTable(rows = []) {
  const byWhy = {}, worse = [], would_act = [];
  let total = 0, usd = 0;
  for (const {row, log} of rows) for (const stop of stopsOf(log)) {
    const verdict = verdictOf(stop), entry = byWhy[stop.why] ||= {agree: 0, would_act: 0, worse: 0, not_asked: 0};
    entry[verdict]++; total++; usd += stop.usd;
    if (verdict === 'worse') worse.push({row, door: stop.door, why: stop.why});
    if (verdict === 'would_act') would_act.push({row, door: stop.door, why: stop.why});
  }
  return {byWhy, total, worse, would_act, usd: Math.round(usd * 1e6) / 1e6};
}

// The person verb (phase 3, step 1 "name the hand-off": when the answer is "person" the panel says the need at once; shadow evidence is enough): its PRECISION on the pooled stops, judged by where
// the row ended. A row that went on to the form without a person made "person" wrong; wrong at confidence >= 0.8 is wrong-and-confident, which the criterion allows none of. A row with no
// final reading is unjudged. rows: [{row, log, reached}] -> {answers, judged, right, wrong, wrongConfident, unjudged}
export function personPrecision(rows = []) {
  const out = {answers: 0, judged: 0, right: 0, wrong: 0, wrongConfident: 0, unjudged: 0};
  for (const {log, reached} of rows) for (const stop of stopsOf(log)) {
    const person = (stop.asked === 'asked' && stop.verb === 'tell_person') || stop.look === 'ask_person';   // the digest said "tell the person", or the look with the picture said "ask the person" (no confidence there: counted as confident)
    if (!person) continue;
    out.answers++;
    if (!reached) { out.unjudged++; continue; }
    out.judged++;
    if (reached === 'form') { out.wrong++; if (stop.look === 'ask_person' || stop.confidence >= 0.8) out.wrongConfident++; } else out.right++;
  }
  return out;
}
