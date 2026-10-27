// A question's kind of answer (owner, 17 Oct 2026: "'Accept GDPR consent' cannot be answered in a text field ... if they require dropdown/selectbox,
// then show it properly"): text, long text, pick one, pick several or yes/no, and the form's own options. Read from the fill's field type (structure,
// never words), kept in the store as a mark at the end of the question's line ("Title: <mark> (asked by Adnovum) [pick one: Mr | Mrs | Ms]"), the same text
// on every adapter. Spec docs/superpowers/specs/2026-10-17-base-facts.md. Pure (no DOM): guarded by test/question-kind.test.js.
import {countryNames} from './countries.js';

export const KINDS = ['text', 'long_text', 'single', 'multi', 'yes_no', 'date', 'amount', 'salary', 'duration', 'link', 'per_country', 'language', 'range'];
// What the AI may judge from a label. per_country, language and range are base facts' own controls (renderer/question-values.js): never the AI's pick.
export const AI_KINDS = KINDS.filter(kind => !['per_country', 'language', 'range'].includes(kind));
// A kind whose answer has parts: its control is drawn by renderer/question-control-composite.js.
export const COMPOSITE = ['salary', 'duration', 'link', 'per_country', 'language', 'range'];
// Raise it when a kind is added: the AI's older judgments (stamped lower, or not at all) are asked again, lazily and once (lib/question-formats.js ensure).
export const KINDS_VERSION = 4;   // 2: date and amount; 3: salary, duration, link; 4: distinguish calendar dates from durations and prose
const WORDS = {long_text: 'long text', single: 'pick one', multi: 'pick several', yes_no: 'yes/no', date: 'date', amount: 'amount', salary: 'salary', duration: 'duration', link: 'link',
  per_country: 'per country', language: 'language', range: 'range'};
const KIND_OF_WORD = Object.fromEntries(Object.entries(WORDS).map(([kind, word]) => [word, kind]));
export const YES_NO = ['Yes', 'No'];
export const CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP'];   // an amount question with no currencies of its own
// A short list rides in the store; a long menu (a country list) is kept on this Mac (lib/question-formats.js), rebuilt by the next fill.
export const STORED_OPTIONS = 8, STORED_CHARS = 160;
const MAX_OPTIONS = 60;
const COUNTRY = 'pick a country';   // a single choice among the countries (renderer/countries.js), however the form named them
const MARK = /\s*\[(long text|pick one|pick several|yes\/no|pick a country|date|amount|salary|duration|link|per country|language|range)(\s*\+\s*constraints)?(?::\s*([^\]]*))?\]\s*$/;

const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();
export function cleanOptions(options) {
  const seen = new Set(), out = [];
  for (const option of Array.isArray(options) ? options : []) {
    const text = clean(typeof option === 'object' && option ? option.text ?? option.label : option).slice(0, 120);
    if (text && !seen.has(text.toLowerCase())) { seen.add(text.toLowerCase()); out.push(text); }
  }
  return out.slice(0, MAX_OPTIONS);
}

// A fill's field ({type, options, multiple}, extension/page/fill-read.js) -> {kind, options}. A lone checkbox is a yes/no.
export function formatOfField({type = '', options = [], multiple = false} = {}) {
  const t = String(type).toLowerCase();
  if (t === 'textarea') return {kind: 'long_text', options: []};
  if (t === 'date') return {kind: 'date', options: []};
  if (t === 'number') return {kind: 'amount', options: []};   // by structure only: a number box, never its label's words
  if (t === 'checkbox') return {kind: 'yes_no', options: []};
  if (t === 'checkbox-group') return {kind: 'multi', options: cleanOptions(options)};
  if (t === 'select' || t === 'radio' || t === 'combobox') return {kind: multiple ? 'multi' : 'single', options: cleanOptions(options)};
  return {kind: 'text', options: []};
}

// {kind, options} -> the mark the store keeps ('' for a text question). Options go in only when the list is short and none holds a | or ].
export function markOf({kind = 'text', options = [], list = '', constraints = false} = {}) {
  if (!WORDS[kind]) return '';
  if (kind === 'single' && list === 'countries') return `[${COUNTRY}]`;
  if (kind === 'date') return constraints ? '[date + constraints]' : '[date]';
  const picks = kind === 'yes_no' || kind === 'date' || COMPOSITE.includes(kind) ? [] : cleanOptions(options);
  const joined = picks.join(' | ');
  const fits = picks.length && picks.length <= STORED_OPTIONS && joined.length <= STORED_CHARS && !picks.some(option => /[|\]]/.test(option));
  return `[${WORDS[kind]}${fits ? `: ${joined}` : ''}]`;
}

// "Title: Mr [pick one: Mr | Mrs]" -> {text: 'Title: Mr', kind: 'single', options: ['Mr', 'Mrs'], marked: true}; no mark -> {text, kind: '', options: [], marked: false}.
export function splitMark(text) {
  const raw = String(text ?? '');
  const match = raw.match(MARK);
  if (!match) return {text: raw, kind: '', options: [], marked: false};
  if (match[1] === COUNTRY) return {text: raw.slice(0, match.index), kind: 'single', list: 'countries', options: [], marked: true};
  const kind = KIND_OF_WORD[match[1]];
  const found = {text: raw.slice(0, match.index), kind, options: kind === 'yes_no' || kind === 'date' || COMPOSITE.includes(kind) ? [] : cleanOptions((match[3] || '').split('|')), marked: true};
  return kind === 'date' ? {...found, constraints: Boolean(match[2])} : found;
}

