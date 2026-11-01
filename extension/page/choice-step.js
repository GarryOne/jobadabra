// A question step drawn with plain buttons, found by STRUCTURE only (15 Oct 2026, Aldi's application start: a sentence, two buttons with no aria state and no form, and a "Continue" switched off until one
// is chosen). One rule for the page's reader (page/radios.js: the group is a field) and the flow's page count (page-reads.js pageShape: a page with such a group is a step with a question, not "no form").
// A FLOOR, never the words Yes/No: a group exists ONLY while a control waits for an answer (a visible, disabled button), and is 2-4 enabled <button type=button> children of one parent, none of them
// disabled or carrying an aria state, outside a form, dialog, radiogroup or toolbar. The same buttons with nothing waiting are not a group (a card's two buttons). Guard: app-core/test/yes-no-step.test.js.
(() => {
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const nameOf = el => String(el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
  // The controls that wait for an answer: visible and switched off.
  const waiting = () => Array.from(document.querySelectorAll('button, [role=button], input[type=submit], input[type=button]')).filter(control => visible(control) && (control.disabled || control.getAttribute('aria-disabled') === 'true'));
  const optionsOf = group => Array.from(group.children).filter(child => child.tagName === 'BUTTON' && child.type === 'button' && !child.hasAttribute('aria-pressed'));
  // -> the parents of such options (document order).
  function groups({isVisible = visible, named = nameOf} = {}) {
    if (!waiting().length) return [];
    const parents = new Map();
    for (const button of document.querySelectorAll('button[type=button]:not([aria-pressed]):not([disabled])')) {
      if (!button.parentElement || button.closest('form, [role=radiogroup], [role=toolbar], dialog, [role=dialog]')) continue;
      parents.set(button.parentElement, [...(parents.get(button.parentElement) || []), button]);
    }
    return [...parents].filter(([group, buttons]) => buttons.length >= 2 && buttons.length <= 4 && optionsOf(group).length === buttons.length && !group.querySelector('[disabled], [aria-disabled=true]')
      && buttons.every(isVisible) && buttons.every(button => named(button))).map(([group]) => group);
  }
  window.__jobPilottoChoiceStep = {groups, waiting, optionsOf};
})();
