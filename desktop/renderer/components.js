// Jobadabra's UI building blocks (styles in components.css, values in tokens.css). Screens build their
// pills, tags, tiles and ⋯ menus with these, so the same thing looks and behaves the same everywhere;
// gallery.html shows every one of them side by side.
import {icon} from './icons.js';
import {isRawValue} from './chip-text.js';
import {GATE_FOOTNOTE, GATE_TITLE, NOTION_BENEFITS} from './notion-benefits.js';

// el(tag, class, content): content is text, or a node (an icon, another element) that is appended, never
// turned into "[object SVGSVGElement]".
export const el = (tag, className, content) => {
  const node = Object.assign(document.createElement(tag), className ? {className} : {});
  if (content instanceof Node) node.append(content); else if (content != null) node.textContent = content;
  return node;
};

// Pill: a short status. Tones: neutral, info, good, warn, bad, signal, teal. dot: a coloured dot before it.
export const TONES = ['neutral', 'info', 'good', 'warn', 'bad', 'signal', 'teal', 'violet'];
export function pill(text, tone = 'neutral', {dot = false, title = ''} = {}) {
  const node = el('span', `ui-pill tone-${tone}${dot ? ' dot' : ''}`, text);
  if (title) node.title = title;
  return node;
}

// Live dot: one dot before a step or row of a running list (owner, 21 Oct 2026: "ticking dots on each row of live update"). state: live (pulses), done (still), warn (still, warning tone).
export const LIVE_STATES = ['live', 'done', 'warn'];
export const liveDot = (state = 'done') => Object.assign(el('i', `live-dot is-${state}`), {ariaHidden: 'true'});
// A list of live rows: the newest is live while `running`, the rest done; a row starting with the engine's own warning marker keeps its warning tone.
export function liveRows(lines, {running = true, className = 'run-card-row'} = {}) {
  return lines.map((text, i) => {
    const warn = /^(⚠|Warning:)/.test(text), row = el('li', className);
    row.append(liveDot(warn ? 'warn' : running && i === lines.length - 1 ? 'live' : 'done'), el('span', '', text.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '')));   // the dot carries the state: a leading emoji would be a second marker
    return row;
  });
}

