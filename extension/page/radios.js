// Radio questions, read as one choice field each and answered by the option whose name is the answer. Two shapes:
//   - native: <input type=radio>, grouped by name (the field "radio:<name>"; read by page/fill.js describeForm);
//   - ARIA: role=radiogroup > role=radio that are not inputs (SuccessFactors, Workday, React kits; the field "aria:<id>"). The question and
//     each option go by their accessible name: aria-label, else the elements aria-labelledby names, else the text (the words often live in
//     another element). 9 Oct 2026, live: 9 required questions of a SuccessFactors form were only "question on the page not read".
//   - pressable buttons: two or more button[aria-pressed] under one parent (Ashby's Yes/No, size pickers), the title in a label above; the same
//     field "aria:<id>", found by structure and never by the words Yes/No (6 Oct 2026, OpenAI and Colonist: 3 required Ashby questions "not read").
//   - plain buttons (a question step, 15 Oct 2026: Aldi's application start, a sentence, two buttons with no aria state and a "Continue" switched off until one is chosen): a group ONLY while a control waits
//     for an answer (a visible disabled button), 2-4 enabled <button type=button> children of one parent, outside a form, dialog or toolbar. This is a FLOOR, by structure, never the words Yes/No: the
//     same buttons with nothing waiting are not a field (a card's two buttons). An option shows no state: a press is taken as the answer only when a waiting control comes alive (its effect).
//   - a group named only by a label link (hybrid fill move 1, owner 26 Oct 2026; widget zoo chips-no-aria-1): an element with no role (or role=group) that aria-labelledby or a
//     <label for> names, holding 2-8 visible focusable options with words and nothing else (no box, no link). Its options may show their state only by a class: a press that changes
//     the option's class is taken as chosen (data-jobpilotto-chosen), so it is never pressed again (a second press would undo it).
// Injected before page/fill.js (extension/flow.js), which passes its helpers in. Never picks a legal option (LEGAL, the fill's own floor).
// Shape test: desktop/test/page-radios.test.js.
(() => {
  window.__jobPilottoRadios = ({clean, norm, labelOf, questionOf, LEGAL, visible}) => {
    const words = node => (window.__jobPilottoRequired?.read || (n => n?.textContent || ''))(node);   // the one words reader (page/required-mark.js): no icon text
    const nameOf = el => clean(el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => (id && words(document.getElementById(id))) || '').join(' ') || words(el) || '');
    // The one option whose name is the answer: the same words, else the only one that starts with or contains them.
    const optionFor = (options, answer, name) => {
      const want = norm(answer);
      const named = options.map(option => ({option, n: norm(name(option))}));
      const one = list => (list.length === 1 ? list[0].option : null);
      return named.find(item => item.n === want)?.option || one(named.filter(item => item.n.startsWith(want))) || one(named.filter(item => item.n.includes(want)));
    };
    const pickRadio = (name, answer) => {
      const match = optionFor(Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`)), answer, labelOf);
      if (!match || LEGAL.test(`${questionOf(match)} ${labelOf(match)}`)) return false;
      if (!match.checked) (globalThis.__jobPilottoPress?.(match) || match.click());
      return match.checked;
    };
    const groupOf = key => document.getElementById(key) || document.querySelector(`[data-jobpilotto-group="${CSS.escape(key)}"]`);
    // The options of a group: its role=radio elements, else (a pressable-button group) its aria-pressed buttons.
    const pressables = group => (group?.dataset?.jobpilottoPlainGroup ? plainButtons(group) : group?.dataset?.jobpilottoNamedGroup ? Array.from(group.children)
      : Array.from(group?.querySelectorAll('button[aria-pressed]') || []).filter(button => button.getAttribute('role') !== 'radio'));
    const plainButtons = group => window.__jobPilottoChoiceStep.optionsOf(group);
    const radiosOf = group => {
      const radios = Array.from(group?.querySelectorAll('[role=radio]') || []).filter(radio => radio.tagName !== 'INPUT');
      return radios.length ? radios : pressables(group);
    };
    // An option reads as on by its own aria state, or by the native radio drawn inside it (a segment's aria-checked can lag behind or never be written).
    const isOn = option => option.dataset?.jobpilottoChosen === '1' || option.getAttribute('aria-checked') === 'true' || option.getAttribute('aria-pressed') === 'true' || !!option.querySelector?.('input[type=radio]:checked, input[type=checkbox]:checked');
    // A control that waits for an answer (page/choice-step.js). A plain option has no state of its own (no aria-pressed/checked/radio inside).
    const waitingControls = () => window.__jobPilottoChoiceStep.waiting();
    const plain = option => !option.hasAttribute('aria-pressed') && !option.hasAttribute('aria-checked') && !option.querySelector?.('input[type=radio], input[type=checkbox]');
    // Press an option the way a person does and re-read it after each step: what sits at its centre (the label or text the page listens on), then the
    // native input inside it, then the option itself. A segmented control's own element often has no handler: the state is set by what is inside it.
    const press = option => {
      const box = option.getBoundingClientRect?.();
      if (box && box.width && box.height && (box.bottom < 0 || box.top > innerHeight)) option.scrollIntoView?.({block: 'center'});
      const centre = box && box.width && box.height ? (point => point && option.contains(point) ? point : null)(document.elementFromPoint?.(box.left + box.width / 2, box.top + box.height / 2)) : null;
      const steps = [centre && centre !== option ? centre : null, option.querySelector?.('input[type=radio], input[type=checkbox]'), option];
      const waiting = plain(option) ? waitingControls() : [];   // a plain option shows no state of its own: its effect is what a person sees, the control that waited for an answer comes alive
      const named = !!option.parentElement?.dataset?.jobpilottoNamedGroup && plain(option), classBefore = option.className;   // a named group's option may show its state only by a class
      for (const target of steps) {
        if (!target) continue;
        (globalThis.__jobPilottoPress?.(target) || target.click());
        if (named && option.className !== classBefore) { for (const other of option.parentElement.children) delete other.dataset.jobpilottoChosen; option.dataset.jobpilottoChosen = '1'; return true; }
        if (waiting.length && waiting.some(control => !control.disabled && control.getAttribute('aria-disabled') !== 'true')) { option.dataset.jobpilottoChosen = '1'; return true; }
        if (isOn(option)) return true;
      }
      return isOn(option);
    };
    const checked = radios => radios.some(isOn);
    const pickAriaRadio = (key, answer) => {
      const group = groupOf(key);
      const match = group && optionFor(radiosOf(group), answer, nameOf);
      if (!match || LEGAL.test(`${groupName(group, radiosOf(group))} ${nameOf(match)}`)) return false;
      if (isOn(match)) return true;
      // A press is a try in the group's one attempt log (page/attempts.js); the press says whether it worked (the one reader cannot read a group).
      const log = window.__jobPilottoAttempts;
      if (log && !log.mayTry(group, 'press')) return false;
      const before = log?.stateOf(group), ok = press(match);
      log?.note(group, 'press', before, ok);
      return ok;
    };
    // A pressable-button group's title: its own accessible name, else the nearest title BEFORE it that no other control owns (page/label-before.js, one rule for every group;
    // 12 Oct 2026: the first label of the form named a toggle, "First name"). -> the element where its required mark would sit, or null.
    const titleAbove = group => window.__jobPilottoGroupTitle(group)?.el || null;
    const groupName = (group, radios) => String(nameOf(group) || '') && group.getAttribute('role') === 'radiogroup' ? nameOf(group)
      : String(window.__jobPilottoGroupTitle(group)?.text || nameOf(group) || questionOf(radios[0]) || '');
    // Parents of two or more pressable buttons that are a question: not a toolbar, a few named options.
    const pressableGroups = () => {
      const parents = new Map();
      for (const button of document.querySelectorAll('button[aria-pressed]')) {
        if (button.getAttribute('role') === 'radio' || !button.parentElement || button.closest('[role=radiogroup], [role=toolbar]')) continue;
        parents.set(button.parentElement, [...(parents.get(button.parentElement) || []), button]);
      }
      const found = [...parents].filter(([, buttons]) => buttons.length >= 2 && buttons.length <= 8 && buttons.every(visible) && buttons.every(button => clean(nameOf(button)))).map(([group]) => group);
      // A step that asks a question with plain buttons (page/choice-step.js: structure, only while a control waits for the answer).
      for (const group of window.__jobPilottoChoiceStep.groups({isVisible: visible, named: button => clean(nameOf(button))})) {
        if (found.includes(group)) continue;
        group.dataset.jobpilottoPlainGroup = '1';
        found.push(group);
      }
      for (const group of namedGroups()) if (!found.includes(group)) { group.dataset.jobpilottoNamedGroup = '1'; found.push(group); }
      return found;
    };
    // Groups named only by a label link (see the head of this file): structure only, no words.
    const CHOICE = 'button, [role=button], [role=option], [tabindex]:not([tabindex="-1"])';
    const namedGroups = () => {
      const named = new Set(document.querySelectorAll('[aria-labelledby]:not([role]), [aria-labelledby][role=group]'));
      for (const label of document.querySelectorAll('label[for]')) { const el = document.getElementById(label.htmlFor); if (el && !label.control && (!el.getAttribute('role') || el.getAttribute('role') === 'group')) named.add(el); }
      return [...named].filter(group => {
        if (group.closest('nav, header, footer, dialog, [role=navigation], [role=menu], [role=menubar], [role=listbox], [role=tablist], [role=toolbar], [role=radiogroup]')) return false;
        if (group.querySelector('input, select, textarea, a[href], [role=radio], [role=checkbox], [role=combobox], button[aria-pressed]')) return false;
        const items = Array.from(group.children);
        return items.length >= 2 && items.length <= 8 && items.every(item => item.matches(CHOICE) && !item.querySelector(CHOICE) && visible(item) && clean(item.textContent) && clean(item.textContent).length <= 80);
      });
    };
    // Every visible ARIA radio group, and pressable-button group, as a field (a group gets a key it keeps for the fill that follows).
    const ariaFields = () => [...document.querySelectorAll('[role=radiogroup]'), ...pressableGroups()].flatMap(group => {
      const radios = radiosOf(group).filter(visible);
      if (radios.length < 2) return [];
      const raw = groupName(group, radios);
      if (!clean(raw)) return [];
      if (!group.id && !group.dataset.jobpilottoGroup) group.dataset.jobpilottoGroup = `g${document.querySelectorAll('[data-jobpilotto-group]').length + 1}`;
      const question = clean(window.__jobPilottoRequired.clean(raw));
      const title = group.getAttribute('role') === 'radiogroup' ? null : titleAbove(group);
      return [{field: `aria:${group.id || group.dataset.jobpilottoGroup}`, label: question, type: 'radio',
        required: window.__jobPilottoRequired.has(raw) || /required/i.test(title?.className || '') || group.getAttribute('aria-required') === 'true' || radios.some(radio => radio.getAttribute('aria-required') === 'true'),
        options: radios.map(nameOf).filter(Boolean), filled: checked(radios), legal: LEGAL.test(question)}];
    });
    // The described ARIA fields as audit rows (the audit reads inputs only), with their state now.
    const ariaRows = form => form.filter(row => String(row.field).startsWith('aria:'))
      .map(row => ({...row, filled: checked(radiosOf(groupOf(row.field.slice(5))))}));
    // The option of a group (its element) whose name is the answer, for a press for real (page/press-real.js); null for a legal question or no such option.
    const optionOf = (group, answer) => { const match = group && optionFor(radiosOf(group), answer, nameOf); return match && !LEGAL.test(`${groupName(group, radiosOf(group))} ${nameOf(match)}`) ? match : null; };
    return {nameOf, pickRadio, pickAriaRadio, ariaFields, ariaRows, optionOf, isOn};
  };
})();
