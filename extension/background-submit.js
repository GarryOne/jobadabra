// The final browser action for a one-shot Full automation permit: recheck the same form and exact named control immediately before clicking.

/** Inspect or press inside the real page; only counts/digests leave it, and an ambiguous/invalid/changed page returns pressed:false. */
export async function submissionPage(action, {control = '', seal = ''} = {}) {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const fields = [...document.querySelectorAll('input, textarea, select, [role=combobox], [aria-required=true]')].filter(el => visible(el) && !el.disabled && el.type !== 'hidden');
  const requiredComplete = fields.length > 0 && fields.every(el => typeof el.checkValidity !== 'function' || el.checkValidity()) &&
    fields.filter(el => el.required || el.getAttribute?.('aria-required') === 'true').every(el => {
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked || el.type === 'radio' && fields.some(other => other.name === el.name && other.checked);
      if (el.type === 'file') return !!el.files?.length || el.hasAttribute?.('data-jobpilotto-filled');
      return !!clean(el.value || el.getAttribute?.('aria-valuetext') || el.textContent);
    });
  const named = [...document.querySelectorAll('button, a, [role=button], input[type=submit], input[type=button]')].filter(el => visible(el) && clean(el.innerText || el.textContent || el.value || el.getAttribute?.('aria-label')).toLowerCase() === clean(control).toLowerCase());
  const button = named.length === 1 ? named[0] : null;
  // Why (2026-10-28, e2e proof of Background automation, measured): a Submit button below the fold has no element at its point, so every filled form read as not safe and went to the person;
  // in view first, then asked what is on top (the live view's own press does the same: hosted/ready-fill/live.mjs BUTTON_AT).
  button?.scrollIntoView?.({block: 'center', behavior: 'instant'});
  const rect = button?.getBoundingClientRect(), onTop = rect && document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const blocked = fields.some(el => el.type === 'password') || [...document.querySelectorAll('[data-jobpilotto-draft]')].some(visible);
  const safe = !!button && !button.disabled && button.getAttribute?.('aria-disabled') !== 'true' && (onTop === button || button.contains(onTop)) && !blocked && !globalThis.__jobPilottoStopped;
  const factsOnly = document.querySelectorAll('[data-jobpilotto-grounding=unknown], [data-jobpilotto-guess]').length === 0 && fields.every(el => {
    if (['submit', 'button', 'reset'].includes(el.type)) return true;
    // Why (2026-10-28, found by the Full automation e2e): upload.js writes the input's own mark as dataset.jobPilottoFile and only the slot's as data-jobpilotto-file (read-back.js reads both); reading the slot's attribute on the input matched no CV, so every attachment handed the application over.
    if (el.type === 'file') return !el.files?.length || (el.dataset?.jobPilottoFile || el.closest?.('[data-jobpilotto-file]')?.dataset?.jobpilottoFile || el.getAttribute?.('data-jobpilotto-file')) === el.files[0].name;
    if (['checkbox', 'radio'].includes(el.type) && !el.checked) return true;
    return !clean(el.value || el.getAttribute?.('aria-valuetext') || el.textContent) || el.getAttribute?.('data-jobpilotto-grounding') === 'known';
  });
  // The values never leave the page: their digest detects edits/site replacement during the server round-trip.
  const bytes = new TextEncoder().encode(JSON.stringify([location?.href || '', fields.map(el => [el.id, el.name, el.type, el.value, !!el.checked, [...(el.files || [])].map(file => [file.name, file.size, file.lastModified])]), named.map(el => clean(el.innerText || el.textContent || el.value))]));
  const current = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (action !== 'press') {
    const headings = [...document.querySelectorAll('h1, h2')].map(el => clean(el.innerText)).filter(Boolean).slice(0, 6);
    return {requiredComplete, safe, factsOnly, seal: current, snapshot: {title: clean(document.title).slice(0, 180), headings, text: clean(document.body?.innerText).slice(0, 800), inputs: fields.length}};
  }
  if (!safe || !requiredComplete || !seal || seal !== current) return {pressed: false};
  // The normal press floor still rejects destructive controls; submit-watch is explicitly armed as automation, not as a human press.
  if (globalThis.__jobPilottoSubmitPress?.refused(button)) return {pressed: false};
  (globalThis.__jobPilottoPress?.(button) || button.click());
  return {pressed: true};
}
