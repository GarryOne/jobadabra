// Work eligibility by zone (owner, 28 Oct 2026, #2322: "one answer in EU, another one in UK, another one in US… EU + Switzerland or EEA… And that's it"):
// three fixed rows (EU / EEA + Switzerland, United Kingdom, United States) and any country added by hand, each with one status from a fixed set, saved as a
// "[per country]" line ("EU / EEA + Switzerland: yes, freely", "United Kingdom: yes, with a permit, valid until 2027-06-30"). A row is a zone or a country
// from renderer/countries.js, never a city. Needing sponsorship is derived from the status, never a fact of its own. Which zone a form's country is in is
// the AI's judgment, checked here against the zones' fixed members (lib/question-reuse.js). Pure: the lib and the renderer share it.
// Guarded by test/work-eligibility.test.js.
import {CODES} from './countries.js';

// Why (28 Oct 2026, owner): EU citizens may work across the EEA and Switzerland, so they are one row.
const EEA_CH = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH'.split(' ');
export const ZONES = [{id: 'eu', label: 'EU / EEA + Switzerland', codes: EEA_CH}, {id: 'uk', label: 'United Kingdom', codes: ['GB', 'UK']}, {id: 'us', label: 'United States', codes: ['US']}];
export const STATUSES = ['yes, freely', 'yes, with a permit', 'no, needs sponsorship'];
export const STATUS_NAMES = {'yes, freely': 'Yes, freely', 'yes, with a permit': 'Yes, with a permit', 'no, needs sponsorship': 'No, needs sponsorship'};
export const STATUS_HINTS = {'yes, freely': 'Citizen or free movement', 'yes, with a permit': 'A visa or residence permit', 'no, needs sponsorship': 'An employer must sponsor you'};
export const OLDER = {'needs visa': 'no, needs sponsorship', allowed: ''};   // the older words: "allowed" never said how, so it stays as written

// Country names in English: the name a row is saved under on every store, the same on every Mac.
const english = (() => { try { return new Intl.DisplayNames(['en'], {type: 'region'}); } catch { return null; } })();
const BY_NAME = new Map(CODES.map(code => [String(english?.of(code) || '').toLowerCase(), code]).filter(([name]) => name.length > 2));
/** The English country names, sorted: the one list an added row's country and a permit's "Only in" are picked from. */
export const COUNTRY_NAMES = [...new Set(CODES.map(code => english?.of(code)).filter(name => name && name.length > 2))].sort((a, b) => a.localeCompare(b, 'en'));
/** "Romania" -> "RO"; '' for anything that is not a country's English name (a city, a region, "Germany / EU"). */
export const countryCode = name => BY_NAME.get(String(name ?? '').trim().toLowerCase()) || '';
export const isCountry = name => Boolean(countryCode(name));
export const zoneOfLabel = label => ZONES.find(zone => zone.label.toLowerCase() === String(label ?? '').trim().toLowerCase()) || null;
/** A row's own name: one of the zones, or a country added by hand. */
export const isRowName = label => Boolean(zoneOfLabel(label)) || isCountry(label);
/** The countries a row covers, as ISO codes. */
export const codesOf = label => zoneOfLabel(label)?.codes || [countryCode(label)].filter(Boolean);

// What a row settles about one country (ISO code) on a day: the right to work there, and whether sponsorship is needed (derived, owner 28 Oct 2026:
// "freely → No; permit → No until the date; No → Yes"). A permit past its date, or limited to another country, settles nothing.
// row: {status, until, only} (lib: splitPermit); asks: 'work_right' | 'sponsorship' -> 'Yes' | 'No' | ''.
export function settles({status = '', until = '', only = ''} = {}, asks, code = '', now = new Date()) {
  if (status === 'no, needs sponsorship') return asks === 'work_right' ? 'No' : asks === 'sponsorship' ? 'Yes' : '';
  if (status === 'yes, with a permit' && ((until && until < now.toISOString().slice(0, 10)) || (only && code && countryCode(only) !== code))) return '';
  if (status === 'yes, freely' || status === 'yes, with a permit') return asks === 'work_right' ? 'Yes' : asks === 'sponsorship' ? 'No' : '';
  return '';
}

// Nationality (owner, 28 Oct 2026, #2322: "ask as less as possible the user and … conclude as much as possible, by ourselves"): one or more countries, saved
// as "Nationality: Romania, Moldova". The zones a citizenship opens are concluded from it by the zones' fixed members (an Irish citizen also works freely
// in the UK, the Common Travel Area); a zone it does not open is asked.
export const NATIONALITY = 'Nationality';
const FREELY_ALSO = {IE: ['uk']};
/** "Romania, Moldova" -> ['Romania', 'Moldova']; null when any part is not a country's English name (the line then needs your check). */
export function nationalityOf(value) {
  const parts = String(value ?? '').split(/\s*[,;·]\s*/).map(part => part.trim()).filter(Boolean);
  const names = parts.map(part => COUNTRY_NAMES.find(name => name.toLowerCase() === part.toLowerCase()));
  return parts.length && names.every(Boolean) ? [...new Set(names)] : null;
}
/** The zone ids a set of citizenships opens freely. */
export const zonesOpenedBy = names => ZONES.filter(zone => (names || []).some(name => zone.codes.includes(countryCode(name)) || (FREELY_ALSO[countryCode(name)] || []).includes(zone.id))).map(zone => zone.id);
/**
 * The eligibility a section's lines state, saved and concluded: lines: [{label, value, kind?}] ->
 * {nationality: [names] | null, rows: [{label, value, from: 'saved' | 'nationality'}]} (a zone with no saved row that the nationality opens reads "yes, freely").
 */
export function eligibilityOf(lines) {
  const own = (lines || []).find(line => line.label === NATIONALITY), nationality = own ? nationalityOf(own.value) : null;
  const saved = (lines || []).filter(line => line.kind === 'per_country' && isRowName(line.label) && String(line.value ?? '').trim()).map(line => ({label: line.label, value: line.value, from: 'saved'}));
  const opened = zonesOpenedBy(nationality).map(id => ZONES.find(zone => zone.id === id)).filter(zone => !saved.some(row => zoneOfLabel(row.label) === zone));
  return {nationality, rows: [...saved, ...opened.map(zone => ({label: zone.label, value: 'yes, freely', from: 'nationality'}))]};
}
/** The row that covers a country (ISO code): an added country's own row first, then its zone, then a citizenship of it ("yes, freely"). */
export function rowFor(code, lines) {
  const {nationality, rows} = eligibilityOf(lines), upper = String(code || '').toUpperCase();
  if (!upper) return null;
  return rows.find(row => !zoneOfLabel(row.label) && countryCode(row.label) === upper) || rows.find(row => zoneOfLabel(row.label)?.codes.includes(upper))
    || ((nationality || []).some(name => countryCode(name) === upper) ? {label: NATIONALITY, value: 'yes, freely', from: 'nationality'} : null);
}
