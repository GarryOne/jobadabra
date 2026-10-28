// Settings → Profile → Your details: the Work eligibility, Availability & compensation and Languages sections (owner, 17 Oct 2026: "Your details =
// facts, in 3 sections"), each line as it is on the Profile page (label, then its value to edit), "Add a line", and "To check": one line counting the
// unclear details (a fact said two ways, a line with no clear home, a value to make exact, an unanswered mark) that opens the Fill your details drawer (owner,
// 28 Oct 2026, superseding 18 Oct "One queue for all"; lib/details-review.js). Saved through the Profile page's one save bar (pages/details-drafts.js). Guarded by
// test/details-facts.test.js and test/details-review.test.js.
import {el, loadingCard} from '../components.js';
import {keep, swr} from '../swr.js';
import {$} from './core.js';
import {showOnTab} from './tab-part.js';
import {detailsChanged, factsDirty, factsRead} from './details-drafts.js';
import {setAsideRows} from './set-aside.js';
import {factOf, factRow} from '../fact-line.js';
import {countText, loadQuestions, questionsNow} from './jobs-questions.js';
import {NATIONALITY, STATUSES, SUGGESTED, ZONES, freer, inZones, isAnswered, isAsked, isOldAsked, nationalityOf, zoneOfLabel, zonesOpenedBy} from '../work-eligibility.js';

export const KEYS = ['eligibility', 'availability', 'languages'];
const box = key => document.querySelector(`[data-facts="${key}"]`);
const readBox = key => document.querySelector(`[data-facts-read="${key}"]`);   // the card's read view (pages/details-read.js)
// The skeleton stands in the editor and in the read view until the lines are read; a read view marked loading is not redrawn as "Nothing yet".
function skeletons(on) {
  for (const key of KEYS) {
    const read = readBox(key);
    if (on) box(key)?.replaceChildren(loadingCard('Reading your details…', [60, 80]));
    if (!read) continue;
    if (on) { read.dataset.loading = '1'; read.replaceChildren(loadingCard('Reading your details…', [60, 80])); } else delete read.dataset.loading;
  }
}

function draw(sections, formats = {}) {
  for (const key of KEYS) {
    const into = box(key);
    if (!into) continue;
    const row = line => factRow(key, line, formats, () => detailsChanged());
    if (key === 'eligibility') { drawEligibility(into, sections[key] || [], row); continue; }
    const add = el('button', 'link span-all', '+ Add a line');
    add.type = 'button';
    add.addEventListener('click', () => { into.insertBefore(row({}), add); detailsChanged(); });
    into.replaceChildren(...(sections[key] || []).map(row), add);
  }
}

