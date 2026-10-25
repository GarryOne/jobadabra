// Shared page blocks of the UI redesign (owner, 18 Oct 2026, via the coordinator: "the design system needs these before B, C and D each build their own"):
// a review list (pending first, done folded as "Reviewed · N"), an empty state ("Not created" + one line + two actions), summary tiles (icon, label, big
// value), and a read-only reference row ("From Your details" + one link). Styles: page-parts.css. Rules: docs/rules/desktop-ui.md "Page blocks".
// Living copy: npm run gallery → "Page blocks". Guarded by test/page-parts.test.js.
import {el, pill, tile} from './components.js';
import {icon} from './icons.js';
import {wand} from './magic.js';

const button = (label, className, run, aria = '') => {
  const node = Object.assign(el('button', className, label), {type: 'button'});
  if (aria) node.setAttribute('aria-label', aria);   // rows with the same action words ("Confirm skill") say which row they act on
  node.addEventListener('click', run);
  return node;
};

// A list of things to review (CV gaps, Needs review, CV check fixes): each item is its title, why it is here and where it came from, a status chip and its
// actions. Pending items come first in the order given; done ones fold under "Reviewed · N". items: [{key, title, why?, source?, status: {text, tone}, done?,
// actions: [{label, run, primary?, aria?, link?}], detail?, detailLabel?}]. Filled orange is the list's ONE next step: the first pending item's primary
// action; others are outlined, or a text link with link: true (Dismiss, Undo); aria names the row when rows share action words. A done item keeps its actions.
// detail: the whole row opens it ("View details ›" at the row's right end, the detail under the row, in line with the title), mockup 08.
// Options: statusAt 'end' (default) | 'first' (a priority, fixed width, mockup 08) | 'title' (beside the name, mockup 06); joined: one bordered list with
// row dividers (mockup 06); doneSummary(doneItems): a muted line beside "Reviewed · N" ("OpenTelemetry confirmed · Vault dismissed"); doneOpen.
export function reviewList(items = [], {doneLabel = 'Reviewed', empty = 'Nothing to review.', statusAt = 'end', joined = false, doneSummary = null, doneOpen = false} = {}) {
  const box = el('div', `review-list status-${statusAt}${joined ? ' is-joined' : ''}`);
  let lead = false;   // the list's one orange button is drawn
  const row = item => {
    const node = el('li', `review-item${item.done ? ' is-done' : ''}`);
    node.dataset.key = item.key || '';
    const main = el('div', 'review-main'), title = el('div', 'review-title');
    const status = item.status ? pill(item.status.text, item.status.tone || 'neutral') : el('span');
    title.append(el('b', '', item.title || ''));
    if (statusAt === 'title' && item.status) title.append(status);
    main.append(title);
    if (item.why) main.append(el('span', 'muted', item.why));
    if (item.source) main.append(el('span', 'muted small review-source', item.source));
    const actions = el('div', 'review-actions');
    for (const action of item.actions || []) {
      const primary = action.primary && !item.done && !lead && (lead = true);
      const look = action.link ? 'link small' : `${primary ? 'primary' : 'secondary'} small-btn`;
      // preventDefault: a button inside a row that folds its detail acts, it does not fold the row
      actions.append(button(action.label, look, event => { event?.preventDefault?.(); action.run?.(item); }, action.aria));
    }
    const parts = statusAt === 'first' ? [status, main] : statusAt === 'end' ? [main, status] : [main];
    if (!item.detail) { node.append(...parts, actions); return node; }
    node.classList.add('has-detail');
    const fold = el('details', 'plain review-fold'), head = el('summary', 'review-row'), more = el('span', 'review-more muted small');
    more.append(el('span', 'review-more-words', item.detailLabel || 'View details'), icon('chevron'));
    head.append(...parts, more, actions);
    const body = el('div', 'review-detail');
    body.append(item.detail);
    fold.append(head, body);
    node.append(fold);
    return node;
  };
  const pending = items.filter(item => !item.done), done = items.filter(item => item.done);
  if (!items.length) { box.append(el('p', 'muted', empty)); return box; }
  const frame = joined ? el('div', 'review-box') : box;   // joined: the Reviewed line is the box's last row (mockup 06)
  if (joined) box.append(frame);
  if (pending.length) { const list = el('ul', 'review-items'); list.append(...pending.map(row)); frame.append(list); }
  if (done.length) {
    const fold = el('details', 'plain review-done'), list = el('ul', 'review-items'), head = el('summary', 'review-done-head'), tick = icon('check-circle');
    tick.classList.add('review-done-tick');
    head.append(icon('chevron'), tick, el('b', '', `${doneLabel} · ${done.length}`));
    if (doneSummary) head.append(el('span', 'muted small', doneSummary(done)));
    list.append(...done.map(row));
    fold.append(head, list);
    fold.open = Boolean(doneOpen);
    frame.append(fold);
  }
  return box;
}

