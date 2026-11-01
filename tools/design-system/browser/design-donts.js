// The design-system page's "Don't / Do" pairs, one per rule from the owner's UI feedback (18 Oct 2026, docs/rules/desktop-ui.md "Read views, lists, buttons and choices"),
// redrawn with fictional data from the shared parts (never the owner's screenshots: they hold his real data). Each "Don't" box carries data-expect = the check in
// desktop/e2e/lib/design-rules.mjs it must trip, and each "Do" box must trip none (desktop/e2e/test/pool/design-rules.test.mjs; the checks are parked by the owner, 18 Oct 2026).
import {chip, el, pill} from '../r/components.js';
import {chipLine, editRows, readRows} from '../r/card-shell.js';
import {refresh, segmented} from '../r/question-control-values.js';
import {reviewList} from '../r/page-parts.js';

const root = document.getElementById('gallery');
const box = (title, expect, ...children) => {
  const card = el('div', 'g-state setting panel');
  if (expect) card.dataset.expect = expect;
  card.append(el('h4', '', title), ...children);
  return card;
};
const pair = (title, note, ...boxes) => {   // a Don't, its Do, and more Don'ts when one rule has several shapes
  const section = el('section', 'g-section');
  const grid = el('div', 'state-grid');
  grid.append(...boxes);
  section.append(el('h2', '', title), el('p', 'muted small', note), grid);
  root.append(section);
};
const button = (label, cls) => Object.assign(el('button', cls, label), {type: 'button'});
const fold = (summary, text) => { const node = el('details', ''); node.append(el('summary', 'muted small', summary), el('p', 'muted small', text)); return node; };
const PLACES = ['Lisbon', 'Porto', 'Madrid', 'Valencia', 'Lyon', 'Paris', 'Ghent', 'Antwerp', 'Utrecht', 'Leiden', 'Aarhus', 'Malmö', 'Tampere', 'Tartu', 'Kraków', 'Brno'];

pair("Don't: notes inside values", 'Read views show the value. A note (a source, a date it was confirmed, a rule for the AI) is a muted line under it, or folded.',
  box("Don't: raw notes in a value", 'raw-note-in-value', readRows([{label: 'Languages', value: 'Spanish: C1 [language] · Dutch: B2 [language] (note: working language, confirmed 3 Mar 2026)'}])),
  box('Do: values, the note under them', '', chipLine([{text: 'Spanish', detail: 'C1'}, {text: 'Dutch', detail: 'B2'}]), readRows([{label: 'Work mode', value: 'Hybrid or remote', note: 'Confirmed 3 Mar 2026'}])));

pair("Don't: long lists as a paragraph", 'A list of more than a dozen items shows the first few as chips and "+N more".',
  box("Don't: every place written out", 'long-list-unfolded', readRows([{label: 'Relocation', value: `Yes · ${PLACES.join(', ')}`}])),
  box('Do: chips, then +N more', '', (() => { const line = chipLine(PLACES.slice(0, 5)); line.append(button(`+${PLACES.length - 5} more`, 'link small')); return line; })()));

// #1515's shapes (5c): a joined review list (one .review-box child) with its note after it, and a cost line beside its own button in one parent.
const listAndCost = () => {
  const gaps = reviewList([{title: 'Prometheus', why: 'Asked in 3 saved jobs'}, {title: 'Vault', why: 'Asked in 2 saved jobs'}], {joined: true});
  const gapNotes = el('div', 'gap-notes'); gapNotes.append(el('p', 'muted small', 'Notes in your Profile'), el('p', 'muted small', 'Please confirm or discard each.'));
  const cvAction = el('div', 'cvc-action'); cvAction.append(button('Check my CV', 'secondary'), el('span', 'muted small', '~$0.02'));
  return box("Don't: a note after a list, a cost by its button", 'caption-sandwich', gaps, gapNotes, cvAction);
};
pair("Don't: lone words over or under chips", 'Rhythm: a setting is label column + value on one line. A qualifier joins the label ("Preferred · ranked first") or is a badge in the row, never a lone line above or below the chips.',
  (() => {
    const yes = el('dd'); yes.append('Yes', chipLine(PLACES.slice(0, 3)));
    const list = readRows([{label: 'Preferred', value: chipLine(PLACES.slice(3, 5)), note: 'Ranked first'}]);
    list.append(el('dt', '', 'Relocation'), yes);
    const stacked = readRows([{label: 'Work mode', value: 'Hybrid or remote'}]);
    stacked.style.display = 'block';   // a single value on its own line under its label (a chip list may sit under its label: mockup 03)
    const notes = el('ul', ''); notes.append(el('li', '', 'Seniority: Senior'), el('li', '', 'Team size: 5–10'));
    const actions = el('div', 'g-row'); actions.append(button('Draft the letter', 'secondary'));
    return box("Don't: captions and stacked labels", 'caption-sandwich label-grid', list, stacked, notes, el('p', 'muted small', 'Please confirm or discard each.'), actions, el('p', 'muted small', 'About $0.02'));
  })(),
  (() => {
    const actions = el('div', 'g-row'); actions.append(button('Draft the letter · ~$0.02', 'secondary'));
    return box('Do: label · qualifier | chips', '', readRows([{label: 'Preferred · ranked first', value: chipLine(PLACES.slice(3, 5))}, {label: 'Relocation', value: chipLine(PLACES.slice(0, 3))},
      {label: 'Work mode', value: chipLine(['Hybrid', 'Remote'])}]), actions);
  })(),
  listAndCost());