// Work eligibility (owner, 28 Oct 2026, #2322: "ask as less as possible the user and … conclude as much as possible, by ourselves"): Nationality, the three
// zones (each preselected from your nationality, "Suggested from your nationality"), and the other lines as they are (owner, 28 Oct 2026: no
// "Add a country": "they'll use it either for EEA or for US").
let eligibilityRow = null;
function drawEligibility(into, lines, row) {
  eligibilityRow = row;
  const own = lines.find(line => line.label === NATIONALITY), rows = lines.filter(line => line.kind === 'per_country' && zoneOfLabel(line.label));
  const rest = lines.filter(line => line !== own && !rows.includes(line) && !isOldAsked(line));   // Why (28 Oct 2026, owner: "let's remove these 3 fields"): an old line still asked is no answer; the zones ask instead
  // Why (28 Oct 2026, #2322 review): one Nationality row. Words that are not country names ("British") stay as written with a Check, never a second row.
  const nationality = row(own && !isAsked(own.value) ? own : {label: NATIONALITY, value: ''});
  delete into.dataset.edited;   // a redraw is a fresh open: suggestions follow only a Nationality the person changes next
  into.replaceChildren(nationality, ...ZONES.map(zone => zoneRow(into, zone, rows)), ...rest.map(row));
  if (into.dataset.concluding) return;
  into.dataset.concluding = '1';   // once per box: a nationality picked or removed redraws the zones it opens
  into.addEventListener('change', event => { if (event.target.closest?.('.qa-nationality')) { into.dataset.edited = '1'; redrawConcluded(into); } });
  into.addEventListener('click', event => { if (event.composedPath?.().some(node => node.classList?.contains('qa-nationality'))) { into.dataset.edited = '1'; redrawConcluded(into); } });   // the chip is gone by now: its path
}
// A zone: its answered row, else its picker preselected from the nationality (owner, 28 Oct 2026: "we should still show the card pickers, but just preselected and
// with a note below"; a zone the nationality opens reads "yes, freely", the others "no, needs sponsorship"): a suggestion, never an answer until Save.
function zoneRow(into, zone, rows) {
  const saved = rows.find(line => zoneOfLabel(line.label) === zone);
  // Why (owner, 28 Oct 2026, "Save them automatically", reversing #2346): on open the conclusions are already saved (lib/eligibility-settle.js), so a zone still empty stays empty;
  // only a Nationality the person changes in this session preselects the zones, as a draft of their own edit.
  return isAnswered(saved?.value) ? eligibilityRow(saved) : suggestionRow(zone, into.dataset.edited ? suggestedFor(zone, nationalityNow(into)) : '', saved);
}
// Europe and the US: the fixed zone table (yes, freely in your own zone, else sponsorship); any other country: the AI's answer once it came (never a guess before it).
const aiZones = new Map(), aiAsked = new Set();
const keyOf = names => [...names].sort().join('|');
function suggestedFor(zone, nationality) {
  const own = nationality.filter(inZones), other = nationality.filter(name => !inZones(name));
  const table = own.length ? (zonesOpenedBy(own).includes(zone.id) ? STATUSES[0] : SUGGESTED) : '';
  return freer(table, other.length ? aiZones.get(keyOf(other))?.[zone.id] || '' : '');
}
// A nationality outside Europe and the US is asked once per session (lib/zone-suggest.js caches it per country); the zones redraw when the answer comes.
function askZones(into) {
  const other = nationalityNow(into).filter(name => !inZones(name)), key = keyOf(other);
  if (!other.length || aiAsked.has(key) || !window.pilot?.zoneSuggestions) return;
  aiAsked.add(key);
  // Why (28 Oct 2026, #2346 review): an empty answer (no AI, a failed call) is asked again at the next change, as lib/zone-suggest.js says.
  window.pilot.zoneSuggestions(other).then(found => { if (!Object.keys(found || {}).length) { aiAsked.delete(key); return; } aiZones.set(key, found); redrawConcluded(into); }).catch(() => aiAsked.delete(key));
}
const nationalityNow = into => nationalityOf(into.querySelector('.qa-nationality')?.value || '') || [];
// The nationality changed: every zone with no answer of the person's is preselected again from it. Why (28 Oct 2026, owner: "once we add/change the nationality,
// initially, can we preselect…"; "we shouldn't override his choices"): a suggestion not yet clicked follows the nationality; an answer given or saved never moves.
function redrawConcluded(into) {
  const nationality = nationalityNow(into);
  let suggested = false;
  for (const zone of ZONES) {
    const line = [...into.querySelectorAll('.country-row.fact-line')].find(each => zoneOfLabel(factOf(each).label) === zone);
    if (!line || (isAnswered(factOf(line).value) && !line.dataset.suggested)) continue;
    const value = suggestedFor(zone, nationality);
    line.replaceWith(suggestionRow(zone, value, line.dataset.suggested ? null : factOf(line)));   // an old suggestion is never carried over as a saved row
    suggested ||= Boolean(value);
  }
  if (suggested) detailsChanged();
  askZones(into);
}
// A zone's row carrying the suggestion: a click on it is the person's own answer, so it stops being a suggestion.
function suggestionRow(zone, value, saved) {
  const line = eligibilityRow(value ? {label: zone.label, value, kind: 'per_country'} : saved || {label: zone.label, value: '', kind: 'per_country'});   // no suggestion: a saved, still asked row stays as it was
  if (!value) return line;
  line.dataset.suggested = '1';
  const note = el('span', 'muted small', 'Suggested from your nationality');
  line.append(note);
  // Only a pick on a status is the person's answer, not a click on the label or the note.
  for (const type of ['click', 'change']) line.addEventListener(type, event => { if (!event?.target?.closest?.('.segmented button, select')) return; delete line.dataset.suggested; note.remove(); });
  return line;
}

