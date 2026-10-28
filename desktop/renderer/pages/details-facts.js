// Settings → Profile → Your details: the Work eligibility, Availability & compensation and Languages sections (owner, 17 Oct 2026: "Your details =
// facts, in 3 sections"), each line as it is on the Profile page (label, then its value to edit), "Add a line", and "To check": one line counting the
// unclear details (a fact said two ways, a line with no clear home, a value to make exact, an unanswered mark) that opens the Fill your details drawer (owner,
// 28 Oct 2026, superseding 18 Oct "One queue for all"; lib/details-review.js). Saved through the Profile page's one save bar (pages/details-drafts.js). Guarded by
// test/details-facts.test.js and test/details-review.test.js.
import {el, loadingCard, pill} from '../components.js';
import {keep, swr} from '../swr.js';
import {$} from './core.js';
import {showOnTab} from './tab-part.js';
import {detailsChanged, factsDirty, factsRead} from './details-drafts.js';
import {setAsideRows} from './set-aside.js';
import {factOf, factRow} from '../fact-line.js';
import {countText, loadQuestions, questionsNow} from './jobs-questions.js';
import {NATIONALITY, ZONES, isAnswered, isAsked, isOldAsked, nationalityOf, zoneOfLabel, zonesOpenedBy} from '../work-eligibility.js';

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
// zones (one your nationality opens reads "Yes, freely · from your nationality", never asked), and the other lines as they are (owner, 28 Oct 2026: no
// "Add a country": "they'll use it either for EEA or for US").
let eligibilityRow = null;
function drawEligibility(into, lines, row) {
  eligibilityRow = row;
  const own = lines.find(line => line.label === NATIONALITY), rows = lines.filter(line => line.kind === 'per_country' && zoneOfLabel(line.label));
  const rest = lines.filter(line => line !== own && !rows.includes(line) && !isOldAsked(line));   // Why (28 Oct 2026, owner: "let's remove these 3 fields"): an old line still asked is no answer; the zones ask instead
  // Why (28 Oct 2026, #2322 review): one Nationality row. Words that are not country names ("British") stay as written with a Check, never a second row.
  const nationality = row(own && !isAsked(own.value) ? own : {label: NATIONALITY, value: ''});
  into.replaceChildren(nationality, ...ZONES.map(zone => zoneRow(into, zone, rows)), ...rest.map(row));
  if (into.dataset.concluding) return;
  into.dataset.concluding = '1';   // once per box: a nationality picked or removed redraws the zones it opens
  into.addEventListener('change', event => { if (event.target.closest?.('.qa-nationality')) redrawConcluded(into); });
  into.addEventListener('click', event => { if (event.composedPath?.().some(node => node.classList?.contains('qa-nationality'))) redrawConcluded(into); });   // the chip is gone by now: its path
}
// A zone: its answered row, else "from your nationality" when the nationality opens it (a quiet Change turns it into the chips), else its row or the empty
// chips (a template row still asked stays the one asked).
function zoneRow(into, zone, rows) {
  const saved = rows.find(line => zoneOfLabel(line.label) === zone);
  if (isAnswered(saved?.value) || !zonesOpenedBy(nationalityNow(into)).includes(zone.id)) return eligibilityRow(saved || {label: zone.label, value: '', kind: 'per_country'});
  const node = el('div', 'fact-derived country-row');
  node.dataset.zone = zone.id;
  const change = Object.assign(el('button', 'secondary small-btn', 'Change'), {type: 'button'});
  change.addEventListener('click', () => { node.replaceWith(eligibilityRow({label: zone.label, value: '', kind: 'per_country'})); detailsChanged(); });
  const words = el('span', 'fact-derived-value');
  words.append(el('strong', '', 'Yes, freely'), el('span', 'muted', ' · from your nationality '), change);
  node.append(el('span', '', zone.label), words);
  return node;
}
const nationalityNow = into => nationalityOf(into.querySelector('.qa-nationality')?.value || '') || [];
// The nationality changed: a zone it now opens, still unanswered, reads as concluded; one it no longer opens gets its chips back.
function redrawConcluded(into) {
  for (const zone of ZONES) {
    const derived = into.querySelector(`.fact-derived[data-zone="${zone.id}"]`), line = [...into.querySelectorAll('.country-row.fact-line')].find(each => zoneOfLabel(factOf(each).label) === zone);
    const opens = zonesOpenedBy(nationalityNow(into)).includes(zone.id);
    if (derived && !opens) derived.replaceWith(eligibilityRow({label: zone.label, value: '', kind: 'per_country'}));
    if (!derived && opens && line && !isAnswered(factOf(line).value)) line.replaceWith(zoneRow(into, zone, []));
  }
}