// Tag: a label (a skill, a topic). With onClick it's a button, in the accent colour (📝 Kit, 📄 Tailored CV).
export function tag(text, {title = '', onClick = null, busy = false} = {}) {
  const node = el(onClick ? 'button' : 'span', `ui-tag${onClick ? ' is-action' : ''}${busy ? ' is-busy' : ''}`, text);
  if (title) node.title = title;
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

// Chip: one value from a list (a skill, a place, a language and its level). Design system (docs/rules/desktop-ui.md): a chip is a value, a pill a status,
// a tag a label. text: the value as a person writes it, never syntax (quotes, /regex/, codes: the screen turns those into meaning first, e.g. a group
// "Whole word only"); such text is marked data-raw (renderer/chip-text.js) and the render tests fail on it. detail: a muted part after it ("C1", "German");
// tone 'bad': a value that blocks (needs a visa); onRemove: an × to take it out (edit), its label names the value.
export function chip(text, {detail = '', tone = '', onRemove = null, title = ''} = {}) {
  const value = String(text ?? '').trim();
  const node = el('span', `chip-tag${tone ? ` tone-${tone}` : ''}${onRemove ? ' removable' : ''}`);
  node.append(el('span', 'chip-value', value));
  if (detail) node.append(el('span', 'chip-detail', detail));
  if (title) node.title = title;
  if (isRawValue(value)) node.dataset.raw = '1';
  if (onRemove) {
    const remove = Object.assign(el('button', 'x', '×'), {type: 'button', title: `Remove ${value}`});
    remove.setAttribute('aria-label', `Remove ${value}`);
    remove.addEventListener('click', onRemove);
    node.append(remove);
  }
  return node;
}

// Tile: an icon on a soft square of its tone (a recording, a schedule slot).
export function tile(glyph, tone = 'signal') {
  const node = el('span', `ui-tile tone-${tone}`);
  node.append(icon(glyph));
  return node;
}

// Choice cards: one of a few options side by side (radio cards), each an icon tile, a bold title, a short description
// and a check badge on the chosen one. choices: [{id, icon, title, text, disabled?, note?, logo?, size?}] (`logo`: a mark from assets/ai/ instead of the icon tile;
// `size`: 'hero' for the one card that leads, 'compact' for small side cards); selected: an id or null
// (nothing chosen yet); onPick(id) when one is clicked.
// A provider's mark (renderer/assets/ai/<name>.svg), drawn as a mask so it takes the text colour in light and dark.
function logoTile(name, on) {
  const node = el('span', `ui-tile ui-logo-tile tone-${on ? 'signal' : 'neutral'}`);
  node.append(el('span', `ui-logo ui-logo-${name}`));
  node.querySelector('.ui-logo').setAttribute('aria-hidden', 'true');
  return node;
}

export function choiceCards(choices, {selected = null, onPick = () => {}, label = ''} = {}) {
  const group = el('div', 'ui-choices');
  group.setAttribute('role', 'radiogroup');
  if (label) group.setAttribute('aria-label', label);
  for (const choice of choices) {
    const card = el('button', `ui-choice${choice.id === selected ? ' is-selected' : ''}${choice.disabled ? ' is-disabled' : ''}${choice.size ? ` is-${choice.size}` : ''}`);
    Object.assign(card, {type: 'button', disabled: !!choice.disabled});
    card.dataset.choice = choice.id;
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(choice.id === selected));
    const text = el('span', 'ui-choice-text');
    text.append(el('b', '', choice.title), el('span', 'muted small', choice.text));
    if (choice.note) text.append(el('span', 'ui-choice-note small', choice.note));
    const check = el('span', 'ui-choice-check');
    check.append(icon('tick'));
    card.append(choice.logo ? logoTile(choice.logo, choice.id === selected) : tile(choice.icon, choice.id === selected ? 'signal' : 'neutral'), text, check);
    card.addEventListener('click', () => onPick(choice.id));
    group.append(card);
  }
  return group;
}