// The text with its mark set to this format (a text format removes the mark).
export function withMark(text, format) {
  const mark = markOf(format || {});
  const bare = splitMark(text).text.replace(/\s+$/, '');
  return mark ? `${bare} ${mark}` : bare;
}

// Which format a row is answered with: the store's mark first, then what this Mac kept (the last fill's, else the AI's judgment), else text.
// A yes/no always offers Yes and No; a choice with no known options is answered as text (its kind is kept).
export function formatFor({marked = null, kept = null, locale = 'en'} = {}) {
  const from = marked?.kind ? marked : kept?.kind ? kept : {kind: 'text', options: []};
  const kind = KINDS.includes(from.kind) ? from.kind : 'text';
  const list = kind === 'single' && (from.list || (kept?.kind === kind && kept.list)) === 'countries' ? 'countries' : '';
  const own = cleanOptions(from.options?.length ? from.options : kept?.kind === kind ? kept.options : []);
  const options = kind === 'yes_no' ? YES_NO : list ? countryNames(locale) : kind === 'amount' || kind === 'salary' ? (own.length ? own : CURRENCIES) : kind === 'date' || COMPOSITE.includes(kind) ? [] : own;
  const constraints = kind === 'date' && Boolean(from.constraints || kept?.constraints);
  const control = kind === 'yes_no' ? 'yes_no' : kind === 'long_text' ? 'textarea' : kind === 'date' || kind === 'amount' || COMPOSITE.includes(kind) ? kind : (kind === 'single' || kind === 'multi') && options.length ? kind : 'text';
  return {kind, list, options, constraints, control};
}

// The mark a drawn format writes to the store (a text question: none): {kind, options, list} | null.
export const markFor = format => (!format || !WORDS[format.kind] ? null : {kind: format.kind, options: format.list || format.kind === 'yes_no' || format.kind === 'date' || COMPOSITE.includes(format.kind) ? [] : format.options || [],
  ...(format.list ? {list: format.list} : {}), ...(format.kind === 'date' && format.constraints ? {constraints: true} : {})});

// A multi answer is stored as one line: "A, B"; read back into its picks (only those that are options).
export const joinPicks = picks => picks.filter(Boolean).join(', ');
export const picksOf = (value, options) => options.filter(option => String(value || '').split(/\s*,\s*/).some(part => part.toLowerCase() === option.toLowerCase()));

// A proposed answer as the row's control can take it: the option that names it (a pick: each part), else '' (the person answers); a text box takes any value.
export function proposalIn(value, {control = 'text', options = []} = {}) {
  const text = String(value || '').trim();
  if (control === 'text' || control === 'textarea' || control === 'date' || control === 'amount' || COMPOSITE.includes(control)) return text;
  if (control === 'multi') return joinPicks(picksOf(text, options));
  return options.find(option => option.toLowerCase() === text.toLowerCase()) || '';
}

// The words a person reads for a kind (the "Answer as" choice).
export const KIND_NAMES = {text: 'Text', long_text: 'Long text', single: 'Pick one', multi: 'Pick several', yes_no: 'Yes / No', date: 'Date', amount: 'Amount', salary: 'Salary', duration: 'Duration', link: 'Link', per_country: 'Work status per country', language: 'Language level', range: 'Range'};

// A date is saved in the person's words ("1 December 2026"), the form's own fields take it as written; a date input reads ISO (2026-12-01).
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function dateWords(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match && MONTHS[Number(match[2]) - 1] ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : '';
}
export function dateIso(text) {
  const raw = String(text || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === raw ? raw : '';
  }
  const match = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  const month = match ? MONTHS.findIndex(name => name.toLowerCase() === match[2].toLowerCase()) : -1;
  if (month < 0) return '';
  const iso = `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso ? iso : '';
}
// A date question that also asks about constraints: "1 December 2026; no constraints" or "1 December 2026; <the constraints>". constraints: '' (not chosen yet), 'none' or text.
export function splitConstraints(value) {
  const raw = String(value || ''), at = raw.indexOf(';');
  if (at < 0) return {date: raw.trim(), constraints: ''};
  const rest = raw.slice(at + 1).trim();
  return {date: raw.slice(0, at).trim(), constraints: /^no constraints?$/i.test(rest) ? 'none' : rest};
}
export const joinConstraints = (date, constraints) => (!date ? '' : !constraints ? date : `${date}; ${constraints === 'none' ? 'no constraints' : constraints}`);
// An amount is saved as "95000 CHF"; free text ("about 90k") is not split, so it stays visible as it was written.
export function splitAmount(value) {
  const raw = String(value || '').trim();
  const after = raw.match(/^(\d[\d'’,.\s]*?)\s*([A-Z]{3})$/), before = raw.match(/^([A-Z]{3})\s*(\d[\d'’,.\s]*)$/);
  if (after) return {number: after[1], currency: after[2]};
  return before ? {number: before[2].trim(), currency: before[1]} : {number: '', currency: ''};
}
