// The answer controls of the base-fact kinds that hold more than one part (owner, 17 Oct 2026: "Base facts fixed, AI the rest"): a salary (amount, currency,
// period, net or gross), a notice period, work status per country, a language level, a percentage range and a link. Each is a composite (a div whose .value
// is the saved text, renderer/question-values.js) built from native inputs and the shared .segmented; text the kind cannot read stays visible as it was
// written and still counts as an answer, so nothing is lost. Layout in question-review.css (.qa-values). Guarded by test/question-kinds-composite.test.js.
import {el} from './components.js';
import {composite, refresh, savedAs, segmented} from './question-control-values.js';
import {BASES, CURRENCIES_ALL, LEVELS, PERIODS, UNITS, joinDuration, joinPermit, joinRange, joinSalary, splitDuration, splitPermit, splitRange, splitSalary} from './question-values.js';
import {COUNTRY_NAMES, STATUSES, STATUS_HINTS, STATUS_NAMES} from './work-eligibility.js';

const input = (type, value, ariaLabel, placeholder = '') => Object.assign(el('input', ''), {type, value, ariaLabel, placeholder});
function menu(options, value, ariaLabel, blank = '') {
  const node = Object.assign(el('select', ''), {ariaLabel});
  if (blank) node.append(new Option(blank, ''));
  for (const each of options) node.append(new Option(each, each));
  node.value = value;
  return node;
}

// An unreadable saved text is the answer until a part is chosen.
const readable = (raw, parts) => raw && !parts;

function salary(format, raw, onChange, label) {
  const start = splitSalary(raw), empty = !start.number;   // nothing readable (empty or free words): a new amount starts per year, gross
  const state = {number: start.number, currency: start.currency || format?.options?.[0] || 'CHF', period: empty ? 'year' : start.period, basis: empty ? 'gross' : start.basis};
  const currencies = [...new Set([...(format?.options?.length ? format.options : CURRENCIES_ALL), state.currency])];
  const answer = () => (state.number ? joinSalary(state) : readable(raw, start.number) ? raw : '');
  const node = composite(answer, () => Boolean(answer()));
  const number = input('number', state.number, label, 'Amount');
  const parts = [menu(currencies, state.currency, `${label}: currency`), menu(PERIODS, state.period, `${label}: period`, 'per…'), menu(BASES, state.basis, `${label}: net or gross`, 'net/gross')];
  number.addEventListener('input', () => { state.number = number.value; onChange(answer()); });
  const keys = ['currency', 'period', 'basis'];
  parts.forEach((part, at) => part.addEventListener('change', () => { state[keys[at]] = part.value; onChange(answer()); }));
  node.append(number, ...parts);
  if (readable(raw, start.number)) node.append(savedAs(raw));
  return node;
}

function duration(raw, onChange, label) {
  const start = splitDuration(raw), state = {number: start.number, unit: start.unit || 'month', monthEnd: start.monthEnd};
  const answer = () => (state.number ? joinDuration(state) : readable(raw, start.number) ? raw : '');
  const node = composite(answer, () => Boolean(answer()));
  const number = input('number', state.number, label, 'How many');
  const unit = menu(UNITS, state.unit, `${label}: unit`);
  const end = Object.assign(el('input', ''), {type: 'checkbox', checked: state.monthEnd, ariaLabel: `${label}: ends at month-end`});
  number.addEventListener('input', () => { state.number = number.value; onChange(answer()); });
  unit.addEventListener('change', () => { state.unit = unit.value; onChange(answer()); });
  end.addEventListener('change', () => { state.monthEnd = end.checked; onChange(answer()); });
  node.append(number, unit, el('label', 'muted small', 'ends at month-end'), end);
  if (readable(raw, start.number)) node.append(savedAs(raw));
  return node;
}

