// The gallery's "Value → control" table and chips (design system, owner 17 Oct 2026): each kind of value, its read view and its edit view, drawn by
// the screens' own code (question-control.js answerControl, components.js chip). The rule it shows: docs/rules/desktop-ui.md "Value → control".
import {chip, el, pill} from './components.js';
import {icon} from './icons.js';
import {answerControl} from './question-control.js';
import {COMPOSITE, formatFor} from './question-kind.js';
import {joinDuration, joinSalary} from './question-values.js';

const control = (kind, value, options = []) => {
  const node = answerControl(formatFor({marked: {kind, options}}), value, () => {}, {ariaLabel: kind});
  if (!COMPOSITE.includes(kind)) return node;
  const line = el('label', 'fact-line');   // the Your details row: a composite's parts on one line
  line.append(node);
  return line;
};
const list = (...chips) => { const box = el('div', 'chip-list'); box.append(...chips); return box; };
const text = words => document.createTextNode(words);
// A note for the AI: a muted line under its value, never inside it (owner's choice, 17 Oct 2026).
export const aiNote = words => { const line = el('p', 'muted small g-note'); line.append(icon('bot'), el('span', '', words)); return line; };

const SALARY = joinSalary({number: '140000', currency: 'CHF', period: 'year', basis: 'gross'});
// [kind, name, example, read view, edit view, how it edits]
export const KIND_ROWS = [
  ['text', 'Short text', 'a name, a job title, a city', () => text('Senior Project Manager'), () => control('text', 'Senior Project Manager'), 'a text field sized to the value'],
  ['long_text', 'Long text', 'motivation, cover letter', () => el('p', 'g-clamp', 'I lead teams through busy launches and like keeping them calm: clear plans, honest updates and checklists a new teammate can follow.'),
    () => control('long_text', 'I lead teams through busy launches.'), 'a box that grows; read: 3 lines + More'],
  ['yes_no', 'Yes / No', 'need a visa? disability?', () => text('No'), () => control('yes_no', 'No'), 'two buttons'],
  ['single', 'One of a few (≤ 3 short)', 'On-site / Hybrid / Remote', () => chip('Hybrid'), () => control('single', 'Hybrid', ['On-site', 'Hybrid', 'Remote']), 'segmented buttons'],
  ['single', 'One of many', 'a country, an age bracket', () => text('Switzerland'), () => control('single', 'Switzerland', ['Austria', 'France', 'Germany', 'Switzerland', 'United Kingdom']), 'a menu'],
  ['multi', 'Several from a list', 'skills, regions to skip', () => list(chip('Budgeting'), chip('Negotiation'), chip('Excel')),
    () => list(chip('Budgeting', {onRemove: () => {}}), chip('Negotiation', {onRemove: () => {}}), Object.assign(el('input', 'add'), {placeholder: 'Add a skill, then Enter'})), 'chips with ×, then Add'],
  ['date', 'Date', 'earliest start', () => text('1 Dec 2026'), () => control('date', '2026-12-01'), 'a date picker'],
  ['amount', 'Amount', 'a budget, a fee', () => text('CHF 2,500'), () => control('amount', 'CHF 2500'), 'number + currency'],
  ['salary', 'Salary', 'expectation per country', () => text('CHF 140,000 / year, gross'), () => control('salary', SALARY), 'number + currency + period + gross/net'],
  ['duration', 'Duration', 'notice period', () => text('1 month, ends at month-end'), () => control('duration', joinDuration({number: '1', unit: 'month', monthEnd: true})), 'number + unit'],
  ['link', 'Link', 'LinkedIn, GitHub', () => Object.assign(el('a', '', 'linkedin.com/in/alex-rivera'), {href: '#'}), () => control('link', 'https://linkedin.com/in/alex-rivera'), 'a web address field'],
  ['per_country', 'Per country', 'right to work', () => list(chip('EU / EEA + Switzerland', {detail: 'Yes, freely · from your nationality'}), chip('United States', {detail: 'No, needs sponsorship'})),
    () => control('per_country', 'yes, with a permit, valid until 2027-06-30'), 'Yes, freely / Yes, with a permit (until, only in) / No, needs sponsorship'],
  ['language', 'Language + level', 'English C1', () => list(chip('English', {detail: 'C1'}), chip('Spanish', {detail: 'Native'})), () => control('language', 'C1'), 'level buttons A1…native'],
  ['range', 'Range', 'workload 80–100 %', () => text('80–100 %'), () => control('range', '80–100 %'), 'from + to'],
  ['note', 'Note for the AI', 'use the closest option', () => aiNote('Use the closest option when the form words it differently.'),
    () => { const fold = el('details', ''); fold.append(el('summary', '', 'Note for the AI'), Object.assign(el('textarea', ''), {rows: 2, value: 'Use the closest option.'})); return fold; }, 'folded, under its value'],
];

export function kindsTable() {
  const table = el('table', 'data-table g-kinds');
  const head = el('tr', '');
  head.append(...['Kind of value', 'Read', 'Edit'].map(words => el('th', '', words)));
  const body = el('tbody', '');
  for (const [, name, example, read, edit, how] of KIND_ROWS) {
    const row = el('tr', ''), kind = el('td', ''), shown = el('td', ''), editing = el('td', '');
    kind.append(el('b', '', name), el('div', 'muted small', example));
    shown.append(read());
    editing.append(edit(), el('div', 'muted small', how));
    row.append(kind, shown, editing);
    body.append(row);
  }
  const thead = el('thead', '');
  thead.append(head);
  table.append(thead, body);
  return table;
}

export const chipRow = () => list(chip('Remote'), chip('English', {detail: 'C1'}), chip('United States', {detail: 'Needs visa', tone: 'bad'}), chip('Budgeting', {onRemove: () => {}}), pill('Not set', 'warn'));
