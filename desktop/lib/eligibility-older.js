// The Work eligibility lines saved before Nationality and the zones (#2322), read once by the AI: the nationality and the zone statuses each states
// ("Work permit / visa: EU citizen (Romania)" -> Nationality Romania; "Authorised to work in Iasi, Romania?: Yes" -> EU / EEA + Switzerland: yes, freely).
// The owner (28 Oct 2026): these lines are "pointless… we can deduce any of them, once we know the answer for the 3 above". So Your details shows Nationality
// and the zones filled from them, and the lines are folded into them when you Save (a backup first, Undo after: lib/details-facts-handlers.js); nothing is
// changed here.
// The AI judges (any language); the code keeps only zones, statuses, dates and countries from the fixed sets (renderer/work-eligibility.js). Kept per set
// of lines (settings.eligibilityOlder), so a Profile is read once. Guarded by test/eligibility-older.test.js.
import {anthropicApi} from './ai/anthropic-api.js';
import * as sections from './profile-sections.js';
import {saveCopy} from './profile-move.js';
import {MODEL} from './question-reuse.js';
import {joinPermit, splitPermit} from '../renderer/question-values.js';
import {NATIONALITY, STATUSES, ZONES, isAsked, isRowName, nameOfCode, nationalityOf} from '../renderer/work-eligibility.js';

export const ABOUT = ['eligibility', 'per_job', 'other'];
const SCHEMA = {type: 'object', additionalProperties: false, required: ['lines'], properties: {lines: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['id', 'about', 'nationality', 'rows'], properties: {id: {type: 'string'}, about: {type: 'string', enum: ABOUT}, nationality: {type: 'array', items: {type: 'string'}}, rows: {type: 'array', items: {type: 'object', additionalProperties: false,
    required: ['row', 'status', 'until', 'only'], properties: {row: {type: 'string'}, status: {type: 'string', enum: STATUSES}, until: {type: 'string'}, only: {type: 'string'}}}}}}}}};
export const INSTRUCTIONS = `Each line is a job seeker's saved answer about their right to work, in any language. Their right to work is kept per zone: ${ZONES.map(zone => `"${zone.id}" = ${zone.label}`).join(', ')}, or one other country by its ISO 3166 alpha-2 code.
For each line answer about:
- "eligibility": it states their right to work or their need for sponsorship somewhere.
- "per_job": it asks about "the location you apply for" or the job's own place: it is answered per job, from the zones.
- "other": anything else (working remotely from home for a foreign employer, relocating, a preference).
And nationality: for "eligibility" only, the ISO codes of the countries the line says they are a citizen of (a passport, a nationality, "EU citizen (Romania)" -> RO); otherwise [].
And rows: for "eligibility" only, the zones or countries the line states a status for, each with status "yes, freely" (a citizen, or free movement: an EU, EEA or Swiss citizen is "yes, freely" in "eu"), "yes, with a permit" (a visa or residence permit; until = its end date as YYYY-MM-DD when stated, else ""; only = the ISO code of the one country it is limited to when it does not cover the whole zone, else "") or "no, needs sponsorship". A place named by a city counts for its country. Only what the line states or plainly means; nothing for a zone it does not cover. Otherwise rows [].
Answer every id exactly as given.`;

const nameOf = nameOfCode;
const sigOf = lines => lines.map(line => `${line.label}=${line.value}`).sort().join('~');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// One AI row -> {label, value} of a zone or country row, or null when any part is outside the fixed sets.
function rowOf({row, status, until, only}) {
  const zone = ZONES.find(each => each.id === row), code = String(row || '').toUpperCase();
  const label = zone?.label || nameOf(code), onlyName = only ? nameOf(only) : '';
  if (!label || !STATUSES.includes(status) || (until && !DATE.test(until)) || (only && !onlyName)) return null;
  const value = joinPermit({status, until, only: onlyName});
  return splitPermit(value).status ? {label, value} : null;
}