// Something not made yet (a base letter, a first CV): a neutral chip, an icon, a title, one line, then two actions (the first is the primary next step,
// the second quiet) and an optional muted note under them. actions: [{label, run, ai}] (at most two; ai: true when the AI does the work: the wand cursor and burst, magic.js).
export function emptyState({icon = 'file', chip = 'Not created', title = '', text = '', actions = [], note = ''} = {}) {
  const box = el('div', 'empty-state');
  box.append(tile(icon, 'neutral'));
  if (chip) box.append(pill(chip, 'neutral'));
  if (title) box.append(el('b', 'empty-state-title', title));
  if (text) box.append(el('p', 'muted', text));
  if (actions.length) {
    const row = el('div', 'empty-state-actions');
    row.append(...actions.slice(0, 2).map((action, i) => action.ai ? wand(button(action.label, i === 0 ? 'primary' : 'secondary', () => action.run?.())) : button(action.label, i === 0 ? 'primary' : 'secondary', () => action.run?.())));
    box.append(row);
  }
  if (note) box.append(el('p', 'muted small', note));
  return box;
}

// A row of figures with an icon each (Main goals, CV scores): icon on its tone, label, the value big; an empty value reads "Not set". As many across as fit
// (240px each at least). tiles: [{key, icon, tone, label, value, note?, title?, score?, max?, more?}] (more: "+2 more" after the value; badge: {text, tone, title}, a status pill beside it). A score (CV scores: 82 of 100) draws a ring filled to
// score/max in place of the icon, in the tile's tone (good / ok / low); its value defaults to the score. A missing score (null) is an empty ring and "Not set".
const ring = (score, max, tone) => {
  const node = el('span', `summary-ring tone-${tone}`);
  const share = Number.isFinite(score) && max > 0 ? Math.max(0, Math.min(1, score / max)) : 0;
  node.style.setProperty('--p', String(Math.round(share * 100)));
  node.append(el('b', '', Number.isFinite(score) ? String(score) : '–'));
  return node;
};
// divided: no box per tile, a divider between them (roomy cards, mockup 03 Main goals).
export function summaryTiles(tiles = [], {divided = false} = {}) {
  const box = el('div', `summary-tiles${divided ? ' is-divided' : ''}`);
  for (const {key = '', icon = 'info', tone = 'neutral', label = '', value: given, note = '', title = '', score, max = 100, more = '', badge = null} of tiles) {
    const scored = score !== undefined;
    const value = given ?? (scored && Number.isFinite(score) ? String(score) : '');
    const cell = el('div', `summary-tile${scored ? ' has-ring' : ''}`);
    cell.dataset.key = key;
    if (title) cell.title = title;
    const set = String(value ?? '').trim();
    const words = el('div', 'summary-tile-words');
    const big = el('b', `summary-tile-value${set ? '' : ' is-empty'}`, set || 'Not set');
    if (set && scored && given === undefined) big.append(el('span', 'summary-tile-of', ` / ${max}`));   // "82 / 100": the scale small and muted (mockup 08)
    if (set && more) big.append(el('span', 'summary-tile-of', ` ${more}`));   // "+2 more" inline, never a lone line under the value
    if (set && badge) big.append(pill(badge.text, badge.tone || 'warn', {title: badge.title || ''}));   // a status beside the value ("As written"), its words on hover
    words.append(el('span', 'summary-tile-label', label), big);
    if (note) words.append(el('span', 'muted small', note));
    cell.append(scored ? ring(score, max, tone) : tile(icon, tone), words);
    box.append(cell);
  }
  return box;
}

// A fact shown on one page but kept on another (Strategy's or Cover letter's view of Your details): where it comes from, the words, one quiet link there.
// open(): opens the page and card that holds it (pages/settings.js openSetting(key)).
export function referenceRow({text = '', from = 'From Your details', link = 'Edit in Your details', open = () => {}} = {}) {
  const row = el('div', 'reference-row');
  row.append(el('span', 'muted small reference-from', from), el('span', 'reference-text', text), button(link, 'link small', () => open()));
  return row;
}
