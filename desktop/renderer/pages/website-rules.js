// Website-specific rules (owner's Form knowledge mockup, 16 Oct 2026). TODO(AI): PR B shows site rules in Reports → Form fills, else this table goes (28 Oct 2026)
// Not drawn on Profile since 28 Oct 2026 (owner: "It's getting dropped… since we have Form fills"); its form helpers (select, input, labelled) are shared.
// Was: the rules Jobadabra remembered from forms as a table (Field · Saved value or rule · Website · Edit · ⋮), filtered by website and
// type; Edit opens the row (field label, applies to, saved value, rule type, why, technical details, Delete rule); "Add rule" adds one. A rule
// whose value is missing is also listed under Needs review (reviewRows). Rules come from renderer/knowledge-model.js; a line that is not a rule
// is listed under the table, never dropped. Writes: view.change('knowledge', …) (pages/outline-tab.js). Guarded by test/profile-tabs-render.test.js.
import {el, moreButton, pill} from '../components.js';
import {icon} from '../icons.js';
import {ANY, BY_HAND, KINDS, label, lineOf, matches, rules, sites} from '../knowledge-model.js';

const TEXT = 'knowledge';
const KIND_ICON = {answer: 'edit', option: 'check-circle', meaning: 'help', widget: 'sliders'};
export const ruleFilters = {site: '', kind: ''};
let open = null;          // the row being edited (its id, or a new rule's key)
const drafts = new Map(); // id → the rule as edited; new rules under a key `new-<n>`
let added = 0;

export function resetRules() { drafts.clear(); open = null; }

export function select(options, value, onChange, ariaLabel) {
  const node = Object.assign(el('select', ''), {ariaLabel});
  for (const [key, text] of options) node.append(new Option(text, key));
  node.value = value;
  node.addEventListener('change', () => onChange(node.value));
  return node;
}
export function input(value, onInput, {placeholder = '', ariaLabel = ''} = {}) {
  const node = Object.assign(el('input', ''), {type: 'text', value, placeholder, ariaLabel});
  node.addEventListener('input', () => onInput(node.value));
  return node;
}
export const labelled = (text, control, wide = false) => { const box = el('label', wide ? 'span-all' : ''); box.append(el('span', '', text), control); return box; };

// The pending change for a rule, from its draft: an edited line (or none when it is back to what the page says), a removal, an added rule.
function sync(view, rule) {
  const draft = drafts.get(rule.id);
  if (rule.isNew) {
    if (draft && !draft.removed && draft.field.trim()) view.change(TEXT, {op: 'append', key: rule.id, lines: [lineOf(draft)]});
    else view.undo(TEXT, {op: 'append', key: rule.id});
    return;
  }
  const line = draft && lineOf(draft);
  if (draft?.removed) { view.undo(TEXT, {op: 'text', id: rule.id}); view.change(TEXT, {op: 'remove', id: rule.id, was: rule.text}); return; }
  view.undo(TEXT, {op: 'remove', id: rule.id});
  if (draft && line !== rule.text) view.change(TEXT, {op: 'text', id: rule.id, value: line, was: rule.text}); else view.undo(TEXT, {op: 'text', id: rule.id});
}
const draftOf = rule => { if (!drafts.has(rule.id)) drafts.set(rule.id, {...rule}); return drafts.get(rule.id); };

function editor(view, rule, siteList) {
  const draft = draftOf(rule);
  const set = key => value => { draft[key] = value; sync(view, rule); };
  const grid = el('div', 'form-grid cols-2');
  const where = [...new Set([ANY, ...siteList, draft.site || ANY])].map(site => [site, site === ANY ? 'All websites' : site]);
  grid.append(labelled('Field label', input(draft.field, set('field'), {placeholder: 'The question as the form asks it'})),
    labelled('Applies to', select(where, draft.site || ANY, set('site'), 'Applies to')),
    labelled(draft.kind === 'option' ? 'Saved option' : 'Saved value', input(draft.value, set('value'), {placeholder: 'Not set'})),
    labelled('Rule type', select(Object.entries(KINDS), draft.kind, set('kind'), 'Rule type')),
    labelled('Why', input(draft.reason === BY_HAND && rule.isNew ? '' : draft.reason, set('reason'), {placeholder: BY_HAND}), true));
  const foot = el('div', 'kn-foot');
  const tech = el('details', 'plain kn-tech');
  tech.append(el('summary', 'muted small', 'Technical details'), el('code', 'small', rule.isNew ? lineOf(draft) : rule.text));
  const remove = Object.assign(el('button', 'link danger', null), {type: 'button'});
  remove.append(icon('trash'), rule.isNew ? 'Remove' : 'Delete rule');
  remove.addEventListener('click', () => { draft.removed = true; sync(view, rule); open = null; view.redraw(); });
  foot.append(tech, remove);
  const box = el('div', 'kn-editor');
  box.append(grid, el('p', 'muted small', rule.isNew ? 'Added by you.' : 'Learned from a form fill.'), foot);
  return box;
}