// "Tidied": the lines that got their kind, or their note for the AI, on first open, with Undo (lib/details-kinds.js, lib/details-notes.js).
function drawTidied(tidied) {
  const box_ = $('facts-tidied');
  if (!tidied) { box_.replaceChildren(); return; }
  const undo = el('button', 'secondary', 'Undo');
  undo.type = 'button';
  undo.addEventListener('click', async () => {
    undo.disabled = true;
    const result = await window.pilot.undoDetailsTidy();
    if (result.ok) showFacts(); else { $('facts-message').textContent = result.error; undo.disabled = false; }
  });
  // Why (owner, 28 Oct 2026, "Save them automatically"): Work eligibility is concluded and saved on open, so its part of this notice says so (lib/eligibility-settle.js).
  const eligibility = tidied.eligibility || 0, rest = tidied.changed - eligibility;
  const said = [rest ? `${rest} of your details were tidied: a typed control, or the rules folded as a note for the AI.` : '', eligibility ? 'Work eligibility was filled in from your earlier answers and saved.' : ''].filter(Boolean).join(' ');
  box_.replaceChildren(el('p', 'muted small', `${said} The words you saved are kept, and the copy from before is backed up.`), undo);
}

// "N missing": Fill your details' items, counted from the drawer's own list (read once when Jobs has not read it yet), Review opens it at the first.
let last = {aside: [], tidied: null}, queueAsked = false;
document.addEventListener?.('questions-read', () => drawWhich(last.aside, last.tidied));
function drawWhich(aside = [], tidied = null) {
  last = {aside, tidied};
  if (!questionsNow().read && !queueAsked) { queueAsked = true; loadQuestions().then(() => drawWhich(last.aside, last.tidied)).catch(() => {}); }
  const items = questionsNow().details;   // Fill your details' list: the card's and the tab's count
  showOnTab($('setting-which'), items.length > 0 || aside.length > 0 || Boolean(tidied));
  drawTidied(tidied);
  $('facts-set-aside').replaceChildren(...setAsideRows(aside, showFacts, text => { $('facts-message').textContent = text; }));
  if (!items.length) { $('which-list').replaceChildren(); return; }
  const banner = el('div', 'notice qa-banner');
  const go = Object.assign(el('button', 'primary small-btn', 'Review'), {type: 'button', id: 'details-review-go'});
  go.addEventListener('click', () => import('./question-review.js').then(review => review.openQuestionReview({queue: 'details', start: items[0].key})));
  banner.append(el('span', '', `⚠ ${countText.details(items.length)}`), go);
  $('which-list').replaceChildren(banner);
}

// Reads and draws the sections: the saved lines at once (lib/details-facts-handlers.js 'detailsFactsNow'), then the one-time moves settle in the background (the first time the app
// moves the facts in: copy and backup first, lib/profile-move.js) and the screen draws again with what they did. 'details-sorting' tells the cards (the Voluntary surveys card
// shows "Sorting your answers…", then reads its lines again); the first paint never waits on an AI call. Guarded by test/details-facts.test.js.
let settledFor = 0, redrawing = false;
const paintFacts = (result, kept) => {
  skeletons(false);
  if (!kept && !redrawing && factsDirty()) return;   // a refresh never redraws under unsaved edits (Discard all redraws on purpose)
  $('facts-message').textContent = '';
  draw(result.sections || {}, result.formats || {});
  factsRead();   // the drafts count from what is drawn now (details-drafts.js)
  drawWhich(result.setAside || [], result.tidied || null);
};
export async function showFacts({redraw = false} = {}) {
  const turn = ++settledFor;
  redrawing = redraw;
  const quick = await swr('details-facts', () => window.pilot.detailsFactsNow(), {
    loading: () => skeletons(true),
    paint: paintFacts,
    fail: result => { $('facts-message').textContent = result.error || ''; skeletons(false); draw({}); detailsChanged(); },
  });
  document.dispatchEvent(new CustomEvent('details-sorting', {detail: {on: true}}));
  const settled = await window.pilot.detailsFacts().catch(error => ({ok: false, error: error.message}));
  if (turn === settledFor && settled?.ok !== undefined) {
    if (settled.ok) { keep('details-facts', settled); paintFacts(settled, false); } else if (settled.error) $('facts-message').textContent = settled.error;
  }
  redrawing = false;
  document.dispatchEvent(new CustomEvent('details-sorting', {detail: {on: false, changed: settled?.changed || 0}}));
  return quick;
}

// What the boxes hold now: {eligibility: [{label, value, kind}], ...} (a line with no value is dropped on save).
// saved: what is in the store (a zone only suggested is a draft, not saved). Why (28 Oct 2026, #2346 review): the draft baseline excludes suggestions, so they make the card dirty and Save offered.
export function factsNow({saved = false} = {}) {
  return Object.fromEntries(KEYS.map(key => [key, [...(box(key)?.querySelectorAll('.fact-line') || [])].filter(line => !(saved && line.dataset.suggested)).map(factOf).filter(line => line.label && line.value)]));
}