// ⋯ menu: one floating list for the whole window, closed by Esc, a click outside, scrolling or picking an item.
// Items: {label, run(event), title?, danger?, icon?} (icon: a name from icons.js) or '-' for a divider. A list row (the question navigator,
// renderer/question-nav.js; owner, 18 Oct 2026) adds detail (a muted second line), tile (an icon in a tile), badge ([text, tone]: a pill) and
// current (marked); {heading} names the group below it. Options: search (a search box from that many rows), width 'anchor' (the anchor's width).
// Styles in ui-menu.css. Guarded by test/ui-menu-rows.test.js and test/more-button-menu.test.js.
const menu = el('div', 'ui-menu');
menu.hidden = true;
menu.setAttribute('role', 'menu');
document.body.append(menu);
let menuAnchor = null;   // the ⋯ button the open menu belongs to
let menuAt = null;   // where that button was when the menu opened: a scroll that did not move it leaves the menu open
// within: close it only when its ⋯ button is inside that element. A list that redraws passes its own page, so a background redraw of Jobs
// does not close a menu open on Focus (6 Oct 2026: the e2e "I'm out: withdraw" click found no menu, closed by a Jobs read finishing).
export function closeMenu(within = null) {
  if (within && !(menuAnchor && within.contains(menuAnchor))) return;
  menu.hidden = true;
  menuAnchor?.setAttribute?.('aria-expanded', 'false');   // any anchor (the question navigator's button too), not only a ⋯
  menuAnchor = null;
  menuAt = null;
  for (const open of document.querySelectorAll('.ui-more[aria-expanded="true"]')) open.setAttribute('aria-expanded', 'false');
}
function menuItem(item) {
  if (item === '-') return document.createElement('hr');
  if (item.heading) return el('p', 'ui-menu-heading', item.heading);
  const row = Boolean(item.detail || item.tile || item.badge || item.current);
  const button = el('button', [item.danger && 'danger', item.icon && 'with-menu-icon', row && 'ui-menu-row', item.current && 'is-current'].filter(Boolean).join(' '), item.icon ? icon(item.icon) : null);
  if (row) {
    const words = el('span', 'ui-menu-words', el('span', 'ui-menu-label', item.label));
    if (item.detail) words.append(el('span', 'ui-menu-detail', item.detail));
    button.append(...[item.tile && el('span', 'ui-menu-tile', icon(item.tile)), words, item.badge && pill(...item.badge)].filter(Boolean));
    button.dataset.find = `${item.label} ${item.detail || ''}`.toLocaleLowerCase();
  } else if (item.icon) button.append(item.label); else button.textContent = item.label;
  if (item.current) button.setAttribute('aria-current', 'true');
  button.title = item.title || '';
  if (item.wand) button.dataset.wand = '';   // an AI action: the wand cursor (magic.css)
  button.disabled = !!item.disabled;
  button.setAttribute('role', 'menuitem');
  button.addEventListener('click', event => { closeMenu(); item.run(event); });
  return button;
}
// Typed words filter the rows (every word in the label or detail); a heading hides when its group has none left.
function filterMenu(query) {
  const words = String(query).toLocaleLowerCase().split(/\s+/).filter(Boolean);
  let heading = null, shown = 0;
  for (const node of menu.children) {
    if (node.classList.contains('ui-menu-heading')) { if (heading) heading.hidden = !shown; heading = node; shown = 0; continue; }
    if (node.tagName !== 'BUTTON') continue;
    node.hidden = !words.every(word => (node.dataset.find || node.textContent.toLocaleLowerCase()).includes(word));
    if (!node.hidden) shown++;
  }
  if (heading) heading.hidden = !shown;
}
// ↑ / ↓ (wrapping), Home / End: the next row to focus among count rows; at = -1 from the search box. null: not a move key.
export function menuStep(at, count, key) {
  if (!count) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return at < 0 ? 0 : (at + 1) % count;
  if (key === 'ArrowUp') return at <= 0 ? count - 1 : at - 1;
  return null;
}
menu.addEventListener('keydown', event => {
  const rows = [...menu.querySelectorAll('button')].filter(button => !button.hidden && !button.disabled);
  const next = menuStep(rows.indexOf(document.activeElement), rows.length, event.key);
  if (next === null) return;
  event.preventDefault();
  rows[next].focus();
});
export function openMenu(anchor, items, {search = 0, width = 'auto'} = {}) {
  const wasOpen = anchor.getAttribute('aria-expanded') === 'true';
  closeMenu();
  if (wasOpen) return;
  const nodes = items.map(menuItem);
  const rows = items.filter(item => item !== '-' && !item.heading).length;
  if (search && rows >= search) {
    const box = Object.assign(document.createElement('input'), {type: 'search', placeholder: 'Find…', ariaLabel: 'Find in this list'});
    box.addEventListener('input', () => filterMenu(box.value));
    nodes.unshift(el('label', 'search-box ui-menu-search', icon('search')));
    nodes[0].append(box);
  }
  menu.replaceChildren(...nodes);
  menu.classList.toggle('is-list', nodes.some(node => node.classList?.contains('ui-menu-row')));
  menu.hidden = false;
  anchor.setAttribute('aria-expanded', 'true'); menuAnchor = anchor;
  const box = anchor.getBoundingClientRect();
  menuAt = {top: box.top, left: box.left};
  menu.style.width = width === 'anchor' ? `${box.width}px` : '';
  const below = box.bottom + 6 + menu.offsetHeight <= window.innerHeight;
  menu.style.top = `${Math.max(8, below ? box.bottom + 6 : box.top - menu.offsetHeight - 6)}px`;
  menu.style.left = `${Math.max(8, width === 'anchor' ? box.left : box.right - menu.offsetWidth)}px`;
  (menu.querySelector('.ui-menu-search input') || menu.querySelector('button.is-current') || menu.querySelector('button'))?.focus();
}
// A click on the menu or on the button that opened it (a ⋯, or any anchor such as the question navigator) is not "outside".
document.addEventListener('click', event => { if (!menu.hidden && !event.target.closest('.ui-menu, .ui-more') && !menuAnchor?.contains(event.target)) closeMenu(); });
// Esc closes an open menu and only it (the drawer under it, which also closes on Esc, waits for defaultPrevented).
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { closeMenu(); event.preventDefault(); } });
// A scroll closes the menu only when it moved its ⋯ button (or the button left the page). Scroll events arrive a frame late: the scroll that brings a
// button into view before a click (Playwright's, a keyboard focus) landed after the menu had opened and shut it at once (7 Oct 2026, the Windows
// focusdismiss suite: "waiting for getByRole('menuitem', { name: 'Dismiss interview' })" for 30 s).
export function scrollCloses(anchor, at) {
  if (!anchor?.isConnected || !at) return true;
  const box = anchor.getBoundingClientRect();
  return Math.abs(box.top - at.top) > 1 || Math.abs(box.left - at.left) > 1;
}
document.addEventListener('scroll', () => { if (!menu.hidden && scrollCloses(menuAnchor, menuAt)) closeMenu(); }, true);   // not `closeMenu` itself: the Event would be taken as `within` and throw (#307)

