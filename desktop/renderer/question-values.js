// The saved text of the base-fact kinds that hold more than one part (owner, 17 Oct 2026: "Base facts fixed, AI the rest"): a salary (amount, currency, period,
// net or gross), a duration (a notice period), a work status per country, a language level, a range and a link. Each pair reads the text the store keeps and
// writes it back the same way; text the code cannot read gives empty parts, so the control shows it as it was written and nothing is lost.
// Pure (no DOM): guarded by test/question-kinds-composite.test.js.
import {COMPOSITE} from './question-kind.js';
import {COUNTRY_NAMES, OLDER, STATUSES, isCountry} from './work-eligibility.js';

export {STATUSES};

export const CURRENCIES_ALL = ['CHF', 'EUR', 'USD', 'GBP', 'AED', 'AUD', 'CAD', 'SEK'];
export const PERIODS = ['hour', 'day', 'week', 'month', 'year'];
export const BASES = ['gross', 'net'];
export const UNITS = ['day', 'week', 'month', 'year'];
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'];
export const hasNumber = text => /\d/.test(String(text ?? ''));

const NUMBER = String.raw`(\d[\d'’,.\s]*?)`;
const SALARY = new RegExp(String.raw`^${NUMBER}\s*([A-Z]{3})(?:\s*/\s*(${PERIODS.join('|')}))?(?:\s+(${BASES.join('|')}))?$`);

// "150000 CHF/year gross" -> {number, currency, period, basis}; "95000 CHF" (an amount saved before this kind) has no period.
export function splitSalary(value) {
  const match = String(value ?? '').trim().match(SALARY);
  return match ? {number: match[1].trim(), currency: match[2], period: match[3] || '', basis: match[4] || ''} : {number: '', currency: '', period: '', basis: ''};
}
export function joinSalary({number = '', currency = '', period = '', basis = ''} = {}) {
  return String(number).trim() ? `${String(number).trim()} ${currency}${period ? `/${period}` : ''}${basis ? ` ${basis}` : ''}`.trim() : '';
}

const DURATION = new RegExp(String.raw`^(\d+)\s*(${UNITS.join('|')})s?(,\s*ends at month-end)?$`, 'i');
export function splitDuration(value) {
  const match = String(value ?? '').trim().match(DURATION);
  return match ? {number: match[1], unit: match[2].toLowerCase(), monthEnd: Boolean(match[3])} : {number: '', unit: '', monthEnd: false};
}
export function joinDuration({number = '', unit = '', monthEnd = false} = {}) {
  const count = String(number).trim();
  return count && unit ? `${count} ${unit}${Number(count) === 1 ? '' : 's'}${monthEnd ? ', ends at month-end' : ''}` : '';
}

// Why (28 Oct 2026, owner, #2322): one status per zone or country, the fixed set of renderer/work-eligibility.js; "needs visa" (the older word) reads as
// "no, needs sponsorship", "allowed" (which never said how) stays as written with a Check.
const PERMIT = new RegExp(String.raw`^(${[...STATUSES, ...Object.keys(OLDER)].join('|')})((?:\s*,.*)?)$`, 'i');
const PARTS = /^(?:\s*,\s*valid until\s+(\d{4}-\d{2}-\d{2}))?(?:\s*,\s*only in\s+([^,]+?))?\s*$/i;
// "yes, with a permit, valid until 2027-06-30, only in Switzerland" -> {status, until, only}; text the code cannot read (a part this status cannot hold, a
// country it does not know) -> empty parts, so the line is kept as written, never cut.
export function splitPermit(value) {
  const none = {status: '', until: '', only: ''}, match = String(value ?? '').trim().match(PERMIT);
  if (!match) return none;
  const word = match[1].toLowerCase(), status = word in OLDER ? OLDER[word] : word, parts = match[2].match(PARTS);
  if (!status || !parts || ((parts[1] || parts[2]) && status !== 'yes, with a permit') || (parts[2] && !isCountry(parts[2]))) return none;
  return {status, until: parts[1] || '', only: parts[2] ? COUNTRY_NAMES.find(name => name.toLowerCase() === parts[2].trim().toLowerCase()) : ''};
}
export const joinPermit = ({status = '', until = '', only = ''} = {}) => (STATUSES.includes(status)
  ? [status, status === 'yes, with a permit' && /^\d{4}-\d{2}-\d{2}$/.test(until) && `valid until ${until}`, status === 'yes, with a permit' && isCountry(only) && `only in ${only}`].filter(Boolean).join(', ') : '');

const RANGE = /^(\d{1,3})\s*[-–]\s*(\d{1,3})\s*%?$/;
export function splitRange(value) {
  const match = String(value ?? '').trim().match(RANGE);
  return match ? {from: match[1], to: match[2]} : {from: '', to: ''};
}
export const joinRange = ({from = '', to = ''} = {}) => (String(from).trim() && String(to).trim() ? `${String(from).trim()}–${String(to).trim()} %` : '');

// Only a web address; "javascript:" and the like are never a link.
export const isLink = text => /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(String(text ?? '').trim());

// The saved text of a kind in its own wording, or '' when the code cannot read it (the line then stays as written, with its mark and a "Check").
export function canonical(kind, value) {
  const text = String(value ?? '').trim();
  if (kind === 'salary') return joinSalary(splitSalary(text));
  if (kind === 'duration') return joinDuration(splitDuration(text));
  if (kind === 'per_country') return joinPermit(splitPermit(text));
  if (kind === 'range') return joinRange(splitRange(text));
  if (kind === 'language') return LEVELS.find(level => level.toLowerCase() === text.toLowerCase()) || '';
  return kind === 'link' && isLink(text) ? text : '';
}
// A typed line kept as written (its "Check" chip on Your details, an item of the review queue: lib/details-review.js): one rule for both.
export const needsCheck = (kind, value) => COMPOSITE.includes(kind) && Boolean(String(value ?? '').trim()) && !canonical(kind, value);

// An AI-written canonical text keeps the original's meaning: every number appears once, in the value or in the note (no more, no fewer), the note's pieces are
// copied from the original word for word (pieces are joined with " · "), and a language level is one the original names.
const numbersOf = text => (String(text).match(/\d[\d'’,.]*\d|\d/g) || []).map(each => each.replace(/\D/g, ''));
const squash = text => String(text).replace(/\s+/g, ' ').trim().toLowerCase();
export const NOTE_JOIN = ' · ';
export function faithful(kind, original, text, note = '') {
  if (!canonical(kind, text)) return false;
  const pieces = String(note).split(NOTE_JOIN).map(squash).filter(Boolean);
  if (pieces.some(piece => !squash(original).includes(piece))) return false;
  if (kind === 'salary' || kind === 'duration' || kind === 'range') return [...numbersOf(original)].sort().join('|') === [...numbersOf(text), ...numbersOf(note)].sort().join('|');
  if (kind === 'language') return !note && squash(original).includes(squash(text));
  return !note && String(original).trim() === String(text).trim();
}
