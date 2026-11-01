// The outcome contract's classifier (owner, 12 Oct 2026; spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 1a): ONE ending per pool row (extension/ladder/endings.js ENDINGS),
// from the row's EXISTING report: where it got to (reached), the notes the run parser wrote (lib/record-sites.mjs parseLive), each required field's outcome and reason (our own trace words,
// extension/page/fill.js, mapped by the fill card's causeOf), and, when given, the extension's own stop line in the row's app log. Never page text. Pure. Guard: e2e/test/ending.test.mjs.
// A row that is not an application outcome is not counted: {ending: null, why}: the harness did not finish, the privacy tripwire, a refused AI, and the TEST's own holds (cc/owner,
// 12 Oct 2026): the pool never presses an account button with fake data (ACCOUNT_HELD), and a CI runner's data-center address meets bot walls a person's would not. Those are shown apart
// ("held by the test, not measured"), never counted resolved. 'handed' is only a real wall the run names: a bot check on a person's address, a sign-in to an existing account (LOGIN_WALL).
import {answeredNoOf, causeOf} from '../../../extension/fill-card.js';
import {CAUSES, ENDINGS, endingOfStuck, resolved} from '../../../extension/ladder/endings.js';
import {ACCOUNT_HELD, APPLY_BY_EMAIL, LOGIN_WALL, PAGE_TELLS, SITE_REFUSED} from './record-sites.mjs';

// The trace words the classifier reads, as the code named writes them (no structured code travels in the report; a guard test checks each is still written there, so a reworded
// reason fails a test instead of silently moving rows: e2e/test/ending.test.mjs). The rest goes through the fill card's causeOf (extension/fill-card.js).
export const REASONS = {legal: 'legal/consent: always your choice', written: 'written: your own words to write', demographic: 'demographic: your own choice',   // extension/page/fill.js
  noSlot: 'no place to attach it was found on this page', noFile: 'upload: no file for this question', details: 'your details'};   // extension/page/fill.js
export const RUN_ERRORS = {dialogLeft: 'a dialog was left open over the form', dialogCovers: 'held: a dialog covers the form', blocked: 'form judge: the page is blocked',
  unreported: 'form fill did not report'};   // desktop/e2e/lib/record-sites.mjs parseLive
const PERSONS = [REASONS.legal, REASONS.written, REASONS.demographic];
// The worst required field decides a form: a field we missed > a control we did not see > a fact only the person has > the person's own choice.
const WORST = ['unresolved', 'blind', 'data_missing', 'ready'];
// data_missing only for a fact we truly lack (no_data). The AI declining or unsure is OUR miss (it could have proposed: cc, 12 Oct 2026): unresolved, counted apart (aiMiss).
const BY_CAUSE = {proposed: 'ready', no_data: 'data_missing', unread: 'blind'};   // any other cause: we missed it
const FIELD_CAUSE = {ready: 'ready', blind: 'control-unseen', data_missing: 'answer-needed', unresolved: 'field-missed'};
const AI_MISS = new Set(['ai_declined', 'ai_unsure']);
export const fieldCause = row => {
  const reason = String(row?.reason || '');
  if (row?.type === 'password' || PERSONS.some(words => reason.startsWith(words))) return 'persons';   // a password is the person's to type (never read by us)
  if (answeredNoOf(row)) return 'persons';   // a "no" kept on an unchecked two-state control is an answer, the same as record-sites verdictOf counts it (15 Oct 2026, Migros)
  if (row?.type === 'file' && reason.startsWith(REASONS.noSlot)) return 'no_slot';   // the upload slot was not seen
  if (row?.type === 'file' && reason.startsWith(REASONS.noFile)) return 'no_data';   // a document we do not have (a motivation letter): the person's to attach, not a slot we missed (Recruitee, 15 Oct 2026)
  return causeOf(row);
};
export function fieldEnding(row) {
  const cause = fieldCause(row);
  return cause === 'persons' ? 'ready' : cause === 'no_slot' ? 'blind' : cause === 'ai_off' ? null : BY_CAUSE[cause] || 'unresolved';   // ai_off: a setting, not an outcome
}
// A form left covered or not counted by the run (the parser's own error lines) is a miss, whatever its fields say. A cookie bar left open at the end is a miss of its own, not
// the application's ending (hand-check 12 Oct 2026: jobs.ch's form was reached and filled under it).
const covers = error => Object.values(RUN_ERRORS).some(words => String(error).startsWith(words));
// The account step the pool never passes (it never creates an account with fake data): the last page is an account page (or account + form) and every required field on it is the
// person's contact details we filled, a password, a consent, or the kit's CV that has no slot there (hand-check 12 Oct 2026: a Workday "Create Account" page the AI called account-form).
const ACCOUNT_KINDS = new Set(['account', 'account-form']);
const accountStep = result => {
  if (!ACCOUNT_KINDS.has((result.path || []).at(-1)?.kind)) return false;
  const required = (result.fieldList || []).filter(row => row?.required);
  const reason = row => String(row.reason || '');
  return required.some(row => row.type === 'password') && required.every(row => row.type === 'password' || reason(row).startsWith(REASONS.legal)
    || (row.outcome === 'filled' && reason(row).startsWith(REASONS.details)) || (row.type === 'file' && reason(row).startsWith(REASONS.noSlot)));
};

