// The component gallery's "Card shell" section: one card read, the same card in its editor, and the page save bar with drafts on two tabs, all drawn by
// the shared parts (card-shell.js, components.js cardEdit, save-bar.js), so the gallery is the living copy of docs/rules/desktop-ui.md "Cards: read → Edit → editor".
import {cardEdit, el, pill, tile} from './components.js';
import {cardHead, chipLine, editRows, factColumns, readRows, setEditing} from './card-shell.js';
import {pageSaveBar} from './save-bar.js';
import {emptyState, referenceRow, reviewList, summaryTiles} from './page-parts.js';
import {icon} from './icons.js';
import {refresh, segmented} from './question-control-values.js';

function card(title, editing) {
  const panel = el('div', 'setting panel');
  const top = el('div', 'panel-top');
  const head = el('div', 'summary-head');
  head.append(icon('globe'), el('h3', '', title));
  top.append(head, cardEdit('Edit', title.toLowerCase(), () => setEditing(panel, true)));
  const read = el('div', 'card-read');
  read.append(chipLine([{text: 'English', detail: 'B2'}, {text: 'Romanian', detail: 'Native'}, {text: 'Russian', detail: 'B1'}]),
    readRows([{label: 'Can work in', value: 'English, Romanian, Russian', note: 'No French, German or Italian.'}, {label: 'Certificates', value: ''}]));
  // A level is one of a few: segmented buttons, never a menu (owner, 18 Oct 2026: "I like more card picker than the selectbox"; design-rules.mjs small-select).
  const level = value => { let chosen = value; const isOn = option => option === chosen; return segmented(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Native'], isOn, (option, group) => { chosen = option; refresh(group, isOn); }, 'Level'); };
  const editor = el('div', 'card-editor');
  editor.append(editRows([{label: 'English', control: level('B2')}, {label: 'Romanian', control: level('Native')}, {label: 'Russian', control: level('B1')}]));
  panel.append(top, el('p', 'muted panel-lead', 'The languages you speak, with your level.'), read, editor);
  setEditing(panel, editing);
  return panel;
}

export function cardSystem() {
  const box = el('div', 'settings-page');
  const tabs = el('div', 'tabs');
  const buttons = Object.fromEntries([['details', 'Your details'], ['experience', 'Experience'], ['answers', 'Application answers']].map(([key, label]) => {
    const button = el('button', '', label);
    tabs.append(button);
    return [key, button];
  }));
  box.append(tabs, card('Languages', false), card('Languages', true));
  const bar = pageSaveBar({host: box, tabs: {details: 'Your details', experience: 'Experience', answers: 'Application answers'}, tabButton: key => buttons[key],
    words: 'Your drafts are kept while you switch tabs.'});
  for (const [id, tab] of [['languages', 'details'], ['summary', 'experience']]) bar.register({id, tab, label: id, count: () => 1, save: async () => ({ok: true}), discard: () => {}});
  return box;
}

// The page blocks (page-parts.js) with fictional demo values: review list, empty state, summary tiles, reference row.
export function pageBlocks() {
  const box = el('div', 'settings-page');
  const panel = (title, ...parts) => { const node = el('div', 'setting panel'); node.append(el('h3', '', title), ...parts); return node; };
  box.append(
    panel('reviewList', reviewList([
      {key: 'budget', title: 'Budget ownership', why: 'Asked in 4 of your 5 best matches', source: 'From the CV check', status: {text: 'Needs review', tone: 'warn'},
        actions: [{label: 'Confirm', primary: true}, {label: 'Dismiss'}]},
      {key: 'spanish', title: 'Spanish', why: 'Asked in 2 of your 5 best matches', status: {text: 'Needs review', tone: 'warn'}, actions: [{label: 'Review', primary: true}]},
      {key: 'lead', title: 'Team leadership', why: 'Added to Experience', status: {text: 'Confirmed', tone: 'good'}, done: true},
    ])),
    panel('reviewList joined, status by the name (mockup 06)', reviewList([
      ...['Budgeting', 'Spanish'].map(skill => ({key: skill, title: skill, status: {text: 'To check', tone: 'warn'},
        actions: [{label: 'Confirm skill', aria: `${skill}: confirm skill`}, {label: 'Dismiss', link: true, aria: `${skill}: dismiss`}]})),
      {key: 'excel', title: 'Excel', status: {text: 'Confirmed skill', tone: 'good'}, done: true, actions: [{label: 'Undo', link: true}]},
    ], {statusAt: 'title', joined: true, doneSummary: done => done.map(item => `${item.title} confirmed`).join(' · ')})),
    panel('reviewList status first, row opens its detail (mockup 08)', reviewList([
      {key: 'p1', title: 'Show the budget you owned', why: 'Your last role says "budget" without a figure', status: {text: 'High', tone: 'bad'},
        detail: el('p', 'muted', 'Add the yearly budget and what it covered, in your most recent role.')},
      {key: 'p2', title: 'Name the team size', why: 'Leadership is claimed, not shown', status: {text: 'Medium', tone: 'warn'},
        detail: el('p', 'muted', 'Say how many people you led and for how long.')},
    ], {statusAt: 'first'})),
    panel('emptyState', emptyState({icon: 'file', title: 'No base letter yet', text: 'One general letter, written from your CV and Profile; each job still gets its own.',
      actions: [{label: 'Draft with AI'}, {label: 'Write my own'}], note: 'Drafting uses your AI once.'})),
    panel('summaryTiles', summaryTiles([{key: 'role', icon: 'target', tone: 'signal', label: 'Role', value: 'Operations Manager'},
      {key: 'where', icon: 'pin', tone: 'info', label: 'Where', value: 'Zurich · Remote'}, {key: 'salary', icon: 'coins', tone: 'good', label: 'Minimum salary', value: 'CHF 140k'},
      {key: 'start', icon: 'calendar', tone: 'neutral', label: 'Start', value: ''}])),
    panel('summaryTiles score', summaryTiles([{key: 'fit', tone: 'good', label: 'Fit for your roles', score: 82}, {key: 'read', tone: 'ok', label: 'Easy to read', score: 64},
      {key: 'gaps', tone: 'low', label: 'Skills shown', score: 38}, {key: 'none', label: 'Not scored yet', score: null}])),
    panel('referenceRow', referenceRow({text: 'Swiss permit B · notice period 3 months'})),
  );
  return box;
}

// Roomy cards (owner, 18 Oct 2026, mockup 03 approved): what every Strategy and Profile card reads like. A container with .roomy-cards, cardHead (icon tile,
// title, lead, quiet Edit), summaryTiles divided, readRows with icons (every label on its own line over its value: one value or a list's chips).
export function roomyCards() {
  const box = el('div', 'roomy-cards');
  const card = (head, ...parts) => { const node = el('section', 'card'), read = el('div', 'card-read'); read.append(...parts); node.append(head, read); return node; };
  const edit = what => cardEdit('Edit', what, () => {});
  const pair = el('div', 'roomy-pair card-grid');
  pair.append(
    card(cardHead({glyph: 'pin', tone: 'teal', title: 'Locations', lead: 'Where you want to work.', action: edit('locations')}),
      readRows([{icon: 'pin', label: 'Preferred locations', value: chipLine(['Lyon', 'Porto'])}, {icon: 'globe', label: 'Acceptable locations', value: chipLine(['France', 'Portugal'])},
        {icon: 'send', label: 'Relocation', value: 'Not specified'}, {icon: 'shield', label: 'Work rights', value: pill('Not set', 'warn', {title: 'Jobs abroad are flagged'})}], {lined: true})),
    card(cardHead({glyph: 'sliders', tone: 'violet', title: 'Job preferences', lead: 'What a job must have.', action: edit('job preferences')}),
      readRows([{icon: 'briefcase', label: 'Employment type', value: 'Full-time'}, {icon: 'clock', label: 'Workload', value: '80 – 100%'},
        {icon: 'target', label: 'Role priorities', value: chipLine(['Store Manager', 'Area Manager'])}], {lined: true})));
  for (const node of pair.children) node.classList.add('is-wide');   // Locations and Job preferences grow with the user's data: one column
  box.append(
    card(cardHead({glyph: 'target', tone: 'signal', title: 'Main goals', lead: 'What every job is scored against.', action: edit('main goals')}),
      summaryTiles([{key: 'roles', icon: 'briefcase', tone: 'violet', label: 'Target roles', value: 'Store Manager · Area Manager', more: '+1 more'},
        {key: 'mode', icon: 'building', tone: 'good', label: 'Work mode', value: 'On-site'},
        {key: 'salary', icon: 'coins', tone: 'warn', label: 'Minimum salary', value: 'EUR 48,000 a year', badge: {text: 'As written', tone: 'neutral', title: 'Edit to pick its currency'}}], {divided: true})),
    pair);
  // A Profile card (mockup 05): .setting.panel.roomy, the same header (teal tile), facts as columns: icon · label over value, the note on hover.
  const profile = el('div', 'setting panel roomy'), top = el('div', 'panel-top'), head = el('div', 'summary-head card-head'), words = el('div', 'card-words');
  words.append(el('h3', '', 'Availability & compensation'), el('p', 'muted small', 'Notice period and the salary you tell employers.'));
  head.append(tile('coins', 'teal'), words);
  top.append(head, edit('availability'));
  profile.append(top, factColumns([{icon: 'calendar', label: 'Notice period', value: '2 months', note: 'For a start-date field, give a concrete date.'},
    {icon: 'coins', label: 'Salary expectation', value: 'EUR 52,000 a year'}, {label: 'Nationality', value: 'Portuguese'}]));
  box.append(profile);
  return box;
}
