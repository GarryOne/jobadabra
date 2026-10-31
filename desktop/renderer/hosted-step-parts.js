// The cards of the setup's Always on step (owner, 24 Oct 2026: "more aligned with our design system"): the header card with a marked example of the morning e-mail. Pure builders; pages/hosted.js places them. Guard: test/hosted-step.test.js.
import {el, pill} from './components.js';
import {cardHead} from './card-shell.js';
import {EXAMPLE_JOBS, HELPER} from './hosted-words.js';

/** The shared e-mail field: label, full-width input and helper, reused by Always on's wizard and Focus entry. */
export function emailField(id, label = 'Where should we send them?') {
  const input = Object.assign(document.createElement('input'), {type: 'email', id, placeholder: 'you@example.com', autocomplete: 'email'});
  const field = el('div', 'step-field');
  field.append(Object.assign(document.createElement('label'), {htmlFor: id, textContent: label}), input, el('p', 'muted small field-hint', HELPER));
  return field;
}

export function digestExample() {
  const box = el('div', 'card-read');
  for (const [title, fit] of EXAMPLE_JOBS) {
    const line = el('div', 'switch-line', el('span', '', title));
    line.append(pill(`${fit} fit`, 'good'));
    box.append(line);
  }
  return box;
}

// Card 1: what Always on is, with the example under it. children: the rows (switch, e-mail) the page adds below.
export function alwaysOnCard(lead, ...rows) {
  const card = el('div', 'setting panel roomy'), head = cardHead({glyph: 'cloud', title: 'Always on: on our servers', lead});
  head.classList.add('summary-head');
  card.append(head, el('p', 'muted small', 'Example of a morning e-mail'), digestExample(), ...rows);
  return card;
}
