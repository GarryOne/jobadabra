// Moving between application questions in the review drawer (owner, 18 Oct 2026: "I don't like this dropdown... make it nice. Modern." →
// option A of https://claude.ai/artifact/7hsZipME4De62YarGwUTTP): one segment per question (click to jump; one plain bar past 30), a button that
// names the question and opens the queue list (the shared ⋯ menu's list rows: kind tile, where it comes from, its state, the set-aside ones
// apart, a search box from 9), and previous / next arrows. Replaces the native <select> (qr-pick). Drawn by pages/question-review.js, which owns
// the state and passes it in. Guarded by test/question-review.test.js ("navigator: …") and test/ui-menu-rows.test.js.
import {el, openMenu} from './components.js';
import {icon} from './icons.js';

const SEGMENTS_UP_TO = 30;   // past it each segment would be a few pixels wide: one plain bar instead
const SEARCH_FROM = 9;   // owner, 18 Oct 2026: "From 9 questions"

// What a Your details item asks for (lib/details-review.js), over its answer box and as its state in the list.
export const ASKS = {which: 'Pick the right one', where: 'Pick its home', check: 'Pick the parts', open: 'Missing answer', unclear: 'Make it sure', contact: 'Needed by every form', cvcheck: 'Check it'};

// A question's kind (question-kind.js KINDS) → its tile's icon.
const KIND_TILE = {text: 'file-text', long_text: 'file-text', single: 'sliders', multi: 'layers', yes_no: 'check-circle', date: 'calendar', amount: 'coins',
  salary: 'coins', duration: 'clock', link: 'link', per_country: 'globe', language: 'globe', range: 'sliders'};

// The navigator's words for a question: its first words, never a cut word.
export function shortTitle(text, most = 56) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= most) return clean;
  const cut = clean.slice(0, most);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), most - 12)).replace(/[\s,.;:–—-]+$/, '')}…`;
}

// Where a question comes from: its Your details section, or the form that asked it.
export const sourceOf = q => (q.setup ? 'Application setup' : q.details ? q.details.where || 'Your details' : [q.company, 'Application form'].filter(Boolean).join(' · '));

// Its state in the list: [words, tone] for pill(). Answered questions leave the queue, so these are the ones still open.
export function stateOf(q, {aside = false, drafted = false} = {}) {
  if (aside) return ['Set aside', 'neutral'];
  if (drafted) return ['Draft', 'neutral'];
  if (q.setup) return [q.priority, 'bad'];
  if (q.details) return [ASKS[q.details.kind] || 'Missing answer', 'warn'];
  return q.proposal ? ['Suggested', 'info'] : ['Missing', 'warn'];
}

// The header's "where am I" block. state: {queue, setAside, at, aside}; drafts: a Map of typed answers by key; go(kind, index): 'q' or 's'.
export function questionNav({queue, setAside, at, aside}, drafts, go) {
  const where = el('div', 'qr-where');
  const top = el('div', 'qr-where-top');
  top.append(el('b', '', aside ? 'A set-aside question' : `Question ${at + 1} of ${queue.length}`), progress(queue, at, aside, drafts, go));
  const current = aside || queue[at];
  const nav = Object.assign(el('button', 'qr-nav'), {type: 'button', id: 'qr-nav', title: 'All questions'});
  nav.setAttribute('aria-haspopup', 'menu');
  nav.setAttribute('aria-expanded', 'false');
  nav.append(el('span', 'qr-nav-tile', icon(KIND_TILE[current?.format?.kind] || 'help')), el('span', 'qr-nav-title', shortTitle(current?.question)),
    el('span', 'qr-nav-count', aside ? `${setAside.length} aside` : `${at + 1} / ${queue.length}`), icon('chevron'));
  nav.addEventListener('click', () => openMenu(nav, listItems({queue, setAside, at, aside}, drafts, go), {search: SEARCH_FROM, width: 'anchor'}));
  const row = el('div', 'qr-where-row');
  row.append(nav, arrow('qr-prev', 'Previous question', 'chevron', () => go('step', -1)), arrow('qr-next', 'Next question', 'chevron', () => go('step', 1)));
  where.append(top, row);
  return where;
}

function arrow(id, label, glyph, run) {
  const button = Object.assign(el('button', `secondary icon-btn qr-arrow ${id}`, icon(glyph)), {type: 'button', id, title: label, ariaLabel: label});
  button.addEventListener('click', run);
  return button;
}

// One segment per question (current marked, a typed draft tinted); past SEGMENTS_UP_TO the plain bar.
function progress(queue, at, aside, drafts, go) {
  if (queue.length > SEGMENTS_UP_TO) {
    const bar = el('div', 'bar qr-bar');
    const fill = el('span', '');
    fill.style.width = `${Math.round(((aside ? 0 : at + 1) / Math.max(queue.length, 1)) * 100)}%`;
    bar.append(fill);
    return bar;
  }
  const segs = el('div', 'qr-segs');
  segs.setAttribute('role', 'group');
  segs.setAttribute('aria-label', 'Questions');
  queue.forEach((q, index) => {
    const here = !aside && index === at;
    const seg = Object.assign(el('button', ['qr-seg', here && 'is-current', drafts.has(q.key) && 'is-draft'].filter(Boolean).join(' ')),
      {type: 'button', title: `${index + 1} · ${shortTitle(q.question)}`, ariaLabel: `Question ${index + 1}: ${shortTitle(q.question)}`});
    if (here) seg.setAttribute('aria-current', 'step');
    seg.addEventListener('click', () => go('q', index));
    segs.append(seg);
  });
  return segs;
}

// The queue as list rows, then the set-aside ones under their heading.
function listItems({queue, setAside, at, aside}, drafts, go) {
  const item = (q, kind, index) => ({label: shortTitle(q.question, 80), detail: sourceOf(q), tile: KIND_TILE[q.format?.kind] || 'help',
    badge: stateOf(q, {aside: kind === 's', drafted: drafts.has(q.key)}), current: kind === 's' ? aside === q : !aside && index === at, run: () => go(kind, index)});
  const items = queue.map((q, index) => item(q, 'q', index));
  if (setAside.length) items.push({heading: `Set aside · ${setAside.length} · not counted`}, ...setAside.map((q, index) => item(q, 's', index)));
  return items;
}
