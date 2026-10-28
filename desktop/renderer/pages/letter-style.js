// Settings → Profile → Cover letter: "Writing preferences" (owner, 17 Oct 2026: the Cover letter tab is the one home for letters; 18 Oct 2026, mockup 07:
// preferences first, read as a summary, a quiet Edit opens the inputs). Why (PR B1b, owner 28 Oct 2026: "Beside the letter"): the rules live in
// cover-letter/style.json (lib/letter-style.js, read and saved through letterStyle / letterStyleSave), no longer in the answers page. Read: one column per
// rule with its own label (no icon guessed from words); Edit: one input per rule and "Add a style rule", a draft on Profile's one save bar
// (pages/profile-save-bar.js). Guarded by test/letter-style.test.js.
import {el} from '../components.js';
import {doneButton, factColumns, setEditing} from '../card-shell.js';
import {profileBar} from './profile-save-bar.js';
import {input, labelled} from './form-controls.js';
export {STYLE_HEADING, isStyle} from '../writing-preferences-model.js';

const DEFAULT = 'No preferences yet: letters use a short, direct default (130–170 words).';
const card = () => document.getElementById('setting-letter-style');
let saved = [];              // the rules as last read
const typed = new Map();     // rule index (or 'add') → the text as edited
let source = null, done = null, node = null;

// "Never mention: salary" → {label: 'Never mention', value: 'salary'}; a line with no "label: value" shape is a rule as a whole.
const split = line => { const at = line.indexOf(': '); return at > 0 ? {label: line.slice(0, at), value: line.slice(at + 2)} : {label: '', value: line}; };
const lineOf = (rule, value) => (rule.label ? `${rule.label}: ${value.trim()}` : value.trim());
// The rules as they would be saved: each edited one (an empty one dropped), then the added one.
const drafted = () => [...saved.map((line, i) => (typed.has(i) ? lineOf(split(line), typed.get(i)) : line)), typed.get('add') || ''].map(line => line.trim()).filter(Boolean);
const changes = () => [...typed.entries()].filter(([key, text]) => (key === 'add' ? text.trim() : text !== split(saved[key]).value)).length;

function draw() {
  if (!node) return;
  const read = el('div', 'card-read');
  read.append(saved.length ? factColumns(saved.map(line => { const rule = split(line); return {label: rule.label || 'Rule', value: rule.value}; })) : el('p', 'muted', DEFAULT));
  const editor = el('div', 'card-editor'), grid = el('div', 'form-grid cols-2 pref-body');
  saved.forEach((line, i) => {
    const rule = split(line);
    grid.append(labelled(rule.label || 'Rule', input(typed.has(i) ? typed.get(i) : rule.value, text => { typed.set(i, text); changed(); }, {ariaLabel: rule.label || 'Rule'})));
  });
  if (!saved.length) grid.append(el('p', 'muted span-all', DEFAULT));
  grid.append(labelled('Add a style rule', input(typed.get('add') || '', text => { typed.set('add', text); changed(); },
    {placeholder: 'e.g. Never mention: salary', ariaLabel: 'Add a style rule'}), true));
  done = doneButton(card(), changes);
  editor.append(grid, done);
  node.replaceChildren(read, editor);
}
function changed() { done?.sync(); source?.changed(); }

/** Reads the rules (lib/letter-style.js moves an old section off the answers page first) and draws the card; registers its drafts once. */
export async function loadLetterStyle() {
  node = document.getElementById('letter-style-body');
  if (!node) return;
  if (!source) {
    source = profileBar().register({id: 'letter-style', tab: 'letter', label: 'Writing preferences', count: changes,
      save: async () => {
        const result = await window.pilot.letterStyleSave(drafted(), saved).catch(error => ({ok: false, error: error.message}));
        if (!result?.ok) return {ok: false, error: result?.error || 'The writing preferences were not saved.'};
        saved = result.lines; typed.clear(); setEditing(card(), false); draw();
        return {ok: true};
      },
      discard: () => { typed.clear(); setEditing(card(), false); draw(); }});
    document.getElementById('letter-style-edit')?.addEventListener('click', () => setEditing(card(), true));
  }
  const result = await window.pilot.letterStyle().catch(() => null);
  if (result?.ok && !changes()) saved = result.lines || [];
  draw();
}
