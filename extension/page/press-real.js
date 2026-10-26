// Move 2 of the hybrid fill, the page's side (owner, 26 Oct 2026; worker: extension/press-real.js): the choices the fill answered that did not take the answer by a scripted
// click (page/fill.js notes them: "answer given, but the field did not take it") are listed with where to press them for real, so the worker presses there through Chrome's
// debugger, and each is read back after. Two shapes, by structure: a group of options (an ARIA radio group, pressable buttons, a group named by a label link: page/radios.js),
// pressed on the option whose name is the fill's answer; and a custom dropdown trigger (div/button role=combobox, a button with a listbox popup), pressed to open, then on the
// option drawn with the answer's name. Control mechanics only: the answer is the fill's own (the AI's or the person's), never chosen here. Floors: never a native input or a text
// box (page/fill-verify.js types those), never a legal question (page/radios.js optionOf), within the control's one attempt log (page/attempts.js "press_real"); the worker checks
// each point against the press floor too. Values stay in the page. Guard: worker/test/hybrid-moves.test.js; the widget zoo's radio-trusted-only-1 and custom-select-1.
(() => {
  if (window.__jobPilottoPressSpots) return;
  const norm = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const shown = el => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const TRIGGER = 'div[role=combobox], button[role=combobox], button[aria-haspopup=listbox], [role=button][aria-haspopup=listbox]';
  const ops = () => window.__jobPilottoFillKit?.radioOps;
  const groupOf = key => document.getElementById(key) || document.querySelector(`[data-jobpilotto-group="${CSS.escape(key)}"]`);
  // field -> {kind: 'group' | 'menu', el}, or null for any other control (a text box, a native choice: not this move's).
  const controlOf = field => {
    if (String(field).startsWith('aria:')) { const group = groupOf(String(field).slice(5)); return group ? {kind: 'group', el: group} : null; }
    const el = document.getElementById(String(field));
    return el && el.matches(TRIGGER) && !el.matches('input, select, textarea') ? {kind: 'menu', el} : null;
  };
  const answerOf = field => (window.__jobPilottoNotTakenAll?.() || []).find(([noted]) => noted === field)?.[1];
  // Does the control hold the answer now? A group: its answer's option reads as on. A dropdown: the trigger shows the answer's words.
  const holds = (control, answer) => (control.kind === 'group' ? (option => !!option && !!ops()?.isOn(option))(ops()?.optionOf(control.el, answer))
    : !!norm(answer) && norm(control.el.textContent) === norm(answer));
  const spotOf = el => {
    el.scrollIntoView?.({block: 'center', inline: 'nearest'});
    const box = el.getBoundingClientRect();
    return box.width && box.height ? {x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2)} : null;
  };
  // The one option drawn now whose name is the answer: the same words, else the only one that starts with them.
  const optionFor = (options, answer) => {
    const want = norm(answer), named = options.map(option => ({option, n: norm(option.textContent)}));
    const starts = named.filter(item => item.n.startsWith(want));
    return named.find(item => item.n === want)?.option || (starts.length === 1 ? starts[0].option : null);
  };
  const before = new Map();   // field -> its state before the press (the attempt log's key)
  // -> [{field, step: 'option' | 'opener', x, y}] for each noted choice that is shown and still does not hold its answer (at most 6).
  window.__jobPilottoPressSpots = () => {
    const spots = [];
    for (const [field, answer] of window.__jobPilottoNotTakenAll?.() || []) {
      const control = controlOf(field), log = window.__jobPilottoAttempts;
      if (spots.length >= 6 || !control || !shown(control.el) || holds(control, answer) || (log && !log.mayTry(control.el, 'press_real'))) continue;
      const target = control.kind === 'group' ? ops()?.optionOf(control.el, answer) : control.el;
      const at = shown(target) ? spotOf(target) : null;
      if (!at) continue;
      if (log) before.set(field, log.stateOf(control.el));
      spots.push({field, step: control.kind === 'group' ? 'option' : 'opener', ...at});
    }
    return spots;
  };
  // After the opener was pressed for real: where the option with the answer's name is drawn (in the list the trigger names, else any shown option), or null.
  window.__jobPilottoPressOptionSpot = field => {
    const control = controlOf(field), answer = answerOf(field);
    if (control?.kind !== 'menu' || !norm(answer)) return null;
    const list = (id => (id ? document.getElementById(id) : null))(control.el.getAttribute('aria-controls'));
    const option = optionFor([...(list || document).querySelectorAll('[role=option]')].filter(shown), answer);
    return option ? spotOf(option) : null;
  };
  // After the press: written in the control's attempt log, and whether it holds the answer now; one that does is no longer "not taken".
  window.__jobPilottoPressedNow = field => {
    const control = controlOf(field), answer = answerOf(field);
    if (!control) return false;
    const taken = holds(control, answer);
    window.__jobPilottoAttempts?.note(control.el, 'press_real', before.get(field), taken);
    if (taken) window.__jobPilottoForgetNotTaken?.(field);
    return taken;
  };
})();