/**
 * After a paint from the store: the older lines the AI read as eligibility (lib/eligibility-older.js) fill Nationality and the empty zones, marked "From your
 * earlier answers", and leave the card; all as unsaved drafts, so Save folds them in (a backup first, Undo after) and Discard keeps them as they were.
 */
export function foldOlder(readings = []) {
  const into = box('eligibility'), used = readings.filter(each => each.about === 'eligibility' || each.about === 'per_job');
  if (!into || !used.length) return;
  const mark = node => node.append(pill('From your earlier answers', 'info', {title: 'Read from the lines you saved before; Save to keep it'}));
  const lines = [...into.querySelectorAll('.fact-line')];
  for (const line of lines) if (used.some(each => each.label === factOf(line).label && each.value === factOf(line).value)) line.remove();
  const names = [...new Set(used.flatMap(each => each.nationality || []))], citizenship = [...into.querySelectorAll('.fact-line')].find(each => factOf(each).label === NATIONALITY);
  if (!citizenship || (names.length && !nationalityNow(into).length)) {   // a folded unreadable Nationality leaves its place to the chips
    const next = eligibilityRow({label: NATIONALITY, value: names.join(', ')});
    if (citizenship) citizenship.replaceWith(next); else into.prepend(next);
    if (names.length) mark(next);
  }
  redrawConcluded(into);
  for (const proposal of used.flatMap(each => each.rows || [])) {
    const line = [...into.querySelectorAll('.country-row.fact-line')].find(each => factOf(each).label.toLowerCase() === proposal.label.toLowerCase());
    if (!line || factOf(line).value) continue;   // a zone your nationality opens, or one you answered, keeps its answer
    const next = eligibilityRow({...proposal, kind: 'per_country'});
    line.replaceWith(next);
    mark(next);
  }
  detailsChanged();
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
  box_.replaceChildren(el('p', 'muted small', `${tidied.changed} of your details were tidied: a typed control, or the rules folded as a note for the AI. The words you saved are kept, and the copy from before is backed up.`), undo);
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
const paintFacts = (result, kept, settled = false) => {
  skeletons(false);
  if (!kept && !redrawing && factsDirty()) return;   // a refresh never redraws under unsaved edits (Discard all redraws on purpose)
  $('facts-message').textContent = '';
  draw(result.sections || {}, result.formats || {});
  factsRead();   // the drafts count from what is drawn now (details-drafts.js)
  // After the count: what it folds is a draft you save (Discard all redraws without it). Why (28 Oct 2026, #2322 review): only on the settled paint; a
  // fold on the quick paint made the card dirty, and the dirty guard above then kept the settled lines from drawing.
  if (!redrawing && settled) foldOlder(result.older || []);
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
    if (settled.ok) { keep('details-facts', settled); paintFacts(settled, false, true); } else if (settled.error) $('facts-message').textContent = settled.error;
  }
  redrawing = false;
  document.dispatchEvent(new CustomEvent('details-sorting', {detail: {on: false, changed: settled?.changed || 0}}));
  return quick;
}

// What the boxes hold now: {eligibility: [{label, value, kind}], ...} (a line with no value is dropped on save).
export function factsNow() {
  return Object.fromEntries(KEYS.map(key => [key, [...(box(key)?.querySelectorAll('.fact-line') || [])].map(factOf).filter(line => line.label && line.value)]));
}
