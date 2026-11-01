// One question is one control, however its options are named (flow-checks' rule from #569, 13 Oct 2026; NICE's Greenhouse form, pool run 38325149096: a required fieldset of checkboxes with
// their own ids and a []-name read as 1 + every option, 16 against the panel's 8). The panel (review.js) and the replay's truth reader (desktop/e2e/lib/replay-truth.mjs, which injects this
// file's source into the page) take their groups from here, so they cannot drift apart. Read only: it never changes the page. Guard: app-core/test/option-groups.test.js.
//   groupOf(el) -> {key, box, options, title} | null: the group an option belongs to, null for a control that is not an option of a group (a lone box, a text field).
//     Options join by the box that holds ONLY options (a fieldset, an ARIA group): a box that also holds a text box, a select or a textarea (hidden inputs ignored) never merges its
//     checkboxes (a fieldset wrapping the whole form). Else by a shared name (radios with no name: by the container that holds only them). An element with an option role that wraps a hidden native radio is not a box of options: it joins its radiogroup.
//     key: the group ELEMENT on both paths (the native inputs and the option-role elements dedupe against each other), `options:<name>` for a shared name.
//   groupOfBox(box) -> the same, for a container that holds only options and is itself marked (a fieldset or div with aria-required).
//   answered(group) -> true when any option is checked, or the box itself, or something inside it, holds the ARIA state (Workable sets aria-checked on the wrapper).
(() => {
  const NATIVE = 'input[type=checkbox], input[type=radio]';
  const OPTION_ROLES = ['radio', 'checkbox', 'option', 'switch'];
  const ROLE_OPTIONS = OPTION_ROLES.map(role => `[role=${role}]`).join(', ');
  const ON = '[aria-checked="true"], [aria-pressed="true"], [aria-selected="true"], input:checked';
  const onlyOptions = box => !!box && !box.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea');
  const titleOf = box => (box?.querySelector?.('legend')?.textContent || box?.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60);

  function groupOf(el, doc = el?.ownerDocument || document) {
    if (!el || el.nodeType !== 1) return null;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (el.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
      const box = el.closest('fieldset, [role=radiogroup], [role=group]');
      if (onlyOptions(box)) return {key: box, box, options: [...box.querySelectorAll(NATIVE)], title: titleOf(box)};
      const name = el.name && doc.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`);
      if (name && name.length > 1) return {key: `options:${el.name}`, box: null, options: [...name], title: ''};
      // Radios with no name at all are exclusive by nature, and a page's script groups them as it likes: they join by the container that holds only them (two or more).
      const parent = type === 'radio' && !el.name ? el.parentElement : null;
      if (parent && onlyOptions(parent) && parent.querySelectorAll(NATIVE).length > 1) return {key: parent, box: parent, options: [...parent.querySelectorAll(NATIVE)], title: ''};
      return null;
    }
    if (OPTION_ROLES.includes(el.getAttribute('role') || '')) {
      const box = el.closest('[role=radiogroup], [role=group], [role=listbox]') || el.parentElement;
      return box ? {key: box, box, options: [...box.querySelectorAll(`${ROLE_OPTIONS}, ${NATIVE}`)], title: titleOf(box)} : null;
    }
    return null;
  }

  // A required container that is itself the box of options (aria-required on a fieldset or a div holding only options): its own group.
  const groupOfBox = box => (onlyOptions(box) && box.querySelector(`${NATIVE}, ${ROLE_OPTIONS}`) ? {key: box, box, options: [...box.querySelectorAll(`${ROLE_OPTIONS}, ${NATIVE}`)], title: titleOf(box)} : null);

  const answered = group => !!group && (group.options.some(option => option.checked === true) || !!(group.box && (group.box.matches(ON) || group.box.querySelector(ON))));

  const api = {groupOf, groupOfBox, answered, ON};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.__jobPilottoOptionGroups = api;
})();