// The ⋯ button that opens a menu. items: an array, or a function returning one (built when opened).
export function moreButton(items, title = 'More actions') {
  const button = el('button', 'secondary ui-more');
  button.title = title;
  button.setAttribute('aria-label', 'More actions');
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.append(icon('more'));
  button.addEventListener('click', () => openMenu(button, typeof items === 'function' ? items() : items));
  return button;
}

// Why connect Notion: the advantages as a list (an icon tile, a bold lead, a sentence). count: only the first few.
// compact: a small plain icon instead of the tile, for a card that already has its own tile (Optional extras).
export function notionBenefits(count = NOTION_BENEFITS.length, {compact = false} = {}) {
  const list = el('ul', compact ? 'ui-benefits is-compact' : 'ui-benefits');
  for (const item of NOTION_BENEFITS.slice(0, count)) {
    const line = el('li');
    line.append(compact ? icon(item.icon, 'icon ui-benefit-icon') : tile(item.icon, 'signal'), el('span', 'ui-benefit-text'));
    line.lastChild.append(el('b', '', `${item.lead}:`), ` ${item.text}`);
    list.append(line);
  }
  return list;
}

// A page that needs Notion, until it is connected: the reason, the advantages and one button (pages/notion-connect.js).
export function notionGate({reasonText = '', onConnect = () => {}} = {}) {
  const card = el('section', 'card ui-gate');
  const connect = el('button', 'primary', 'Connect with Notion');
  connect.type = 'button';
  connect.addEventListener('click', onConnect);
  card.append(el('h2', '', GATE_TITLE), ...(reasonText ? [el('p', 'ui-gate-reason', reasonText)] : []), notionBenefits(),
    el('p', 'muted small', GATE_FOOTNOTE), connect);
  return card;
}

// A number that changes while you look at it (a refresh scores, closes, writes) flashes once: up and down in their own colour, the card it
// sits in glows with it. Not on the first value, not when it is the same, not with reduced motion (components.css .count-up/.count-down).
// Owner, 7 Oct 2026: "flash it every time it increases/decreases".
// Returns what it did, for the log: 'first', 'same', 'not a number' or 'flashed'.
export function setCount(node, value) {
  if (!node) return 'no node';
  const before = Number(node.textContent), after = Number(value);
  node.textContent = value;
  if (node.dataset.counted !== '1') { node.dataset.counted = '1'; return 'first'; }
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 'not a number';
  if (before === after) return 'same';
  const card = node.closest('.stat') || node;
  for (const target of new Set([node, card])) {
    target.classList.remove('count-up', 'count-down');
    void target.offsetWidth;   // restart the animation when it changes twice in a row
    target.classList.add(after > before ? 'count-up' : 'count-down');
  }
  return 'flashed';
}

