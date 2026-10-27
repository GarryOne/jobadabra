// "Needs your attention", a judgement call's answer as buttons (owner, 27 Oct 2026: "how can the user agree or not on the proposed answer?").
// The proposal is one button that agrees in one click ("✓ Keep it", "✓ Apply anyway"); "Change…" opens your saved answers for the same
// question as chips and a box for something else (the extension fills it in; need-send.js). It replaced the "Proposed answer ▾" dropdown, whose pre-selected
// proposal could not be picked (a select fires no change for the option it already shows). The choices come from answer-options.js;
// session-needs.js passes in what a pick does. Guard: test/need-choice.test.js.

const capital = text => text.replace(/^./, c => c.toUpperCase());

// -> the row's buttons for these choices: the proposal (when there is one), then Change…. `button(text, run, role)` makes
// one (session-needs.js smallButton), `pick(choice)` sends it, `change()` opens the picker, `field` is the form field the row is about ('' for a note).
export function choiceButtons(choices, {button, pick, change, field = ''}) {
  const proposed = choices.find(choice => choice.kind === 'proposed');
  const out = [];
  if (proposed) {
    const agree = button(`✓ ${capital(proposed.label)}`, () => pick(proposed), 'answer');
    agree.title = proposed.label;   // a long proposal is cut by the button's width
    out.push(agree);
  }
  // Your saved answers and a box: a way to say something else wherever there is a proposal, a saved answer, a field to fill or Claude to tell.
  if (proposed || field || choices.some(choice => choice.kind !== 'proposed')) out.push(button('Change…', change, 'change'));   // 'change' = Claude help on
  return out;
}

// -> the picker's chips: the proposal (pressed) and each answer you saved for the same question; a click sends that answer.
export function choiceChips(choices, pick) {
  return choices.filter(choice => choice.kind === 'proposed' || choice.kind === 'saved').map(choice => {
    const chip = document.createElement('button');   // not components.js el(): this file loads in tests without a window
    chip.className = 'chip-button ss-choice';
    chip.textContent = capital(choice.label);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(choice.kind === 'proposed'));
    chip.addEventListener('click', () => pick(choice));
    return chip;
  });
}
