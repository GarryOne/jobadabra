// What the AI concludes about Work eligibility is saved when Your details opens, never left as a draft (owner, 28 Oct 2026, "Save them automatically": leaving Profile
// asked "Save your changes?" for lines the person never typed). Two conclusions, both written with a backup first and an Undo after (settings.eligibilityFold, shown with the
// tidy's Undo): the older lines the AI read as eligibility fold into Nationality and the zones (#2322, lib/eligibility-older.js), and a saved Nationality opens its zones (#2346:
// Europe and the US by the fixed table, any other country by the AI, lib/zone-suggest.js). Only the person's own edits are drafts. Guarded by test/details-eligibility-autosave.test.js.
import {older, folded, foldRecord, lineKey, linesSig} from './eligibility-older.js';
import * as sections from './profile-sections.js';
import {saveCopy} from './profile-move.js';
import {suggest as suggestZones} from './zone-suggest.js';
import {NATIONALITY, STATUSES, SUGGESTED, ZONES, freer, inZones, isAnswered, isAsked, nationalityOf, zoneOfLabel, zonesOpenedBy} from '../renderer/work-eligibility.js';

// A zone's row: kind per_country, its status as the value.
const zoneLine = (zone, value) => ({label: zone.label, value, kind: 'per_country'});

/**
 * Concludes and saves Work eligibility. -> the count of lines concluded (folded, Nationality set, zones filled); 0 when there was nothing to do, the person undid these very lines,
 * or the conclusion could not be read back (the section is then put back as it was and the error thrown).
 * Invariants: a zone the person answered is never overwritten; a guess is never saved (a nationality the AI has no zones for yet fills nothing, the next open asks again);
 * a backup runs before any write; the section as it was is kept for Undo.
 */
export async function settle(storage, {ai = {}, fetcher, copy = saveCopy, now = new Date()} = {}) {
  const lines = (await sections.read(storage, fetcher)).eligibility || [];
  if (!lines.length) return 0;
  const off = new Set(storage.settings().eligibilityOff || []);   // lines an Undo gave back: never concluded again
  const readings = (await older(storage, lines, {ai})).filter(each => (each.about === 'eligibility' || each.about === 'per_job') && !off.has(lineKey(each)));
  const own = lines.find(line => line.label === NATIONALITY), saved = own && !isAsked(own.value) ? nationalityOf(own.value) : null;
  const read = [...new Set(readings.flatMap(each => each.nationality || []))];
  const nationality = saved?.length ? saved : read;
  const natLine = !saved?.length && read.length ? {label: NATIONALITY, value: read.join(', ')} : null;   // a folded unreadable Nationality leaves its place to the names read
  const other = nationality.filter(name => !inZones(name)), ownZones = nationality.filter(inZones);
  // A country outside Europe and the US: the AI's zones (cached per country). None yet: nothing is suggested, never a guess.
  const asked = other.length ? await suggestZones(storage, other, {ai}).catch(() => ({})) : {};
  const ready = nationality.length > 0 && (!other.length || Object.keys(asked).length > 0);
  const suggested = zone => (ownZones.length ? (zonesOpenedBy(ownZones).includes(zone.id) ? STATUSES[0] : SUGGESTED) : '');
  const proposed = new Map();   // a zone's value: the first earlier answer that states it, else the nationality's
  for (const proposal of readings.flatMap(each => each.rows || [])) { const zone = zoneOfLabel(proposal.label); if (zone && !proposed.has(zone.id)) proposed.set(zone.id, proposal.value); }
  let filled = 0;
  const zones = ZONES.map(zone => {
    const current = lines.find(line => line.kind === 'per_country' && zoneOfLabel(line.label) === zone);
    if (current && isAnswered(current.value)) return current;   // the person's answer, or an earlier conclusion: never overwritten
    const value = proposed.get(zone.id) || (ready ? freer(suggested(zone), asked[zone.id] || '') : '');
    if (!value) return current || null;
    filled++;
    return zoneLine(zone, value);
  });
  const isZone = line => line.kind === 'per_country' && zoneOfLabel(line.label);
  const gone = lines.filter(line => line !== own && !isZone(line) && !off.has(lineKey(line)) && folded(storage, line));   // Why (28 Oct 2026): Nationality and the zone rows are the conclusion itself, never folded again (a second fold overwrote the Undo)
  const rest = lines.filter(line => !gone.includes(line) && line !== own && !isZone(line));
  const concluded = gone.length + (natLine ? 1 : 0) + filled;
  if (!concluded) return 0;
  const next = [...(natLine ? [natLine] : own ? [own] : []), ...zones.filter(Boolean), ...rest];
  await copy(storage, {fetcher, now});   // the backup, before any line changes
  const prior = storage.settings().eligibilityFold;
  storage.saveSettings({eligibilityFold: foldRecord(storage, {changed: concluded, before: lines, now})});
  await sections.save(storage, 'eligibility', next, fetcher);
  const back = (await sections.read(storage, fetcher)).eligibility || [];
  if (linesSig(back) !== linesSig(next.filter(line => String(line.value ?? '').trim()))) {   // read back, else all goes back (lib/profile-move.js)
    await sections.save(storage, 'eligibility', lines, fetcher);
    storage.saveSettings({eligibilityFold: prior});   // the earlier Undo stays
    throw new Error('Work eligibility did not save as concluded; your lines are as they were');
  }
  return concluded;
}