// Collapsible panel: the whole head bar (.panel-top) of a .panel is the toggle, not only the chevron. Keyboard: Enter / Space.
// A click on a button, link or field inside the bar (its actions) does not toggle. The choice is remembered per `key`.
// Collapsed hides everything but the bar (components.css .panel.is-collapsed). Use it for any panel that can get long.
// `collapsed: true` is the start state until the user has chosen (long detail cards start closed).
const COLLAPSE_KEY = 'collapsed-panels';
const savedCollapsed = () => { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || {}; } catch { return {}; } };
const CONTROL = 'button, a, input, select, textarea, label';
// A control inside `bar` was pressed. Read from the event's path, which is fixed when the click starts: a button that redraws its own card (Edit)
// is gone from the page by the time the click reaches the bar, and a detached target is not "inside" it any more (owner, 18 Oct 2026: Edit folded its card).
export function isInteractiveTarget(target, bar, event) {
  const path = event?.composedPath?.() || [];
  const at = path.indexOf(bar);
  if (at > 0) return path.slice(0, at).some(node => node.matches?.(CONTROL));
  const hit = target?.closest?.(CONTROL);
  return !!hit && bar.contains(hit) && hit !== bar;
}
// The same for a bar or row that already has its own chevron button (not a .panel): a click anywhere on `bar` runs `toggle`, except on its other
// buttons, links and fields; the bar gets the pointer cursor (.is-bar-toggle). The chevron button keeps Enter/Space for the keyboard.
export function toggleOnBar(bar, toggle) {
  bar.classList.add('is-bar-toggle');
  bar.addEventListener('click', event => {
    const hit = event.target.closest?.(CONTROL);
    if (hit?.classList.contains('is-bar-chevron')) return;
    if (!isInteractiveTarget(event.target, bar, event)) toggle();
  });
}
// A compact card with ONE main action (owner, 19 Oct 2026: "anywhere I click on this card should open the drawer"): a click on the card's empty area presses `main`.
// A click on another button, link or field, or the end of a text selection, does not; `main` stays the one tab stop. Marked `.is-card-opens` (cursor + hover, components.css).
export function cardOpens(card, main) {
  card.classList.add('is-card-opens');
  card.addEventListener('click', event => {
    if (event.target === main || main.contains(event.target) || isInteractiveTarget(event.target, card, event)) return;
    if (globalThis.getSelection?.()?.toString()) return;
    main.click();
  });
}
export function collapsiblePanel(panel, key = panel.id, {collapsed = false} = {}) {
  const bar = panel.querySelector(':scope > .panel-top');
  if (!bar || bar.dataset.collapsible) return null;
  bar.dataset.collapsible = '1';
  bar.classList.add('is-toggle');
  bar.tabIndex = 0;
  bar.setAttribute('role', 'button');
  // One right-side group after the title: the bar's loose buttons (a card's Edit), its .panel-actions and the chevron end at the same right edge.
  let actions = bar.querySelector(':scope > .panel-actions');
  if (!actions) { actions = document.createElement('div'); actions.className = 'panel-actions'; }
  const loose = [...bar.children].slice(1).filter(node => node !== actions);
  actions.prepend(...loose);
  actions.append(icon('chevron', 'icon panel-chevron'));
  bar.append(actions);
  const set = (collapsed, {remember = true} = {}) => {
    panel.classList.toggle('is-collapsed', collapsed);
    bar.setAttribute('aria-expanded', String(!collapsed));
    if (!remember || !key) return;
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify({...savedCollapsed(), [key]: collapsed})); } catch { /* private window: it still works, just not remembered */ }
  };
  bar.addEventListener('click', event => { if (!isInteractiveTarget(event.target, bar, event)) set(!panel.classList.contains('is-collapsed')); });
  bar.addEventListener('keydown', event => {
    if (event.target !== bar || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    set(!panel.classList.contains('is-collapsed'));
  });
  set(key in savedCollapsed() ? !!savedCollapsed()[key] : collapsed, {remember: false});
  folds.set(panel, set);
  return {set};
}
// Open a folded card without remembering it as the person's choice (a card being edited stays open: card-shell.js). A <details> card opens too.
const folds = new WeakMap();
export function unfold(panel) {
  if (!panel) return;
  if (panel.tagName === 'DETAILS') { if (!panel.open) { panel.open = true; panel.dispatchEvent?.(new Event('toggle')); } return; }
  if (panel.classList.contains('is-collapsed')) folds.get(panel)?.(false, {remember: false});
}