// ONE ending rule for a stop (cc's review, 12 Oct 2026): the replays and this classifier both take it from endingOfStuck (extension/ladder/endings.js), so the score and the replays
// cannot drift. A stop is (the reason, whether a need is named). Its source, newest first: the dead-end door's line in the row's app log ("dead end: <why>" with {named}:
// extension/ladder/dead-end.js), then, for a build before the door, the extension's own stop lines (extension/fill-flow.js and ladder/site-broken.js `decide('fill', ...)`), each
// read as the stop it reports (STOP_STUCK). Guarded: a rename fails the test, and e2e/test/ending.test.mjs feeds both views the same stops.
export const STOP_LINES = {email: 'the posting asks for the application by email', told: 'the page tells what to do', botCheck: 'a bot check in front of the page', unreadable: 'the page could not be read', broken: 'a broken page: reported as site_broken',
  other: 'the ladder ended at the person: reported as other', noForm: 'no form on this page', account: 'account page left for Claude'};
export const STOP_STUCK = {email: ['email', true], told: ['told', true], botCheck: ['no-form', true], unreadable: ['site_broken', false], broken: ['site_broken', false], other: ['other', false],
  noForm: ['no-form', false], account: ['account', false]};
const DOOR = /^dead end: ([a-z_-]+) (\{.*\})\s*$/;
export const stopEnding = (why, named) => endingOfStuck(why, named ? 'a named need' : '');
const lastStop = appLog => {
  let found = '';
  for (const line of String(appLog || '').split('\n')) {
    if (!/^\S+ \[extension\] fill: /.test(line)) continue;
    const text = line.replace(/^\S+ \[extension\] fill: /, ''), door = DOOR.exec(text);
    if (door) {
      let data = {};
      try { data = JSON.parse(door[2]); } catch { /* a cut line: no need named */ }
      if (data.level === 'control') continue;   // a control's door (ladder/control-door.js): the page's ending is its own, never a control's
      if (data.shadow === true) continue;   // a dead end SEEN in shadow (extension/ladder/dead-end.js seenDeadEnd): never a stop, skipped by its field, never by its words (cc, 13 Oct 2026)
      found = {why: door[1], named: data.named === true, door: true};
      continue;
    }
    for (const [name, words] of Object.entries(STOP_LINES)) if (text.startsWith(words) && !found?.door) found = {why: STOP_STUCK[name][0], named: STOP_STUCK[name][1], line: words};
  }
  return found;
};

