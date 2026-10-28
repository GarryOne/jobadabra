// Your details read first (owner's review, 18 Oct 2026, item 5: "a readable profile, not an expanded questionnaire"; UI redesign A): Contact, Professional links,
// Work eligibility, Availability & compensation and Languages each show a compact summary drawn from their editor's own boxes (so drafts, CV proposals and
// saving stay exactly as they were), a quiet Edit opens the editor in place, and Done leaves an editor with no change; with changes the Profile page's one
// bar decides, and Save all / Discard all close the editors. Contact and Links read as columns (mockup 05: icon · small grey label · value); the fact cards as a calm two-column summary (renderer/fact-summary.js). Guarded by test/details-read.test.js.
import {CARD_EDIT, el} from '../components.js';
import {chipLine, doneButton, factColumns, isEditing, setEditing} from '../card-shell.js';
import {checkBadge, checkCount, eligibilityView, languagesView, summaryView} from '../fact-summary.js';
import {icon} from '../icons.js';
import {factOf} from '../fact-line.js';

const $ = id => document.getElementById(id);
const value = key => String(document.querySelector(`[data-contact="${key}"]`)?.value || '').trim();
const shown = key => !document.querySelector(`[data-contact="${key}"]`)?.closest('label')?.hidden;

// Contact as columns (mockup 05): the name (salutation before it) over the location | how to reach you | where you live and the rest. Every detail
// shows, an empty one as "<label> not set" so a missing detail is seen; the Swiss-only Place of origin only when the form shows it.
export const CONTACT_ROWS = [['Name', ['first_name', 'last_name']], ['Salutation', ['salutation']], ['Email', ['email']], ['Phone', ['phone']],
  ['Location', ['location']], ['Street', ['street']], ['Postal code', ['postal_code']], ['Place of origin', ['place_of_origin']], ['Date of birth', ['birth_date']]];
const LINK_KEYS = ['linkedin', 'github', 'website'];
const CONTACT_KEYS = CONTACT_ROWS.flatMap(([, keys]) => keys);
// The icon lines of the 2nd and 3rd columns: [icon, label, keys].
export const CONTACT_LINES = [[['mail', 'Email', ['email']], ['phone', 'Phone', ['phone']]],
  [['home', 'Address', ['street', 'postal_code']], ['calendar', 'Date of birth', ['birth_date']], ['flag', 'Place of origin', ['place_of_origin']]]];

const notSet = label => el('span', 'muted', `${label} not set`);
export function contactView(read = value, visible = shown) {
  const joined = keys => keys.map(read).filter(Boolean).join(', ');
  const who = el('div', 'contact-who'), name = el('b', 'contact-name');
  const salutation = visible('salutation') && read('salutation');
  if (salutation) name.append(el('span', 'muted', `${salutation} `));
  name.append(['first_name', 'last_name'].map(read).filter(Boolean).join(' ') || notSet('Name'));
  who.append(name, read('location') ? el('span', 'muted', read('location')) : notSet('Location'));
  if (visible('salutation') && !salutation) who.append(notSet('Salutation'));
  const lines = group => {
    const list = el('ul', 'contact-lines');
    for (const [glyph, label, keys] of group.filter(([, , keys]) => keys.every(visible))) {
      const line = el('li');
      line.title = label;
      // A line of several details (Address: street, postal code) says each missing one, so none goes unseen.
      const missing = keys.filter(key => !read(key)).map(key => CONTACT_ROWS.find(([, row]) => row.includes(key))[0]);
      line.append(icon(glyph), ...(joined(keys) ? [el('span', '', joined(keys)), ...missing.map(part => notSet(`· ${part}`))] : [notSet(label)]));
      list.append(line);
    }
    return list;
  };
  return factColumns([{body: who}, ...CONTACT_LINES.map(group => ({body: lines(group)}))]);
}

