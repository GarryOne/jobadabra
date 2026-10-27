// Selects the focused text control immediately before debugger typing so existing text is replaced.

/** Select the focused input/textarea for replacement; refuse another field or an unsafe control. */
export async function selectForReplacement(page, field = '') {
  // Why (27 Oct 2026, d4): a controlled phone widget can restore its caret on Select All's keyup, making the next typing append a second number.
  return page(expected => {
    const el = document.activeElement;
    if (!el || (expected && el.id !== expected && el.name !== expected) || el.disabled || el.readOnly) return false;
    if (el.tagName !== 'TEXTAREA' && (el.tagName !== 'INPUT' || !['text', 'search', 'tel', 'email', 'url', 'number'].includes(el.type))) return false;
    // Invariant: select only this writer's focused control; never clear a value or change country/format.
    el.select();
    return el.selectionStart === null || (el.selectionStart === 0 && el.selectionEnd === el.value.length);
  }, [field]).catch(() => false);
}