// The owner's rejected screen (main's Strategy on 18 Oct 2026: Locations, Job board searches, More search settings), drawn in its own markup with fictional
// values so the checks are proved on the shape he saw: labels stacked over values, group captions over chips, places as prose, a footnote after the settings.
const strategyShape = (...cards) => { const page = el('div', 'strategy-page'), review = el('div', 'review'); review.append(...cards); page.append(review); return page; };
const shapeCard = (title, ...parts) => { const card = el('div', 'shape-card'), head = el('div', 'card-head'), titleWords = el('div', 'card-words'); titleWords.append(el('h3', '', title)); head.append(titleWords); card.append(head, ...parts); return card; };
const settingShape = (label, ...value) => { const row = el('div', 'setting-row'), body = el('div', 'setting-body'); body.append(el('b', '', label), ...value); row.append(el('span', 'muted', '•'), body); return row; };
const chipsShape = labels => { const list = el('div', 'chip-list'); list.append(...labels.map(label => chip(label))); return list; };
pair("Don't: Strategy cards as the owner rejected them", 'Main\'s Locations, Job board searches and More search settings (fictional values): every setting reads as label column + value, qualifiers join the label, places are chips, no footnote.',
  box("Don't: labels over values, captions, prose", 'caption-sandwich label-grid list-as-prose', strategyShape(
    shapeCard('Locations', (() => { const priority = el('div', 'priority'), groups = el('div', 'setting-body');
      groups.append(el('span', 'muted small', 'Also inside longer words'), chipsShape(PLACES.slice(0, 3)), el('span', 'muted small', 'Whole word only'), chipsShape(PLACES.slice(3, 5)));
      priority.append(el('b', '', 'Preferred locations'), groups); return priority; })(),
      settingShape('Relocation', el('span', '', `Yes · ${PLACES.slice(5, 9).join(', ')}`)), settingShape('Remote work', el('span', '', 'Jobs that allow working from Portugal')),
      el('p', 'muted small card-foot', 'Work mode (in Main goals) is the kind of job you accept; Remote work is whether remote jobs count.')),
    shapeCard('Job board searches', el('p', 'sub', 'What we type into job boards.'), chipsShape(['Store manager', 'Area manager', 'Retail lead'])),
    shapeCard('More search settings', settingShape('Job titles to skip', chipsShape(['Intern', 'Trainee'])), settingShape('Companies to skip', chipsShape(['Acme Retail']))))),
  box('Do: label · qualifier | chips', '', readRows([{label: 'Preferred · whole word', value: chipLine(PLACES.slice(3, 5))}, {label: 'Preferred · inside words', value: chipLine(PLACES.slice(0, 3))},
    {label: 'Relocation', value: chipLine(PLACES.slice(5, 9))}, {label: 'Remote work', value: 'From Portugal'}, {label: 'Board searches', value: chipLine(['Store manager', 'Area manager', 'Retail lead'])},
    {label: 'Titles to skip', value: chipLine(['Intern', 'Trainee'])}], {lined: true})));