// A zone's or a country's status (renderer/work-eligibility.js): three chips; with a permit, its "valid until" and the one country it may be limited to
// (a Swiss B permit held by a non-EU national: "Only in Switzerland").
function permit(raw, onChange, label) {
  const start = splitPermit(raw), state = {...start};
  const answer = () => (state.status ? joinPermit(state) : readable(raw, start.status) ? raw : '');
  const node = composite(answer, () => Boolean(answer()));
  node.classList.add('qa-permit');
  const isOn = option => STATUS_NAMES[state.status] === option;
  const until = Object.assign(input('date', state.until, `${label}: valid until`), {title: 'Valid until'});
  const only = menu(COUNTRY_NAMES, state.only, `${label}: only in`, 'Anywhere here');
  const parts = el('div', 'qa-permit-parts');
  for (const [words, field] of [['Valid until', until], ['Only in', only]]) { const part = el('div', 'qa-permit-part'); part.append(el('span', 'muted small', words), field); parts.append(part); }
  const shown = () => { parts.hidden = state.status !== 'yes, with a permit'; };
  const group = segmented(STATUSES.map(each => STATUS_NAMES[each]), isOn, (option, each) => {
    state.status = isOn(option) ? '' : STATUSES.find(key => STATUS_NAMES[key] === option); refresh(each, isOn); shown(); onChange(answer());
  }, label);
  group.querySelectorAll('button').forEach(button => { button.title = STATUS_HINTS[STATUSES.find(key => STATUS_NAMES[key] === button.textContent)] || ''; });
  until.addEventListener('input', () => { state.until = until.value; onChange(answer()); });
  only.addEventListener('change', () => { state.only = only.value; onChange(answer()); });
  shown();
  node.append(group, parts);
  if (readable(raw, start.status)) node.append(savedAs(raw));
  return node;
}

function range(raw, onChange, label) {
  const start = splitRange(raw), state = {...start};
  const answer = () => (state.from && state.to ? joinRange(state) : readable(raw, start.from) ? raw : '');
  const node = composite(answer, () => Boolean(answer()));
  const from = input('number', state.from, `${label}: from`, 'From'), to = input('number', state.to, `${label}: to`, 'To');
  from.addEventListener('input', () => { state.from = from.value; onChange(answer()); });
  to.addEventListener('input', () => { state.to = to.value; onChange(answer()); });
  node.append(from, el('span', 'muted small', '–'), to, el('span', 'muted small', '%'));
  if (readable(raw, start.from)) node.append(savedAs(raw));
  return node;
}

// A level as chips (the common scale); a saved word outside it ("fluent") stays visible as written and counts as the answer until a level is picked.
function language(raw, onChange, label) {
  const level = LEVELS.find(each => each.toLowerCase() === raw.toLowerCase()) || '';
  let current = level;
  const answer = () => current || (raw && !level ? raw : '');
  const node = composite(answer, () => Boolean(answer()));
  const isOn = option => option === current;
  node.append(segmented(LEVELS, isOn, (option, group) => { current = isOn(option) ? '' : option; refresh(group, isOn); onChange(answer()); }, label));
  if (raw && !level) node.append(savedAs(raw));
  return node;
}

function link(raw, onChange, label, placeholder) {
  const node = input('url', String(raw ?? ''), label, placeholder || 'https://');
  node.addEventListener('input', () => onChange(node.value.trim()));
  return node;
}

// control: a kind of renderer/question-kind.js COMPOSITE; format: {options}; value: the saved text; onChange(text).
export function compositeControl(control, format, value, onChange, {ariaLabel = 'Answer', placeholder = ''} = {}) {
  const raw = String(value ?? '').trim();
  if (control === 'salary') return salary(format, raw, onChange, ariaLabel);
  if (control === 'duration') return duration(raw, onChange, ariaLabel);
  if (control === 'per_country') return permit(raw, onChange, ariaLabel);
  if (control === 'range') return range(raw, onChange, ariaLabel);
  if (control === 'language') return language(raw, onChange, ariaLabel);
  return link(raw, onChange, ariaLabel, placeholder);
}
