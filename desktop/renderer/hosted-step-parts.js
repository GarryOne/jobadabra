// Shared Always on e-mail field for the Focus offer; Settings uses its Notifications address. Guard: test/suggestions.test.js.
import {el} from './components.js';
import {HELPER} from './hosted-words.js';

/** The shared e-mail field: label, full-width input and helper, used by Always on's Focus entry. */
export function emailField(id, label = 'Where should we send them?') {
  const input = Object.assign(document.createElement('input'), {type: 'email', id, placeholder: 'you@example.com', autocomplete: 'email'});
  const field = el('div', 'step-field');
  field.append(Object.assign(document.createElement('label'), {htmlFor: id, textContent: label}), input, el('p', 'muted small field-hint', HELPER));
  return field;
}