// A sticky bar lifted by an offset (the save bar over the Profile fold bar) needs that much room after it in the flow: a scroll box's own bottom padding
// does not count for a sticky bar (it shrinks the area the bar sticks in), so the Do puts the room after the bar (a fixed bar takes bottom padding instead).
const scrollBox = room => {
  const page = el('div', '');
  Object.assign(page.style, {height: '150px', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-md)'});
  for (const place of PLACES.slice(0, 6)) page.append(el('p', '', `${place}: hybrid, 3 days`));
  const bar = el('div', 'g-row');
  Object.assign(bar.style, {position: 'sticky', bottom: '56px', background: 'var(--surface)', padding: 'var(--sp-2)', borderTop: '1px solid var(--line)'});
  bar.append(button('Save', 'primary'));
  page.append(bar);
  if (room) { const below = el('div', ''); below.style.height = room; page.append(below); }   // where the fold bar sits in the app
  return page;
};
pair("Don't: a bar over the last rows", 'Scrolled to the end, nothing stays under a sticky bar: the page leaves room of at least the bar\'s offset after it (a fixed bar: bottom padding of its height).',
  box("Don't: no room under the bar", 'sticky-bar-covers', scrollBox('')),
  box('Do: room under the bar', '', scrollBox('56px')));

pair("Don't: fat buttons, many primaries", 'Buttons keep a normal height and one line of words; a card has one filled orange button, the rest are secondary.',
  (() => {
    const row = el('div', 'g-row');
    const fat = button('Accept this proposal', 'primary');
    fat.style.width = '90px';
    fat.style.whiteSpace = 'normal';   // the look before button words were kept on one line (style.css)
    row.append(fat, button('Accept', 'primary'), button('Keep mine', 'secondary'));
    return box("Don't: wrapped, many orange", 'fat-button many-primaries', row);
  })(),
  (() => { const row = el('div', 'g-row'); row.append(button('Accept all', 'primary'), button('Accept', 'secondary small'), button('Keep mine', 'ghost')); return box('Do: one primary, one line', '', row); })());

pair("Don't: Now vs Proposed in grey and bold", 'A choice shows only what changes, and the proposal has its own colour, not just bold against grey.',
  (() => {
    const wrap = el('div', '');
    const now = el('div', 'muted'); now.append(el('b', '', 'Now: '), 'Permanent and contract accepted, both fine, as I said in March when we talked about it.');
    const next = el('div', ''); next.append(el('b', '', 'Proposed: '), 'Permanent or contract');
    wrap.append(now, next);
    return box("Don't: two paragraphs, no colour", 'flat-compare', wrap);
  })(),
  (() => {
    const wrap = el('div', '');
    const now = el('div', 'muted'); now.append(el('b', '', 'Now: '), 'Permanent and contract');
    const next = el('div', 'alert tone-info'); next.append(el('b', '', 'Proposed: '), chip('Permanent'), chip('Contract'));
    wrap.append(now, next);
    return box('Do: the difference, in colour', '', wrap);
  })());

pair("Don't: a note fold per row, a field twice", 'One "Note for the AI" fold per card; one row per field.',
  box("Don't: three folds, a label twice", 'many-ai-notes duplicate-field', readRows([{label: 'Race / ethnicity', value: 'Prefer not to say'}, {label: 'Gender', value: 'Prefer not to say'}, {label: 'Race / ethnicity', value: 'Prefer not to say'}]),
    fold('Note for the AI', 'Use the closest option.'), fold('Note for the AI', 'Skip optional surveys.'), fold('Notes for the AI', 'Never guess.')),
  box('Do: one row each, one fold', '', readRows([{label: 'Race / ethnicity', value: 'Prefer not to say'}, {label: 'Gender', value: pill('Not set', 'warn')}]), fold('Note for the AI', 'Use the closest option; skip optional surveys.')));

pair("Don't: a menu for a few choices", 'A few choices are a card picker, segmented buttons or chips; a menu (select) only for a long list such as countries or currencies.',
  (() => { const menu = el('select'); for (const option of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Native']) menu.append(new Option(option, option)); menu.value = 'B2';
    return box("Don't: a level in a dropdown", 'small-select', editRows([{label: 'Spanish', control: menu}])); })(),
  (() => { let chosen = 'B2'; const isOn = option => option === chosen;
    const control = segmented(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Native'], isOn, (option, group) => { chosen = option; refresh(group, isOn); }, 'Spanish level');
    return box('Do: the level as segmented buttons', '', editRows([{label: 'Spanish', control}])); })());