// Professional links as columns: the site's icon, its name, the address in the link colour (GitHub only when its box shows: fitDetailsToCandidate).
export function linksView(read = value, visible = shown) {
  return factColumns([['linkedin', 'LinkedIn', 'linkedin'], ['github', 'GitHub', 'github'], ['website', 'Website', 'link']].filter(([key]) => visible(key)).map(([key, label, glyph]) => {
    const address = read(key).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    return {icon: glyph, label, value: address ? el('span', 'link-text', address) : el('span', 'muted', 'Not added')};
  }));
}

const linesOf = key => [...(document.querySelector(`[data-facts="${key}"]`)?.querySelectorAll('.fact-line') || [])]
  .map(row => ({...factOf(row), check: Boolean(row.querySelector('.ui-pill.tone-warn')), earlier: Boolean(row.querySelector('.ui-pill.tone-info'))}));

function drawFacts(key) {
  const into = document.querySelector(`[data-facts-read="${key}"]`);
  if (!into || into.dataset.loading) return;
  const lines = linesOf(key).filter(line => line.label);
  const eligibility = key === 'eligibility' ? eligibilityView(lines, chipLine) : null;
  into.replaceChildren(eligibility ? eligibility.node : !lines.length ? el('p', 'muted', 'Nothing yet. Edit to add a line.') : key === 'languages' ? languagesView(lines, chipLine) : summaryView(lines));
  // One count in the card's title, not a mark on every line.
  const heading = into.closest('.panel')?.querySelector('.card-words h3');
  heading?.querySelector('.fact-check')?.remove();
  const badge = checkBadge(eligibility ? eligibility.check : checkCount(lines));
  if (badge) { badge.classList.add('fact-check'); heading?.append(badge); }
}

// The cards, their read boxes and how many of their own fields differ (for Done). The counts come from pages/details-drafts.js through initDetailsRead
// (passed in, so this file stays light: the drafts module reaches the whole page).
let changed = {contact: () => 0, facts: () => 0};
const CARDS = [
  {id: 'setting-contact', draw: () => $('contact-read')?.replaceChildren(contactView()), count: () => changed.contact(CONTACT_KEYS)},
  {id: 'setting-links', draw: () => $('links-view')?.replaceChildren(linksView()), count: () => changed.contact(LINK_KEYS)},
  {id: 'setting-eligibility', draw: () => drawFacts('eligibility'), count: () => changed.facts('eligibility')},
  {id: 'setting-availability', draw: () => drawFacts('availability'), count: () => changed.facts('availability')},
  {id: 'setting-languages', draw: () => drawFacts('languages'), count: () => changed.facts('languages')},
];
const dones = new Map();

// Redraw every read view and Done from the boxes as they are now (after a read, an edit, a save or a discard).
export function refreshDetailsRead() {
  for (const card of CARDS) {
    if (!$(card.id)) continue;
    if (!isEditing($(card.id))) card.draw();
    dones.get(card.id)?.sync();
  }
}
// Save all / Discard all settled Your details: every editor with no change left closes (one whose save failed stays open with its drafts).
export function closeDetailsEditors() {
  for (const card of CARDS) if ($(card.id) && card.count() === 0) setEditing($(card.id), false);
  refreshDetailsRead();
}
export const editDetailsCard = id => { if ($(id)) { setEditing($(id), true); dones.get(id)?.sync(); } };

// counts: {contact(keys), facts(key)}: how many of those fields differ from what was read (details-drafts.js contactChangedIn, factsChangedIn).
export function initDetailsRead(counts) {
  changed = {...changed, ...counts};
  for (const card of CARDS) {
    const node = $(card.id);
    if (!node) continue;
    node.querySelector(CARD_EDIT)?.addEventListener('click', () => editDetailsCard(card.id));
    const done = doneButton(node, card.count);
    done.addEventListener('click', () => card.draw());
    node.querySelector('[data-done-slot]')?.replaceChildren(done);
    dones.set(card.id, done);
  }
  document.addEventListener('details-changed', refreshDetailsRead);
  document.addEventListener('details-settled', closeDetailsEditors);
}