export const HELD_BY_TEST = 'held by the test';
// result: a pool row's result (record-sites.mjs day report). appLog: the row's app log, optional. ci: the row ran on a CI runner. -> {ending, why}
export function endingOf(result, appLog = '', {ci = false} = {}) {
  if (!result || typeof result !== 'object') return {ending: null, why: 'no result'};
  if (result.tripped) return {ending: null, why: 'the privacy tripwire'};
  if (result.aiRefused) return {ending: null, why: 'the AI was refused'};
  const note = String(result.note || ''), reached = String(result.reached || 'none');
  // The harness's notes are stops too: the page's own way (told), a sign-in the run names (handed), a site gone or refusing (site_broken), a bot check on a person's address (handed).
  if (note === APPLY_BY_EMAIL || note === PAGE_TELLS) return {ending: stopEnding(note === APPLY_BY_EMAIL ? 'email' : 'told', true), why: note, cause: note === APPLY_BY_EMAIL ? 'email' : 'told'};
  if (/^eligibility stop/.test(note)) return {ending: stopEnding('told', true), why: 'eligibility stop', cause: 'eligibility'};
  if (note === ACCOUNT_HELD) return {ending: null, why: HELD_BY_TEST, held: 'account-first', cause: 'account-first'};
  if (note === LOGIN_WALL) return {ending: stopEnding('account', true), why: note, cause: 'login-wall'};
  if (/gone \(HTTP \d+\)/.test(note) || note === SITE_REFUSED) return {ending: stopEnding('site_broken', false), why: note, cause: note === SITE_REFUSED ? 'site-refused' : 'site-gone'};
  if (reached === 'code/bot') return ci ? {ending: null, why: HELD_BY_TEST, held: 'bot wall on the CI address', cause: 'bot-wall'} : {ending: stopEnding('no-form', true), why: 'a bot check', cause: 'bot-check'};
  if (reached === 'ready') return {ending: 'ready', why: 'the form is ready', cause: 'ready'};
  if (reached === 'form' && accountStep(result)) return {ending: null, why: HELD_BY_TEST, held: 'account step', cause: 'account-step'};
  if (reached === 'form') {
    const covered = (result.errors || []).find(covers);
    if (covered) return {ending: 'unresolved', why: String(covered).slice(0, 80), cause: 'form-covered'};
    const left = (result.fieldList || []).filter(row => row?.required && row.outcome !== 'filled'), endings = left.map(fieldEnding);
    if (endings.includes(null)) return {ending: null, why: 'the AI was off'};
    const ending = WORST.find(one => endings.includes(one)) || 'ready', worst = left[endings.indexOf(ending)];
    const aiMiss = ending === 'unresolved' && left.some((row, at) => endings[at] === 'unresolved' && AI_MISS.has(fieldCause(row))) && left.every((row, at) => endings[at] !== 'unresolved' || AI_MISS.has(fieldCause(row)));
    return {ending, why: `${left.length} required left${worst ? `; the first ${ending}: ${String(worst.type || 'field').slice(0, 20)}, ${String(worst.reason || 'no reason').slice(0, 80)}` : ''}`, cause: FIELD_CAUSE[ending] === 'field-missed' && aiMiss ? 'ai-miss' : FIELD_CAUSE[ending], ...(aiMiss ? {aiMiss: true} : {})};   // our own trace words, never the page's
  }
  if (Number(result.exit) !== 0 && reached === 'none' && (result.errors || []).length) return {ending: null, why: 'the run did not finish'};
  const stop = lastStop(appLog);
  if (stop) return {ending: stopEnding(stop.why, stop.named), why: stop.door ? `dead end: ${stop.why}` : stop.line, cause: CAUSES[stop.why] ? stop.why : 'other'};
  return {ending: 'unresolved', why: `stopped at ${reached} with no reason`, cause: 'no-reason'};
}

// The word a row's report and its upload carry (fixed words only): an ending, 'held' (held by the test) or '' (not counted).
export const endingWord = found => (found?.ending ? found.ending : found?.why === HELD_BY_TEST ? 'held' : '');
// The fixed word that says why (extension/ladder/endings.js CAUSES) or '' (never page text).
export const causeWord = found => (CAUSES[found?.cause] && endingWord(found) ? found.cause : '');

// The endings of many rows: counts per ending (every ending listed, in the fixed order), the rows held by the test and the other rows not counted (both out of the denominator),
// and the resolution share (resolved / counted).
export function tally(found) {
  const endings = Object.fromEntries(ENDINGS.map(one => [one, 0]));
  let uncounted = 0, held = 0, aiMiss = 0;
  for (const one of found) { if (ENDINGS.includes(one?.ending)) endings[one.ending] += 1; else if (one?.why === HELD_BY_TEST) held += 1; else uncounted += 1; if (one?.aiMiss) aiMiss += 1; }
  const counted = Object.values(endings).reduce((sum, n) => sum + n, 0);
  return {counted, held, uncounted, aiMiss, endings, resolution: counted ? ENDINGS.filter(resolved).reduce((sum, one) => sum + endings[one], 0) / counted : 0};
}