// A result card's head, the insight card's shape (.insight-head): the kicker (its category, then any badges: a pill, a source), the title,
// then a line under it per subtitle (empty ones skipped). Every result card in Recent activity and Form fills starts with one; a caller adds
// more to the returned header (a link line) as before.
export function cardHead(category, title, {badges = [], subtitles = []} = {}) {
  const head = el('header', 'insight-head');
  const kicker = el('div', 'insight-kicker');
  kicker.append(el('span', 'insight-category', category), ...badges);
  head.append(kicker, el('h3', 'insight-title', title), ...subtitles.filter(Boolean).map(text => el('p', 'insight-subtitle', text)));
  return head;
}

// A card's Edit (or Add) button: quiet (a neutral outline, pencil + the word, always visible), last in the card's title line, the same place on every card
// (owner, 18 Oct 2026, UI redesign D1: "a compact pencil + Edit button at the right of each card header, with a neutral outline and readable contrast";
// it was solid that morning only so it sat in sight). Hidden while its card is edited (card-shell.js setEditing): filled orange is for Save. Static markup
// uses the same classes (`secondary small-btn with-icon card-edit` + <i data-icon="edit">). what = the card's name, for the screen reader ("Edit summary").
// A row's own action (a rule's Edit, a letter's Edit beside Copy) is not a card's Edit. Guarded by test/card-edit.test.js and test/card-system.test.js.
export const CARD_EDIT = '.card-edit';   // finds a card's Edit, static or drawn (pages/details-read.js)
export function cardEdit(label, what, onClick) {
  const button = Object.assign(el('button', 'secondary small-btn with-icon card-edit'), {type: 'button'});
  button.append(icon(label === 'Add' ? 'plus' : 'edit'), el('span', '', label));
  if (what) button.setAttribute('aria-label', `${label} ${what}`);
  button.addEventListener('click', onClick);
  return button;
}

// A strip of figures (.insight-numbers), one cell per {label, value}: the label over the value in bold, or with valueFirst the value
// over its label, both plain (the few-jobs coverage card's counts).
export function numberStrip(cells, {valueFirst = false} = {}) {
  const strip = el('div', 'insight-numbers');
  for (const {label, value} of cells) {
    const cell = el('div', 'insight-number');
    cell.append(...(valueFirst ? [el('span', 'insight-number-value', value), el('span', 'insight-number-label', label)]
      : [el('span', 'insight-number-label', label), el('b', 'insight-number-value', value)]));
    strip.append(cell);
  }
  return strip;
}

// The card a tab shows while nothing has been read yet: the shared shimmer lines under the line saying what is read (Profile tabs, renderer/swr.js).
export function loadingCard(what = 'Reading it from your store…', lines = [40, 90, 75, 60]) {
  const card = el('div', 'summary-card loading-card');
  card.setAttribute('role', 'status');
  card.append(...lines.map(width => Object.assign(el('span', 'skeleton'), {style: `width:${width}%`})), el('span', 'muted small', what));
  return card;
}
