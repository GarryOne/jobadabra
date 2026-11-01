/* global document, getComputedStyle */
// The design rules a screen can be checked against, from the owner's UI feedback (18 Oct 2026; docs/rules/desktop-ui.md "Read views, lists, buttons and choices").
// designRules() runs inside the page (self-contained: page.evaluate sends only its source) on every view a journey visits (lib/layout.mjs snap) and on the
// design-system page's examples (test/design-rules.test.mjs). Each finding names its card: {view, severity, kind, card, detail}. A finding on a screen
// that broke the rule before it was written is listed in KNOWN_LEFT (shrink-only, test/design-rules.test.mjs) with the session fixing it; anything else is severe.
// Parked by the owner on 18 Oct 2026 ("I can check by myself, on the before/after screenshots"): no journey, test or PR runs these checks while this is false.
export const DESIGN_RULES_ON = false;
export const RULE_LIMITS = {buttonHeight: 40, listItems: 12, chips: 12, selectOptions: 7, labelColumn: 240, dividedWidth: 560};
// scope (optional): a selector to check instead of the view (the design-system page checks one section at a time).
export function designRules({view, limits, scope = ''}) {
  const found = [];
  const root = document.querySelector(scope || `.view[data-view="${view}"]`) || document.body;
  const visible = el => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden' && el.offsetParent !== null; };
  const words = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const rgb = value => (String(value).match(/[\d.]+/g) || []).map(Number);
  const CARD = '.g-state, .panel, .summary-card, .insight-card, .setting, .answer-item, .card';
  const cardOf = el => el.closest(CARD);
  const cardName = card => (card && words(card.querySelector('h3, h4, h2') || card).slice(0, 50)) || 'page';
  const add = (kind, el, detail) => found.push({view, severity: 'severe', kind, card: cardName(cardOf(el)), detail});
  const READ_ONLY_SKIP = 'input, textarea, select, pre, code, details, .card-editor, .read-note, [data-technical], .tech-log';

  // 1. Read views show values, never raw notes: "[language]" tags, "(note: …)", "(confirmed …)" or "Confirmed 26 Sep 2026" inside a value (a note is a muted
  //    line under its value or a fold). The deepest element whose own words hold it is named.
  const RAW = [/\[[a-z][a-z ]{2,20}\]/, /\(note:/i, /\(confirmed\b/i, /\bconfirmed (?:by [A-Z]\w+ )?\d{1,2} [A-Z][a-z]{2,8} \d{4}/i];
  for (const el of root.querySelectorAll('dd, p, span, div, li, td')) {
    if (!visible(el) || el.closest(READ_ONLY_SKIP) || [...el.children].some(child => RAW.some(re => re.test(words(child))))) continue;
    const text = words(el), hit = RAW.find(re => re.test(text));
    if (hit) { add('raw-note-in-value', el, `"${text.match(hit)[0]}" sits inside a shown value: show the value; a note goes in a muted line under it or a fold ("${text.slice(0, 70)}")`); }
  }
  // 2. Long lists fold: a value of many items as one paragraph, or a row of many chips with no "+N more" / "Show all".
  const ownWords = el => [...el.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join(' ').replace(/\s+/g, ' ').trim();
  for (const el of root.querySelectorAll('dd, p, span, div, li, td')) {
    if (!visible(el) || el.closest(READ_ONLY_SKIP) || el.children.length > 2 || ownWords(el).length < words(el).length * 0.6) continue;   // the element that holds the words, never a container
    const items = words(el).split(/\s*[,;·]\s*/).filter(part => part && part.length <= 40);
    if (items.length >= limits.listItems) add('long-list-unfolded', el, `${items.length} items written out in one paragraph: show the first few as chips and "+N more" ("${words(el).slice(0, 60)}…")`);
  }
  for (const row of root.querySelectorAll('.read-values, .chip-row, .chips')) {
    if (!visible(row)) continue;
    const chips = [...row.querySelectorAll('.chip-tag, .chip-button, .ui-tag')].filter(visible);
    const folds = [...row.parentElement.querySelectorAll('button, a')].some(control => visible(control) && /^\+\d+|more|show all/i.test(words(control)));
    if (chips.length > limits.chips && !folds) add('long-list-unfolded', row, `${chips.length} chips in a row with no "+N more": fold the rest`);
  }
  // 5. Buttons: a normal height, words on one line; one primary per card.
  const BUTTONS = 'button.primary, button.secondary, button.ghost, button.danger, button.danger-outline';
  const NOT_A_BUTTON_ROW = '.choice-cards, .service-card, .settings-nav, .segmented, .chip-row, .tabs, .ui-menu, .composer-tools';
  const primaries = new Map();
  for (const button of root.querySelectorAll(BUTTONS)) {
    if (!visible(button) || button.closest(NOT_A_BUTTON_ROW)) continue;
    // Lines of words only: an icon beside the word (the quiet Edit's pencil) has its own box at another height and is not a second line.
    const texts = document.createTreeWalker(button, 4), tops = [];
    for (let node = texts.nextNode(); node; node = texts.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      tops.push(...[...range.getClientRects()].filter(rect => rect.width > 1).map(rect => rect.top));
    }
    const lines = tops.sort((a, b) => a - b).filter((top, i) => i === 0 || top - tops[i - 1] > 4).length;
    const height = Math.round(button.getBoundingClientRect().height);
    if (height > limits.buttonHeight || lines > 1) add('fat-button', button, `"${words(button)}" is ${height}px tall on ${lines} line(s) (at most ${limits.buttonHeight}px, one line): give it room, never wrap its words`);
    if (button.matches('button.primary') && !button.disabled) { const card = cardOf(button); primaries.set(card, [...(primaries.get(card) || []), button]); }
  }
  for (const [card, list] of primaries) if (card && list.length > 1) add('many-primaries', list[1], `${list.length} filled orange buttons in one card (${list.map(words).join(', ')}): one primary, the others secondary`);
  // 7. One "Note for the AI" fold per card.  8. One row per field: a label shown twice in a card is a duplicate.
  const notes = new Map(), labels = new Map();
  for (const summary of root.querySelectorAll('summary')) {
    if (visible(summary) && /^notes? for the ai\b/i.test(words(summary))) { const card = cardOf(summary); notes.set(card, (notes.get(card) || 0) + 1); }
  }
  for (const [card, count] of notes) if (card && count > 1) add('many-ai-notes', card, `${count} "Note for the AI" folds in one card: one per card`);
  for (const label of root.querySelectorAll('dt, .edit-label, h5')) {
    if (!visible(label) || label.closest('.card-editor') && !label.closest('.is-editing')) continue;
    const card = cardOf(label), key = words(label).toLowerCase().replace(/[:?]$/, '');
    if (!card || !key) continue;
    const seen = labels.get(card) || new Set();
    if (seen.has(key)) add('duplicate-field', label, `"${words(label)}" is shown twice in one card: one row per field`);
    seen.add(key);
    labels.set(card, seen);
  }
  // 3a. Rhythm, chips and words (owner, 18 Oct 2026, #1513 rejected: "I gave you feedback about the chips vs text/labels positioning/placement"): no lone line of
  //     words on its own line next to a block of values: above or below a chip row ("Ranked first" under the places, "Also inside longer words" over them,
  //     "Yes" before them), or below a list, a button or a setting (#1515: "Please confirm or discard each." under the gaps list, a cost under its button; a
  //     footnote after a card's settings). A qualifier joins the label ("Preferred · ranked first") or is a badge in the row; a cost goes in its button.
  //     Found by shape, never by page: a chip row is any element with chips as children; a list is a ul/ol or review list of 2+ rows; a setting is a short
  //     bold label followed by its value. Headings, labels and controls are not captions; an editor's hint under its control is the editor's.
  const CHIPS = '.chip-tag, .chip-button, .ui-tag';
  const NOT_A_CAPTION = 'h1, h2, h3, h4, h5, h6, dt, b, strong, summary, legend, label, .edit-label, button, a, input, select, textarea, details, svg, img';
  const editing = el => Boolean(el.closest('.edit-control, .edit-row, form, .card-editor'));
  const lineOf = node => { if (node.nodeType === 1) return node.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect(); };
  const caption = node => {
    if (!node) return null;
    if (node.nodeType === 3) return node.textContent.trim() ? node : null;
    return node.nodeType === 1 && visible(node) && !node.matches(NOT_A_CAPTION) && !node.querySelector(`${CHIPS}, ${NOT_A_CAPTION}, ul, ol`) && words(node) ? node : null;
  };
  const neighbour = (node, step) => { let next = node[step]; while (next && next.nodeType === 3 && !next.textContent.trim()) next = next[step]; return next; };
  const isLabel = el => el && el.matches('b, strong, dt') && words(el).length <= 40 && !/[.!?]$/.test(words(el)) && !el.closest('h1, h2, h3, h4, h5, h6, summary, .card-head, .card-words, li, button, a');
  // A setting comes in a list: a bold label starts a row, and the row (or its parent) has a sibling of the same class that starts with a label too. A lone
  // bold title over a meta line (a file name, a section title) is not a setting.
  const firstLabel = row => [...row.querySelectorAll('b, strong')].find(label => label === label.parentElement.firstElementChild && isLabel(label));
  const settingOf = label => {
    for (let row = label.parentElement, i = 0; row && row.parentElement && i < 2; row = row.parentElement, i++) {
      if ([...row.parentElement.children].some(other => other !== row && other.className === row.className && firstLabel(other))) return row;
    }
    return null;
  };
  const kindOf = el => {
    if ([...el.children].some(child => child.matches(CHIPS))) return 'a chip row';
    if ((el.matches('ul, ol') && el.children.length > 1) || (el.matches('.review-list') && el.querySelectorAll('.review-item').length > 1)) return 'a list';
    if (el.matches(BUTTONS)) return 'its button';
    if (isLabel(el.firstElementChild) && el.firstElementChild.nextElementSibling && settingOf(el.firstElementChild) || el.matches('dl')) return 'a setting';
    return '';
  };
  const seen = new Set();
  for (const subject of root.querySelectorAll(`*`)) {
    if (subject.nodeType !== 1 || !cardOf(subject) && !subject.closest('dd') || subject.closest(NOT_A_BUTTON_ROW) && !subject.matches(BUTTONS)) continue;
    const what = kindOf(subject);
    if (!what || !visible(subject) || editing(subject)) continue;
    const box = subject.getBoundingClientRect();
    for (const [step, side] of [['previousSibling', 'above'], ['nextSibling', 'below']]) {
      if (side === 'above' && what !== 'a chip row') continue;
      const node = caption(neighbour(subject, step));
      if (!node || seen.has(node)) continue;
      const rect = lineOf(node), text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      const own = side === 'above' ? rect.bottom <= box.top + 2 : rect.top >= box.bottom - 2;
      // A footnote after settings may run long; a paragraph after a list or a button is prose, not a caption.
      if (own && text.length <= (what === 'a setting' ? 200 : 80)) { seen.add(node); add('caption-sandwich', subject, `"${text.slice(0, 60)}" sits alone ${side} ${what}: join it to the label ("Preferred · ranked first"), make it a badge in the row, put it in the button, or drop it`); }
    }
  }
  // 3b. Label column: every setting is label column + value; the labels of one list share a left edge and each value starts on its label's line
  //     (wide window only: the editor stacks to one column when narrow). A setting is a dt/dd pair, an editor row, or a short bold label followed by its value.
  if (document.documentElement.clientWidth >= 1000) {
    const pairs = [];
    for (const list of root.querySelectorAll('dl')) for (const dt of list.querySelectorAll(':scope > dt')) { const dd = dt.nextElementSibling; if (dd && dd.tagName === 'DD') pairs.push([list, dt, dd]); }
    // An editor row narrower than its container rule (card-shell.css, 560px) stacks on purpose: only a two-column one is checked.
    for (const row of root.querySelectorAll('.edit-row')) { if (getComputedStyle(row).gridTemplateColumns.trim().split(/\s+/).length < 2) continue; const label = row.querySelector(':scope > .edit-label'), control = row.querySelector(':scope > .edit-control'); if (label && control) pairs.push([row.parentElement, label, control]); }
    for (const label of root.querySelectorAll('b, strong')) {
      const value = label.nextElementSibling;
      if (label === label.parentElement.firstElementChild && value && isLabel(label) && cardOf(label) && !editing(label) && settingOf(label)) pairs.push([cardOf(label), label, value]);
    }
    const lefts = new Map();
    for (const [list, label, value] of pairs) {
      if (!visible(label) || !visible(value)) continue;
      const a = label.getBoundingClientRect(), b = value.getBoundingClientRect();
      const left = lefts.get(list);
      if (left == null) lefts.set(list, a.left);
      else if (Math.abs(a.left - left) > 2) add('label-grid', label, `"${words(label)}" starts ${Math.round(a.left - left)}px off the other labels: one label column`);
      // Mockup 03 (owner-approved, 18 Oct 2026): a chip list may sit on its own line under its label ("Preferred locations" over its chips), a divider before the next.
      const chipValue = [...value.children].some(child => child.matches(CHIPS)) || value.querySelector(':scope > .chip-list, :scope > .read-values, :scope > .chip-row');
      if (!chipValue && (b.top - a.top > Math.max(8, a.height * 0.75) || b.left < a.right - 1)) add('label-grid', label, `"${words(label)}"'s value starts under it, not beside it: label column + value on the label's line`);
      else if (label.tagName === 'DT' && b.left - a.left > limits.labelColumn) add('label-grid', label, `"${words(label)}"'s value starts ${Math.round(b.left - a.left)}px from it (at most ${limits.labelColumn}px): a narrower label column, values not floating mid-card`);
    }
    // #1519: wide rows of settings are told apart by a divider or a tint, not only by white space.
    const tinted = (el, list) => { const back = getComputedStyle(el).backgroundColor; return (rgb(back)[3] ?? 1) > 0.05 && back !== getComputedStyle(list).backgroundColor; };
    const lined = el => { const style = getComputedStyle(el); return ['Top', 'Bottom'].some(side => parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== 'none'); };
    const groups = new Map();
    for (const [list, label, value] of pairs) if (visible(label) && visible(value)) { const row = label.tagName === 'DT' ? label : label.parentElement; groups.set(list, [...(groups.get(list) || []), [row, value]]); }
    for (const [list, rows] of groups) {
      if (rows.length < 3 || list.getBoundingClientRect().width < limits.dividedWidth || list.matches('.edit-rows, .edit-row') || rows[0][0].closest('.edit-rows')) continue;
      const box = row => (row.parentElement === list ? row : row.parentElement);
      if (!rows.slice(1).some(([row, value]) => [row, value, box(row)].some(el => lined(el) || tinted(el, list)))) add('no-dividers', rows[0][0], `${rows.length} settings in a ${Math.round(list.getBoundingClientRect().width)}px-wide list with no divider or tint between them: add a line or a tinted row`);
    }
  }
  // 3c. A list is chips, not prose: a value of 4 or more short items in one line of words ("Yes · Berlin, London, Paris") shows as chips.
  for (const label of [...root.querySelectorAll('dt, b, strong')].filter(label => isLabel(label) && (label.tagName === 'DT' || settingOf(label)))) {
    const value = label.nextElementSibling;
    if (!value || !visible(value) || editing(value) || value.querySelector(CHIPS) || !cardOf(value) && value.tagName !== 'DD') continue;
    const shown = [...value.childNodes].filter(node => !(node.nodeType === 1 && node.matches('.read-note, .muted.small'))).map(node => node.textContent).join(' ').replace(/\s+/g, ' ').trim();   // the value, not its note
    const items = shown.split(/\s*[,;·]\s*/).filter(Boolean);
    if (items.length >= 4 && items.every(item => item.length <= 30)) add('list-as-prose', value, `"${words(label)}" writes ${items.length} items as words ("${shown.slice(0, 50)}"): show them as chips`);
  }
  // 7b. Modern controls (owner, 18 Oct 2026: "I like more card picker than the selectbox/dropdown"): a menu of a few choices is a card picker, segmented or chips;
  //     a <select> is only for a long list (country, currency).
  for (const select of root.querySelectorAll('select:not([data-long-list])')) {   // a searchable menu (.select-search) is the long-list form the rule allows
    if (!visible(select) || select.closest('.select-search')) continue;
    const options = [...select.options].filter(option => option.value !== '' && !option.disabled).length;
    if (options > 0 && options <= limits.selectOptions) add('small-select', select, `a menu of ${options} choices (${[...select.options].map(option => option.text).slice(0, 4).join(', ')}…): use a card picker, segmented buttons or chips`);
  }
  // 4. Now vs Proposed: told apart by colour, not only by weight or grey (both still readable).
  const colourful = el => { const style = getComputedStyle(el); return [style.color, style.backgroundColor, style.borderLeftColor].some(value => { const [r, g, b, a = 1] = rgb(value); return a > 0.1 && Math.max(r, g, b) - Math.min(r, g, b) > 40; }); };
  for (const now of root.querySelectorAll('div, p, li')) {
    if (!visible(now) || !/^now:/i.test(words(now)) || now.children.length > 4) continue;
    const proposed = [...now.parentElement.children].find(other => other !== now && /^proposed:/i.test(words(other)));
    if (proposed && !colourful(now) && !colourful(proposed)) add('flat-compare', proposed, 'Now and Proposed differ only by grey vs bold: give the proposal its colour (a tinted row or an accent edge)');
  }
  // 9. A sticky or fixed bar never covers content (#1515): scrolled to the end, nothing is left under the bar; the page's bottom padding is at least the
  //    bar's height plus its offset (the save bar sits above the Profile fold bar).
  const CONTENT = 'button, input, select, textarea, a, p, li, dd, dt, h2, h3, h4, label, td';
  for (const bar of root.querySelectorAll('*')) {
    const style = getComputedStyle(bar);
    if (!['sticky', 'fixed'].includes(style.position) || style.bottom === 'auto' || !visible(bar)) continue;
    let scroller = bar.parentElement;
    while (scroller && !(/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
    scroller = scroller || document.scrollingElement;
    const saved = scroller.scrollTop;
    scroller.scrollTop = scroller.scrollHeight;
    const edge = bar.getBoundingClientRect();
    const pinned = el => { for (let node = el; node && node !== scroller; node = node.parentElement) if (['sticky', 'fixed'].includes(getComputedStyle(node).position)) return true; return false; };   // another bar's own parts
    const covered = [...scroller.querySelectorAll(CONTENT)].find(el => {
      if (bar.contains(el) || el.contains(bar) || !visible(el) || pinned(el)) return false;
      const box = el.getBoundingClientRect();
      return box.bottom > edge.top + 2 && box.top < edge.bottom - 2 && box.right > edge.left && box.left < edge.right;
    });
    scroller.scrollTop = saved;
    if (covered) add('sticky-bar-covers', bar, `scrolled to the end, "${words(covered).slice(0, 40)}" is still under the ${words(bar).slice(0, 30) || 'sticky'} bar: give the page bottom padding ≥ the bar's height and offset`);
  }
  return found;
}

// Screens that broke a rule before it was written (18 Oct 2026), with the session fixing each: `${view}|${kind}|${card}` -> who; view = the page's data-view,
// card '*' = any card of that page (a session card is named after its job). Shrink-only: a fixed screen comes off (the test counts them), a new one is never added.
// Measured on the demo pages (npm run shot --eval, loaded, folds open) on 18 Oct 2026.
const CLEANUP = 'design-cleanup (to start; job-pilotto-75 proposes it)';
const STRATEGY = 'the mockup rebuild session (Strategy from mockup 03)', CV_CHECK = 'the mockup rebuild session (CV check from mockup 08)';
export const KNOWN_LEFT = {
  // The design-system page's "Value → control" section draws answerControl (question-control*.js): its period, net/gross, unit and few-option menus are selects.
  'value-control|small-select|page': 'the editors session (Availability, Work eligibility, answer kinds) proposed by job-pilotto-75',
  // Up next: each item's own orange button (Open LinkedIn, Open email, Build new prep kit…).
  'focus|many-primaries|Up next': CLEANUP,
  // Jobs' list filter (7 views) and sort (3) menus; Interviews' outcome filter (4).
  'jobs|small-select|page': CLEANUP,
  'interviews|small-select|page': CLEANUP,
  // A session card's proposed answer for a form dropdown (need-proposal.js: the form's own few choices). Row primaries and the
  // Keep it / Apply anyway menu went on 27 Oct 2026 (outlined buttons; Keep it + Change…).
  'sessions|small-select|*': CLEANUP,
  // Main's Strategy as the owner rejected it (#1513): group captions over chips ("Also inside longer words"), single values under their labels, labels off
  // one edge, no dividers between settings, a line under a button. Found on the loaded demo with Advanced search settings open.
  'strategy|caption-sandwich|*': STRATEGY,
  'strategy|label-grid|*': STRATEGY,
  'strategy|no-dividers|*': STRATEGY,
  // Main's CV check (#1515's old version): score rows with their explanation under the label, cost lines under buttons.
  'profile|caption-sandwich|CV check': CV_CHECK,
  'profile|label-grid|CV check': CV_CHECK,
  // Settings → Application profile: "Missing: first name, last name, email, phone" as words.
  'settings|list-as-prose|Application profile': CLEANUP,
};

// The journey's verdict: a known screen is a warning that names who fixes it; anything new is severe.
export function judge(findings, known = KNOWN_LEFT) {
  return findings.map(item => {
    const who = known[`${item.view}|${item.kind}|${item.card}`] || known[`${item.view}|${item.kind}|*`];
    return who ? {...item, severity: 'warning', detail: `${item.detail} (known, being fixed: ${who})`} : item;
  });
}
