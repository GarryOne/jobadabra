// The one answer control for a question, drawn from its kind (renderer/question-kind.js formatFor): a text field, a paragraph box, Yes / No, the form's own
// options (a segmented choice when they are few and short, else a menu), several picks, a date or an amount (renderer/question-control-values.js). Built from the shared parts (.segmented, a native select): no CSS
// of its own. Used by Jobs → Answer once and Profile → Application answers; the value it gives is the meaning the fill maps to each form's own options.
// Guarded by test/question-control.test.js.
import {el} from './components.js';
import {COMPOSITE, KINDS, KIND_NAMES, joinPicks, picksOf} from './question-kind.js';
import {isAsked} from './work-eligibility.js';
import {compositeControl} from './question-control-composite.js';
import {amountControl, dateControl, refresh, savedAs, segmented} from './question-control-values.js';

const FEW = 3, SHORT = 18, FEW_PICKS = 6;
const segmentedOk = (options, most) => options.length <= most && options.every(option => option.length <= SHORT);

// format: {control, options}; value: the saved answer ('' = none); onChange(value). -> the control node (its .value reads the current answer).
export function answerControl(format, value, onChange, {placeholder = 'Your answer', ariaLabel = 'Answer', chips = false} = {}) {
  const control = format?.control || 'text', options = format?.options || [];
  let current = String(value ?? '');
  const set = next => { current = next; node.value = next; onChange(next); };
  let node;
  if (control === 'yes_no' || (control === 'single' && segmentedOk(options, chips ? FEW_PICKS : FEW))) {
    const isOn = option => option.toLowerCase() === current.toLowerCase();
    node = segmented(options, isOn, (option, group) => { set(isOn(option) ? '' : option); refresh(group, isOn); }, ariaLabel);
  } else if (control === 'single') {
    node = Object.assign(el('select', ''), {ariaLabel});
    node.append(new Option('Choose…', ''));
    // An answer saved in other words (typed before the kind was known) stays as a choice: nothing is lost.
    if (current && !options.some(option => option.toLowerCase() === current.toLowerCase())) node.append(new Option(current, current));
    for (const option of options) node.append(new Option(option, option));
    node.value = options.find(option => option.toLowerCase() === current.toLowerCase()) || current;
    node.addEventListener('change', () => { current = node.value; onChange(current); });
  } else if (control === 'multi' && segmentedOk(options, FEW_PICKS)) {
    const isOn = option => picksOf(current, options).includes(option);
    node = segmented(options, isOn, (option, group) => {
      const picks = picksOf(current, options);
      set(joinPicks(options.filter(each => (each === option ? !picks.includes(each) : picks.includes(each)))));
      refresh(group, isOn);
    }, ariaLabel);
  } else if (control === 'multi') {
    node = Object.assign(el('select', ''), {multiple: true, ariaLabel, size: Math.min(6, options.length)});
    const picks = picksOf(current, options);
    for (const option of options) node.append(new Option(option, option, false, picks.includes(option)));
    node.addEventListener('change', () => { current = joinPicks([...node.selectedOptions].map(option => option.value)); onChange(current); });
  } else if (control === 'date') {
    node = dateControl(format, current, next => { current = next; onChange(next); }, {ariaLabel});
  } else if (control === 'amount') {
    node = amountControl(format, current, next => { current = next; onChange(next); }, {ariaLabel});
  } else if (COMPOSITE.includes(control)) {
    node = compositeControl(control, format, current, next => { current = next; onChange(next); }, {ariaLabel, placeholder});
  } else if (control === 'textarea') {
    node = Object.assign(el('textarea', ''), {value: current, placeholder, ariaLabel, rows: 3});
    node.addEventListener('input', () => { current = node.value; onChange(current); });
  } else {
    node = Object.assign(el('input', ''), {type: 'text', value: current, placeholder, ariaLabel});
    node.addEventListener('input', () => { current = node.value; onChange(current); });
  }
  // Why (28 Oct 2026, owner's screenshot): a value still asked (the template's marker) is no saved answer, so it is never drawn as "Saved as".
  // A saved answer no option names stays visible as written under the choices ("Saved as: …"), never hidden behind nothing picked; a menu shows it as a choice.
  if (node.classList.contains('segmented')) node.dataset.savedValue = current;   // the shot's check: a saved value its choice does not show (scripts/cut-fields.mjs)
  if (current && !isAsked(current) && ['yes_no', 'single', 'multi'].includes(control) && node.tagName !== 'SELECT' && !options.some(option => option.toLowerCase() === current.toLowerCase()) && !picksOf(current, options).length) {
    const wrap = el('div', 'qa-values');
    wrap.append(node, savedAs(current));
    node = wrap;
  }
  if (node.tagName === 'DIV' && !('complete' in node)) Object.defineProperty(node, 'value', {get: () => current, set: next => { current = next; }, configurable: true});
  // .complete: the answer can be confirmed (a date that also asks about constraints needs them chosen too).
  if (!('complete' in node)) Object.defineProperty(node, 'complete', {get: () => String(node.value ?? '').trim() !== '', configurable: true});
  node.dataset.answerKind = format?.kind || 'text';
  return node;
}

// "Answer as": the person changes a question's kind (it is written to the store with the question). onPick(kind).
export function kindPicker(kind, onPick) {
  const node = Object.assign(el('select', ''), {ariaLabel: 'Answer as'});
  for (const each of KINDS) node.append(new Option(KIND_NAMES[each], each));
  node.value = KINDS.includes(kind) ? kind : 'text';
  node.addEventListener('change', () => onPick(node.value));
  return node;
}
