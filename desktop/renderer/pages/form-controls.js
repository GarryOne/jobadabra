// The small form controls the Profile and Strategy editors share: a select, a one-line text input and a label around a control.
// Why (PR B1, owner 28 Oct 2026 "Retire now, no replay"): they lived in the retired Website rules table (pages/website-rules.js).
import {el} from '../components.js';

/** A select of [key, text] options; onChange gets the picked key. */
export function select(options, value, onChange, ariaLabel) {
  const node = Object.assign(el('select', ''), {ariaLabel});
  for (const [key, text] of options) node.append(new Option(text, key));
  node.value = value;
  node.addEventListener('change', () => onChange(node.value));
  return node;
}
/** A one-line text input; onInput gets its text on every key. */
export function input(value, onInput, {placeholder = '', ariaLabel = ''} = {}) {
  const node = Object.assign(el('input', ''), {type: 'text', value, placeholder, ariaLabel});
  node.addEventListener('input', () => onInput(node.value));
  return node;
}
/** A control with its visible label (wide = across the whole grid). */
export const labelled = (text, control, wide = false) => { const box = el('label', wide ? 'span-all' : ''); box.append(el('span', '', text), control); return box; };
