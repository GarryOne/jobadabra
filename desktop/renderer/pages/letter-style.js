// Settings → Profile → Cover letter: "Writing preferences", the "Cover letter style" section of the standard answers (owner, 17 Oct 2026: the Cover letter
// tab is the one home for letters; 18 Oct 2026, mockup 07: preferences first, read as a summary, a quiet Edit opens the inputs). The rules stay lines of
// the answers page, so every letter prompt keeps reading them (lib/job-letter.js, src/ai/kit.py); this tab edits them, Application answers no longer lists
// them. Read: one column per rule with its own label (no icon guessed from words); Edit: one input per rule and "Add a style rule", through
// Profile's one save bar (pages/profile-save-bar.js), on every store. Guarded by test/letter-style.test.js.
import {el} from '../components.js';
import {doneButton, factColumns, setEditing} from '../card-shell.js';
import {profileBar} from './profile-save-bar.js';
import {shown} from '../answers-model.js';
import {sections} from '../answers-model.js';
import {lineInput, outlineTab} from './outline-tab.js';
import {input, labelled} from './website-rules.js';

const TEXT = 'answers';
import {STYLE_HEADING, isStyle} from '../writing-preferences-model.js';
export {STYLE_HEADING, isStyle};
const typed = new Map();
let tab = null;

const card = () => document.getElementById('setting-letter-style');
let done = null;   // the editor's Done (card-shell.js doneButton), synced on each change
const DEFAULT = 'No preferences yet: letters use a short, direct default (130–170 words).';

function draw(view, into) {
  const style = sections(view.items[TEXT] || []).find(section => isStyle(section.title));
  // Read: each rule as a column, label over value (card-shell.js factColumns, like Your details; mockup 07); a line with no "label: value" shape shows whole.
  const read = el('div', 'card-read');
  const rules = (style?.items || []).filter(item => item.question || item.value || item.text);
  read.append(rules.length ? factColumns(rules.map(item => (item.question ? {label: shown(item.question), value: shown(item.value)} : {label: 'Rule', value: shown(item.value || item.text)})))
    : el('p', 'muted', DEFAULT));
  const editor = el('div', 'card-editor');
  const grid = el('div', 'form-grid cols-2 pref-body');
  for (const item of style?.items || []) grid.append(lineInput(view, TEXT, {...item, label: item.question}, typed));
  if (!style) grid.append(el('p', 'muted span-all', DEFAULT));
  // A new rule: after the section's last line, or the section itself at the end of the page.
  const change = text => (style ? {op: 'insert', after: style.after, key: 'add-style', lines: [text]} : {op: 'section', heading: STYLE_HEADING, lines: [text]});
  const add = input(typed.get('add-style') || '', text => {
    if (!text.trim()) { typed.delete('add-style'); view.undo(TEXT, change('')); } else { typed.set('add-style', text); view.change(TEXT, change(text.trim())); }
  }, {placeholder: 'e.g. Never mention: salary', ariaLabel: 'Add a style rule'});
  grid.append(labelled('Add a style rule', add, true));
  // Done closes an unchanged editor; with changes Profile's save bar does (Save all changes / Discard all).
  done = doneButton(card(), () => view.dirty());
  editor.append(grid, done);
  into.append(read, editor);
}

export async function loadLetterStyle() {
  const node = document.getElementById('letter-style-body');
  if (!node) return;
  if (!tab || tab.node !== node) {
    // Saved, discarded or read again: the card reads again (its drafts are gone with the bar's).
    tab = {...outlineTab('letterstyle', [TEXT], node, draw, {onReset: () => { typed.clear(); setEditing(card(), false); }, onChange: () => done?.sync(),
      bar: profileBar(), tab: 'letter', label: 'Writing preferences'}), node};
    document.getElementById('letter-style-edit')?.addEventListener('click', () => setEditing(card(), true));
  }
  await tab.load();
}
