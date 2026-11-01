// The closer look's two hands besides a click (extension/ladder/rung4-picture.js; spec docs/superpowers/specs/2026-10-08-ai-escalation.md), injected into the page.
// fill: one listed text box that is still empty gets a value the app resolved from the person's contact details (never a password: the account step fills those, never a box
// that already holds something). choose: one listed native dropdown gets one of its own options. Controls are found by the label the sketch listed (account-fill.js accountSketch).
// Each answers a word the caller logs (never the value): filled | chosen, or why nothing was done. Guard: app-core/test/account-act.test.js.
export function fillControl(wanted, value) {
  if (!wanted || !String(value || '').trim()) return 'nothing-to-fill';
  const label = el => String((el.labels?.[0]?.innerText ?? el.labels?.[0]?.textContent) || el.getAttribute('aria-label') || el.placeholder || el.name || '').replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase();   // inline: this function is injected into the page alone
  const named = selector => [...document.querySelectorAll(selector)].filter(el => el.getClientRects().length && !el.disabled && label(el) === String(wanted || '').replace(/\s+/g, ' ').trim().toLowerCase());
  const found = named('input, textarea');
  if (found.length !== 1) return found.length ? 'several' : 'not-found';
  const box = found[0];
  if (!['text', 'email', 'tel', 'search', 'url', 'textarea'].includes(box.type) || box.readOnly) return 'not-a-text-box';   // a password, a file, a box that is read-only: never
  if (String(box.value || '').trim()) return 'not-empty';
  const setter = Object.getOwnPropertyDescriptor(box.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;   // the page's own framework sees the change
  if (setter) setter.call(box, String(value)); else box.value = String(value);
  box.dispatchEvent(new Event('input', {bubbles: true}));
  box.dispatchEvent(new Event('change', {bubbles: true}));
  return 'filled';
}

export function chooseOption(wanted, option) {
  const label = el => String((el.labels?.[0]?.innerText ?? el.labels?.[0]?.textContent) || el.getAttribute('aria-label') || el.placeholder || el.name || '').replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase();   // inline: this function is injected into the page alone
  const named = selector => [...document.querySelectorAll(selector)].filter(el => el.getClientRects().length && !el.disabled && label(el) === String(wanted || '').replace(/\s+/g, ' ').trim().toLowerCase());
  const found = named('select');
  if (found.length !== 1) return found.length ? 'several' : 'not-found';
  const text = String(option || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const matches = [...found[0].options].filter(item => !item.disabled && String(item.text || '').replace(/\s+/g, ' ').trim().toLowerCase() === text);
  if (matches.length !== 1) return matches.length ? 'several-options' : 'no-such-option';
  found[0].value = matches[0].value;
  found[0].dispatchEvent(new Event('input', {bubbles: true}));
  found[0].dispatchEvent(new Event('change', {bubbles: true}));
  return 'chosen';
}