/**
 * The older lines of Work eligibility (not Nationality as country names, not a zone or country row) with the AI's reading.
 * lines: the section's saved lines [{label, value, kind?}]. -> [{label, value, about ('eligibility' | 'per_job' | 'other' | '' unknown), nationality: [names],
 * rows: [{label, value}]}].
 * No AI, or a failed call: about '' and no rows (the line is shown as it is, as needing review).
 */
export async function older(storage, lines, {ai = {}} = {}) {
  const old = (lines || []).filter(line => line.label && String(line.value ?? '').trim() && !isAsked(line.value) && !(line.kind === 'per_country' && isRowName(line.label))
    && !(line.label === NATIONALITY && nationalityOf(line.value)));
  if (!old.length) return [];
  const sig = sigOf(old), kept = storage.settings().eligibilityOlder;
  const blank = line => ({label: line.label, value: line.value, about: '', nationality: [], rows: []});
  if (kept?.sig === sig) return old.map(line => kept.lines.find(each => each.label === line.label && each.value === line.value) || blank(line));
  const client = ai.client || (ai.apiKey ? anthropicApi(ai.apiKey) : null);
  if (!client) return old.map(blank);
  try {
    const response = await client.messages.create({model: MODEL, max_tokens: 1500, system: INSTRUCTIONS, output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'},
      messages: [{role: 'user', content: `<lines>\n${JSON.stringify(old.map((line, at) => ({id: String(at), line: `${line.label}: ${String(line.value).slice(0, 400)}`})))}\n</lines>`}]});
    const said = new Map((JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}').lines || []).map(each => [each.id, each]));
    const out = old.map((line, at) => {
      const got = said.get(String(at));
      if (!got || !ABOUT.includes(got.about)) return blank(line);
      const rows = got.about === 'eligibility' ? (got.rows || []).map(rowOf).filter(Boolean) : [];
      const nationality = got.about === 'eligibility' ? [...new Set((got.nationality || []).map(nameOf).filter(Boolean))] : [];
      return {label: line.label, value: line.value, about: got.about, nationality, rows: rows.filter((row, i) => rows.findIndex(each => each.label === row.label) === i)};   // one per row
    });
    storage.saveSettings({eligibilityOlder: {sig, lines: out}});
    return out;
  } catch { return old.map(blank); }   // tried again at the next open
}

/** True when the AI read this older line as eligibility (or a per-job question): Nationality and the zones answer it, so it is folded into them, never asked. */
export function folded(storage, line) {
  const reading = (storage.settings().eligibilityOlder?.lines || []).find(each => each.label === line.label && each.value === line.value);
  return reading?.about === 'eligibility' || reading?.about === 'per_job';
}

/**
 * Before a Save of Work eligibility: when it drops older lines the AI folded into Nationality and the zones, both pages are copied and backed up first and
 * the section as it was is kept for Undo (settings.eligibilityFold, shown with the tidy's Undo). next: the lines about to be saved. -> the count folded.
 */
export async function beforeSave(storage, next, {fetcher, copy = saveCopy, now = new Date()} = {}) {
  const current = (await sections.read(storage, fetcher)).eligibility || [];
  const gone = current.filter(line => folded(storage, line) && !(next || []).some(each => each.label === line.label && String(each.value) === String(line.value)));
  if (!gone.length) return 0;
  await copy(storage, {fetcher, now});
  storage.saveSettings({eligibilityFold: {at: now.toISOString(), changed: gone.length, before: current}});
  return gone.length;
}
/** Undo: the section as it was before the fold. */
export async function undoFold(storage, {fetcher, save = sections.save} = {}) {
  const done = storage.settings().eligibilityFold;
  if (!done?.before || done.undone) return {ok: false, error: 'There is nothing to undo'};
  await save(storage, 'eligibility', done.before, fetcher);
  storage.saveSettings({eligibilityFold: {...done, before: undefined, undone: true}});
  return {ok: true};
}
