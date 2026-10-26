// The Strategy page's pure parts (owner mockup, 7 Oct 2026): role families, goal notes (estimated salary, language levels not set), the
// exclusions split by what they do, and the suggestion rows' options in order. Data in, words out; strategy.js draws them.

import {LEVELS, splitPermit, splitSalary} from './question-values.js';

// src/role_kinds.py KINDS, in words. A role the engine did not label (an older read) is "Other roles".
export const KIND_LABELS = {software: 'Software', sales_b2b: 'Business sales', sales_retail: 'Retail', logistics: 'Logistics', hospitality: 'Hospitality',
  healthcare: 'Healthcare', creative_media: 'Creative & media', finance_admin: 'Office & finance', education: 'Education', trades: 'Trades',
  engineering: 'Engineering', business_ops: 'Business & operations', manufacturing: 'Manufacturing', science: 'Science & research',
  customer_service: 'Customer service', legal: 'Legal', aviation_transport: 'Aviation & transport', public_security: 'Public service & security', other: 'Other roles'};

// Roles grouped by family, in the order the user listed them: [{kind, label, entries}]. A single family keeps its own name too.
export function roleFamilies(entries) {
  const families = new Map();
  for (const entry of entries || []) {
    const kind = KIND_LABELS[entry.kind] ? entry.kind : 'other';
    if (!families.has(kind)) families.set(kind, {kind, label: KIND_LABELS[kind], entries: []});
    families.get(kind).entries.push(entry);
  }
  return [...families.values()];
}

// A goal as shown, and what it still needs: {text, note: 'estimated'|'levels'|''}. The Profile writes "(estimate)" after a salary the AI guessed
// and "(level ❓)" after a language with no level (src/strategy prompt: ❓ = ask the user); the page says so in words instead of red marks.
const ESTIMATE = /\s*\((?:estimated?|est\.)\)\s*$/i;
const NO_LEVEL = /\s*\(level\s*(?:❓|\?)\s*\)/gi;
export function goalNote(key, value) {
  const text = String(value || '');
  if (key === 'minimum_salary' && ESTIMATE.test(text)) return {text: text.replace(ESTIMATE, ''), note: 'estimated'};
  if (key === 'languages' && text.match(NO_LEVEL)) return {text: text.replace(NO_LEVEL, ''), note: 'levels'};
  return {text, note: ''};
}

// What each exclusion does, from the engine's own rules (src/digest.py): a language a job REQUIRES hides it (language_blocked), the same language
// as only "nice to have" ranks it lower (-1 in prefer_score); companies, title words and remote regions hide the job. avoid: the engine's
// labelled list ("Company: X", "Title: x", "Remote only from y"; src/desktop.py strategy).
export function exclusionGroups(data) {
  const languages = data?.texts?.languages || [];
  const hide = [], lower = [];
  for (const item of data?.avoid || []) {
    const [, prefix, rest] = String(item).match(/^(Company|Title|Remote only from):?\s*(.*)$/) || [];
    if (prefix === 'Company') hide.push({kind: 'company', label: rest});
    else if (prefix === 'Title') hide.push({kind: 'title', label: `Title: ${rest}`});
    else if (prefix) hide.push({kind: 'remote', label: `Remote only from ${rest}`});
  }
  if (languages.length) lower.push({kind: 'language', label: `${languages.join(', ')} only "nice to have"`});
  return {languages, hide, lower};
}

// Options with a count: the ones with jobs first (most first), the empty ones after, behind "Show more".
export function byOpenings(options) {
  const counted = (options || []).map((option, i) => ({option, i, count: Number(option.count || 0)}));
  const sort = list => list.sort((a, b) => b.count - a.count || a.i - b.i).map(item => item.option);
  return {open: sort(counted.filter(item => item.count > 0)), empty: sort(counted.filter(item => item.count <= 0))};
}