const notSet = rule => !rule.value && (rule.kind === 'answer' || rule.kind === 'option');

function row(view, rule, siteList) {
  const draft = drafts.get(rule.id), shown = draft || rule;
  const tr = el('tr', `kn-row${open === rule.id ? ' is-open' : ''}${draft?.removed ? ' is-removed' : ''}`);
  const name = el('td', ''), named = el('div', 'kn-field');
  named.append(icon(KIND_ICON[shown.kind] || 'edit'), el('b', '', label(shown.field) || 'New rule'));
  name.append(named);
  const value = el('td', '');
  if (shown.value) value.textContent = shown.value;
  else if (notSet(shown)) value.append(pill('Not set · Needs review', 'warn'));
  else value.append(el('span', 'muted', shown.reason));
  const edit = Object.assign(el('button', 'secondary small-button', open === rule.id ? 'Close' : 'Edit'), {type: 'button'});
  edit.addEventListener('click', () => { open = open === rule.id ? null : rule.id; view.redraw(); });
  const actions = el('td', ''), buttons = el('div', 'kn-actions');
  actions.append(buttons);
  buttons.append(edit, moreButton([{label: draft?.removed ? 'Keep this rule' : 'Delete rule', icon: 'trash', danger: !draft?.removed,
    run: () => { const d = draftOf(rule); d.removed = !d.removed; sync(view, rule); view.redraw(); }}]));
  tr.append(name, value, el('td', 'muted', shown.site === ANY ? 'All websites' : shown.site), actions);
  if (open !== rule.id || draft?.removed) return [tr];
  const more = el('tr', 'kn-edit-row'), cell = el('td', '');
  cell.colSpan = 4;
  cell.append(editor(view, rule, siteList));
  more.append(cell);
  return [tr, more];
}

// Rules whose value is missing, for Needs review: {key, title, under, field(view) → an input that sets the value}.
export function reviewRows(view, query = '') {
  return rules(view.items[TEXT] || []).filter(rule => !rule.other && notSet(rule) && !drafts.get(rule.id)?.removed && matches(rule, {query}))
    .map(rule => ({key: `rule:${rule.id}`, title: label(rule.field), under: `Website rule · ${rule.site === ANY ? 'all websites' : rule.site}`,
      value: drafts.get(rule.id)?.value || '',
      field: () => input(drafts.get(rule.id)?.value || '', value => { draftOf(rule).value = value; sync(view, rule); }, {placeholder: 'Not set', ariaLabel: label(rule.field)})}));
}

// The rules' section body (inside a collapsed <details>, pages/application-answers.js): filters, the table, other lines.
export function drawRules(view, into, query = '') {
  const list = rules(view.items[TEXT] || []);
  const fresh = [...drafts.entries()].filter(([id]) => id.startsWith('new-')).map(([id, draft]) => ({...draft, id, isNew: true}));
  const all = [...fresh, ...list.filter(rule => !rule.other)], siteList = sites(list);
  const bar = el('div', 'toolbar');
  bar.append(select([['', 'All websites'], ...siteList.map(site => [site, site === ANY ? 'Any website' : site])], ruleFilters.site, value => { ruleFilters.site = value; view.redraw(); }, 'Website'),
    select([['', 'All types'], ...Object.entries(KINDS)], ruleFilters.kind, value => { ruleFilters.kind = value; view.redraw(); }, 'Type'));
  const table = el('table', 'data-table kn-table');
  const head = el('tr', '');
  for (const text of ['Field', 'Saved value or rule', 'Website', '']) head.append(el('th', '', text));
  table.append(el('thead', '', head));
  const tbody = el('tbody', '');
  const shown = all.filter(rule => rule.isNew || matches(drafts.get(rule.id) || rule, {...ruleFilters, query}));
  for (const rule of shown) tbody.append(...row(view, rule, siteList));
  table.append(tbody);
  into.append(bar);
  if (!all.length) into.append(el('p', 'muted', 'Nothing remembered yet: when you fix a field a form fill got wrong, Jobadabra keeps the rule here.'));
  else if (!shown.length) into.append(el('p', 'muted', 'No rule matches these filters.'));
  else into.append(table);
  const info = el('p', 'muted small kn-note');
  info.append(icon('info'), 'Website-specific rules apply only to that website.');
  into.append(info);
  const others = list.filter(rule => rule.other);
  if (others.length) {
    const more = el('details', 'plain kn-tech');
    more.append(el('summary', 'muted small', `${others.length} other line${others.length === 1 ? '' : 's'} on this page`));
    for (const other of others) more.append(el('p', 'small', other.text));
    into.append(more);
  }
  return {count: list.filter(rule => !rule.other).length};
}

export function newRule() {
  const key = `new-${++added}`;
  drafts.set(key, {site: ruleFilters.site || ANY, kind: ruleFilters.kind || 'answer', field: '', reason: BY_HAND, value: ''});
  open = key;
}