// Manual sites: one chip per company (Nestlé on nestle-cwa.com and on corporate.nestle.ca is one name), each page still listed when expanded.
export function sitesByName(chips) {
  const byName = new Map();
  for (const chip of chips || []) {
    const name = chip.label.replace(/^Open /, '');
    if (!byName.has(name)) byName.set(name, {name, pages: []});
    byName.get(name).pages.push(chip);
  }
  return [...byName.values()];
}
export const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// ---------- The strategy draft (owner, 7 Oct 2026: one draft for every editable card, one save bar) ----------
// edits: {list: {add: [words], remove: [stored fragments]}, remote: {set}}; typed: {list: text still in its input, not yet added with Enter}.
// The lists with a change, typed text included (it is part of the draft: Save keeps it, the bar and the Edited badges count it).
export function dirtyLists(edits, typed = {}) {
  const dirty = new Set();
  for (const [name, edit] of Object.entries(edits || {})) if (name === 'remote' || 'set' in (edit || {}) || edit.add?.length || edit.remove?.length) dirty.add(name);
  for (const [name, text] of Object.entries(typed || {})) if (String(text || '').trim()) dirty.add(name);
  return dirty;
}
// The edits Save sends: the draft plus the words still typed, each once (a word already stored or added is not added again; one removed
// and typed back is kept). plain: lists stored as typed; the others lower-cased. stored(name): that list's labels as stored.
export function withTyped(edits, typed, plain, stored = () => []) {
  const out = structuredClone(edits || {});
  for (const [name, text] of Object.entries(typed || {})) {
    const word = plain.has(name) ? String(text || '').trim() : String(text || '').trim().toLowerCase();
    if (!word) continue;
    const edit = out[name] ||= {add: [], remove: []};
    const same = label => String(label).toLowerCase() === word.toLowerCase();
    const back = stored(name).find(entry => edit.remove.includes(entry.fragment) && same(entry.label));
    if (back) edit.remove = edit.remove.filter(fragment => fragment !== back.fragment);
    else if (!edit.add.some(same) && !stored(name).some(entry => same(entry.label))) edit.add.push(word);
  }
  return out;
}
// The one suggestions line under Strategy's tabs (owner, 18 Oct 2026, review fix 3): its count is shared-counts.js "strategy-suggestions"; this is the
// top one. top: the first kind's brief {title, text}; its "+ " / "− " lead is dropped.
export const improveWords = top => ({top: top ? `Top: ${top.title.replace(/^[+−] /, '')}${top.text ? ` (${top.text})` : ''}` : ''});

// Main goals' Minimum salary as read (owner, 18 Oct 2026: "Show salary currency and period explicitly"): a salary the control can read is said as
// "CHF 130,000 / year" (· gross); one it cannot is shown as written, with the way to pick its parts. -> {text, note}.
export function salaryWords(text) {
  const raw = String(text || '').trim();
  if (!raw) return {text: ''};
  const {number, currency, period, basis} = splitSalary(raw);
  if (!number) return {text: raw, note: 'As written: Edit to pick its currency and period'};
  const amount = Number(number) ? Number(number).toLocaleString('en-US') : number;
  return {text: `${currency} ${amount} / ${period || '?'}${basis ? ` · ${basis}` : ''}`, ...(period ? {} : {note: 'Period not set: Edit to add it'})};
}
// Main goals' "From Your details" line (owner, 18 Oct 2026: "What is this long text?"): one short line, never the notes, marks or instructions Your details
// keeps for the AI. Languages with their levels ("English B2"), and where the person may work as recorded per country: a country answered "allowed" or
// "Yes" is "Works in", "needs visa" or "No" is "Needs sponsorship"; nothing is inferred beyond the places the answers name. A line that names no place,
// or gives no such answer, is left to Your details. details: {languages: [{label, value}], eligibility: [...]}; languages: the older Profile line when
// Your details has none. -> words or ''.
const SHOWN = 4, OLD_LANGUAGES = 60;
const bare = text => String(text ?? '').replace(/\s*\(note:[\s\S]*$/i, '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();
const listed = items => (items.length > SHOWN ? `${items.slice(0, SHOWN).join(', ')} +${items.length - SHOWN} more` : items.join(', '));
// The place a per-country line names: the label itself ("Switzerland"), or the capitalised words that end a question ("Authorised to work in the UK?" → "UK").
const placeOf = label => (bare(label).replace(/\([^)]*\)/g, '').replace(/[?:\s]+$/, '').match(/(?:\p{Lu}[\p{L}.'-]*)(?:\s*(?:\/|\s)\s*\p{Lu}[\p{L}.'-]*)*$/u) || [''])[0];
function eligibility(lines) {
  const works = [], needs = [];
  for (const line of lines || []) {
    const value = bare(line.value), place = placeOf(line.label), {status} = splitPermit(value);
    const answer = status || (value.match(/^(yes|no)\b/i)?.[1] || '').toLowerCase();
    const to = answer === 'allowed' || answer === 'yes' ? works : answer === 'needs visa' || answer === 'no' ? needs : null;
    if (to && place && !works.includes(place) && !needs.includes(place)) to.push(place);
  }
  return [works.length && `Works in: ${listed(works)}`, needs.length && `Needs sponsorship: ${listed(needs)}`].filter(Boolean).join(' · ');
}
function spoken(lines, older) {
  const levels = new Set(LEVELS.map(level => level.toLowerCase()));
  const said = (lines || []).map(line => ({name: bare(line.label), level: bare(line.value)}))
    .filter(({name, level}) => name && levels.has(level.toLowerCase())).map(({name, level}) => `${name} ${level}`);
  if (said.length) return said.length > SHOWN ? `${said.slice(0, SHOWN).join(' · ')} +${said.length - SHOWN} more` : said.join(' · ');
  const old = bare(older);
  return old.length > OLD_LANGUAGES ? `${old.slice(0, OLD_LANGUAGES).replace(/\s+\S*$/, '')}…` : old;
}
export function detailsLine(details = {}, languages = '') {
  const said = spoken(details?.languages, languages);
  return [said && `Languages: ${said}`, eligibility(details?.eligibility)].filter(Boolean).join(' · ');
}
