// What the extension types into a sign-in or sign-up page and presses (owner, 8 Oct 2026): the one site password into its password boxes, then the
// control the AI named. Injected into the page by account-step.js (each export must stand alone: no imports, nothing from this file's scope). The
// person's details (email, names, country) are NOT here: the normal fill puts them in by the label meanings, in any language (fill-flow.js).
// Guard: app-core/test/account-fill.test.js, the live run (npm run live).
export function fillAccountBoxes(password) {
  let filled = 0;
  for (const box of document.querySelectorAll('input[type=password]')) {
    if (box.value === password && box.getClientRects().length) box.setAttribute('data-jobpilotto-filled', '1');   // already the right password (the browser's own autofill): ours too, not counted as filled now
    if (box.disabled || box.readOnly || box.value || !box.getClientRects().length) continue;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, password);   // React/Vue see the change too
    box.dispatchEvent(new Event('input', {bubbles: true}));
    box.dispatchEvent(new Event('change', {bubbles: true}));
    box.setAttribute('data-jobpilotto-filled', '1');
    filled++;
  }
  return filled;
}

// A sign-in page's one empty text or email box ahead of its password box gets the person's email. The normal fill runs once per address, and a site that keeps one address for
// sign-up and sign-in (SuccessFactors) never fills the sign-in page after the sign-up page. By structure only: exactly one such box in the password box's form, empty; marked ours.
export function fillAccountEmail(email) {
  if (!String(email || '').trim()) return 0;
  const password = [...document.querySelectorAll('input[type=password]')].find(box => box.getClientRects().length && !box.disabled);
  if (!password) return 0;
  const boxes = [...(password.form || document).querySelectorAll('input')].filter(el => el.getClientRects().length && !el.disabled && !el.readOnly
    && ['text', 'email'].includes(el.type) && (el.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING));
  if (boxes.length !== 1 || String(boxes[0].value || '').trim()) return 0;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(boxes[0], String(email));   // React/Vue see the change too
  boxes[0].dispatchEvent(new Event('input', {bubbles: true}));
  boxes[0].dispatchEvent(new Event('change', {bubbles: true}));
  boxes[0].setAttribute('data-jobpilotto-filled', '1');
  return 1;
}

// The code from the confirmation mail (owner, 10 Oct 2026: "the email code we can automate if we're connected to Gmail"), typed into the box the account AI
// named (its label, copied from the page's own list), else the page's one empty code-like box, or across a row of one-character boxes. Never a password box.
// Marks what it filled, so pressAccountButton may press the form's button next. -> 1 when filled, else 0.
export function fillCodeBox(label, code) {
  const value = String(code || '').trim();
  if (!value) return 0;
  const visible = el => el.getClientRects().length && !el.disabled && !el.readOnly;
  const set = (box, text) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, text);
    box.dispatchEvent(new Event('input', {bubbles: true})); box.dispatchEvent(new Event('change', {bubbles: true}));
    box.setAttribute('data-jobpilotto-filled', '1');
  };
  const boxes = [...document.querySelectorAll('input')].filter(el => visible(el) && ['text', 'tel', 'number', ''].includes(el.type) && !String(el.value || '').trim());
  const singles = boxes.filter(el => el.maxLength === 1);
  if (singles.length >= 4 && singles.length === value.length) { singles.forEach((box, i) => set(box, value[i])); return 1; }
  const norm = text => String(text || '').replace(/[*:]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const labelOf = el => norm((el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText) || el.closest('label')?.innerText || el.getAttribute('aria-label') || el.placeholder || '');
  const named = norm(label) ? boxes.filter(el => labelOf(el) === norm(label)) : [];
  const box = named.length === 1 ? named[0] : boxes.length === 1 ? boxes[0] : null;
  if (!box) return 0;
  set(box, value);
  return 1;
}

// Press the account form's own button, once (the caller asks the AI first: account-step.js): a box we filled is on the page (a password, else, on an
// email-first page with no password yet (jobs.ch, 9 Oct 2026), the email the fill typed), no required control is empty (a second floor: the AI's "ready"
// is the first), no frame inside the form (a bot check, whoever makes it). Returns a short reason code for the log.
export function pressAccountButton(named = '') {
  const box = document.querySelector('input[type=password][data-jobpilotto-filled]') || document.querySelector('input[data-jobpilotto-filled]:not([type=hidden]):not([type=checkbox]):not([type=radio])');
  if (!box) return 'not-filled';
  if (document.documentElement.hasAttribute('data-jobpilotto-account-pressed')) return 'already-pressed';
  const scope = box.form || document;
  const visible = el => el.getClientRects().length && !el.disabled;
  if ([...scope.querySelectorAll('iframe')].some(visible)) return 'bot-check';
  const empty = [...scope.querySelectorAll('input, select, textarea')].filter(el => visible(el) && !['hidden', 'submit', 'button', 'image', 'reset'].includes(el.type)
    && (el.required || el.getAttribute('aria-required') === 'true')
    && (el.type === 'checkbox' || el.type === 'radio' ? !el.checked : !String(el.value || '').trim()));
  if (empty.length) return 'needs-you';
  // The button the AI named (its text, copied from the page's own list), else the form's one submit button.
  const text = el => String(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const wanted = String(named || '').replace(/\s+/g, ' ').trim().toLowerCase();
  let buttons = wanted ? [...document.querySelectorAll('button, input[type=submit], input[type=button], [role=button], a')].filter(el => visible(el) && text(el) === wanted)
    : [...scope.querySelectorAll('button[type=submit], input[type=submit], button:not([type])')].filter(visible);
  if (buttons.length > 1) {   // several carry the named text (the header's "Sign In" and the form's): the one in the smallest block that also holds the filled box is the form's own. Inline: injected alone.
    const open = buttons.filter(el => !el.closest('[aria-hidden=true]'));   // a copy hidden from assistive tech (Workday's real submit button behind its click overlay) is not what a person presses
    if (open.length) buttons = open;
    const span = el => { for (let at = el.parentElement; at; at = at.parentElement) if (at.contains(box)) return at.getElementsByTagName('*').length; return Infinity; };
    if (buttons.length > 1) { const sizes = buttons.map(span), best = Math.min(...sizes), nearest = buttons.filter((el, i) => sizes[i] === best); if (best !== Infinity && nearest.length === 1) buttons = nearest; }
  }
  const lone = buttons.length === 1 ? buttons[0] : null;
  if (!lone) return buttons.length ? 'several-buttons' : 'no-button';
  document.documentElement.setAttribute('data-jobpilotto-account-pressed', '1');
  (globalThis.__jobPilottoPress?.(lone) || lone.click());
  return 'pressed';
}

// What the AI is shown of the page (lib/account-judge.js): controls with their state but never their values, buttons and links, the short visible texts (messages,
// errors) and the host names of visible frames. Injected into the page.
export function accountSketch() {
  const shown = el => el.getClientRects().length > 0 && !el.closest('[id^=jobpilotto], [id^=jobadabra]');   // never the extension's own UI (desktop/e2e/test/own-ui-not-read.test.mjs)
  const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  // A control's state is the one reading the panel and the fill use (page/read-back.js; judge-sketch.js loads it first): a menu on a real option, a picklist by its chip or labelled
  // hidden input (its own value is only typed search text), a box holding more than a calling code, an upload slot by the file it shows (the extension's own mark alone is no file).
  // Guards: desktop/e2e/test/judge-sketch-picklist.test.mjs (11 Oct 2026: a chosen Country read "empty"), app-core/test/read-back.test.js.
  const read = el => window.__jobPilottoReadBack ? window.__jobPilottoReadBack.stateOf(el) : 'unknown';
  const given = el => ['committed', 'mismatch'].includes(read(el));   // it holds something; whether it is what the fill gave it is the match below
  // A field the page gives no label is named as the panel and the fill trace name it (page/fill-labels.js labelOf, in the page's own world: form-ready.js runs this there), else by its raw name.
  // The label the page gives the field keeps its required mark ("Country*": the judge reads the mark); only a field the old chain would call by its raw name asks the kit's reader for the question first.
  const nameOf = el => el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.placeholder || (window.__jobPilottoFillKit?.labelOf ? window.__jobPilottoFillKit.labelOf(el) : '') || el.name || '';
  // Did the control keep what the fill gave it? Measured here, from the fill's own marks (what it typed, as letters and digits: page/browser-form-fastpath.js; that it set it: page/fill.js);
  // the value never leaves the page. yes | no | '' (the fill did not touch it). Read by the fill ladder's fill_verify (desktop/lib/ladder/fill-verify.js); the other judges ignore it.
  const matchOf = el => {
    // A radio question is one answer: an option the fill did not pick is not a miss while another option of its group is chosen (the repair rung would click it and flip a right answer).
    if (el.type === 'radio' && !el.checked && el.name && Array.from((el.form || document).querySelectorAll('input[type=radio]')).some(other => other.name === el.name && other.checked)) return '';
    const state = read(el);
    if (el.hasAttribute('data-jobpilotto-typed') && state !== 'unknown') return state === 'committed' ? 'yes' : 'no';
    if (el.hasAttribute('data-jobpilotto-nottaken')) return 'no';   // the fill gave it an answer and the page did not take it (page/fill-verify.js)
    if (el.hasAttribute('data-jobpilotto-class')) return state === 'committed' ? 'yes' : 'no';   // the fill had an answer for it (page/value-class.js marks every answered control): a menu with no option for it is a miss, not untouched
    if (!el.hasAttribute('data-jobpilotto-filled')) return '';
    return state === 'committed' ? 'yes' : 'no';
  };
  // For the fill ladder's check and repair (desktop/lib/ladder/fill-verify.js, fill-repair.js), never a value: the kind of value the fill gave it (page/value-class.js), whether it is a
  // legal question (the AI's reading, page/categories.js, or the fill kit's floor: never repaired, always the person's), how many tries it had (page/attempts.js).
  const ladderOf = el => {
    const answer = el.getAttribute('data-jobpilotto-class') || '', tried = (() => { try { return JSON.parse(el.getAttribute('data-jobpilotto-tried') || '[]').length; } catch { return 0; } })();
    const legal = el.dataset?.jobpilottoCategory === 'legal' || !!window.__jobPilottoFillKit?.LEGAL?.test(nameOf(el));
    // Its field box's fingerprint (page/skeleton.js: tags, roles and class words, never text, ids or values; the box: up from the control while no other control lives there, at
    // most 3 boxes): the key a repair that worked is kept by (desktop/lib/ladder/repair-kept.js), the same on every site that draws the same widget.
    let box = el;
    for (let i = 0; i < 3 && box.parentElement && box.parentElement.querySelectorAll('input:not([type=hidden]), select, textarea').length <= 1; i++) box = box.parentElement;
    let fp = ''; try { fp = window.__jobPilottoSkeleton ? window.__jobPilottoSkeleton.fingerprint(window.__jobPilottoSkeleton.skeleton(box)) : ''; } catch { fp = ''; }
    return {...(answer ? {answer} : {}), ...(legal ? {legal} : {}), ...(tried ? {tried} : {}), ...(fp ? {fp} : {})};
  };
  const hiddenSlot = el => el.type === 'file' && !!window.__jobPilottoReadBack?.shownSlot(el) && !el.closest('[id^=jobpilotto], [id^=jobadabra]');   // a CV slot whose input the page hides, by its visible zone (read-back.js), as the panel counts it
  const listed = [...document.querySelectorAll('input, select, textarea')].filter(el => (shown(el) || hiddenSlot(el)) && !['hidden', 'submit', 'button', 'image', 'reset'].includes(el.type));
  listed.forEach((el, index) => el.setAttribute('data-jobpilotto-n', String(index + 1)));   // the number the fill ladder's repair names a control by (page/repair-act.js); the judges number them the same way
  const controls = listed.map(el => ({
    type: el.type, label: clean(nameOf(el), 80), match: matchOf(el), ...ladderOf(el),
    required: !!el.required || el.getAttribute('aria-required') === 'true',
    at: (box => `${Math.max(0, Math.min(100, Math.round(100 * (box.left + box.width / 2) / innerWidth)))},${Math.max(0, Math.min(100, Math.round(100 * (box.top + box.height / 2) / innerHeight)))}`)((shown(el) ? el : window.__jobPilottoReadBack.shownSlot(el)).getBoundingClientRect()),   // where it is on screen (% of the window): the closer look matches the picture to the control
    ...(el.tagName === 'SELECT' ? {options: [...el.options].map(item => clean(item.text, 40)).filter(Boolean).slice(0, 40)} : {}),
    state: el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? 'checked' : 'unchecked') : (given(el) ? 'filled' : 'empty')}));   // an upload slot: the file it shows (read-back.js), not only the input's own list
  const buttons = [...new Set([...document.querySelectorAll('button, input[type=submit], input[type=button], [role=button], a')].filter(shown).map(el => clean(el.innerText || el.value || el.getAttribute('aria-label'), 60)).filter(Boolean))];
  const seen = new Set(), texts = [];
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (el.children.length || !shown(el) || ['SCRIPT', 'STYLE', 'OPTION', 'BUTTON', 'A', 'LABEL', 'INPUT'].includes(el.tagName)) continue;
    const text = clean(el.textContent, 160);
    if (text.length >= 3 && !seen.has(text)) { seen.add(text); texts.push(text); }
  }
  const frames = [...document.querySelectorAll('iframe')].filter(shown).map(el => { try { return new URL(el.src, location.href).hostname; } catch { return 'frame'; } });
  return {url: location.href.split('#')[0], title: clean(document.title, 160), headings: [...document.querySelectorAll('h1, h2, h3')].filter(shown).map(el => clean(el.innerText, 100)).slice(0, 8),
    controls, buttons: buttons.slice(0, 25), texts: texts.length > 30 ? [...texts.slice(0, 15), ...texts.slice(-15)] : texts, frames: frames.slice(0, 8)};
}

// Says on the page what the person must do (the panel reads it): the label of the control that needs them, "1" when only that the site did not accept it, null to clear it.
// What the AI says this page is (sign_in, sign_up, ...): the panel words its ready line from it. '' removes it.
export function markAccountStep(step) { if (step) document.documentElement.setAttribute('data-jobpilotto-account-step', step); else document.documentElement.removeAttribute('data-jobpilotto-account-step'); }
export function flagAccount(needs) { if (needs === null) document.documentElement.removeAttribute('data-jobpilotto-needs'); else document.documentElement.setAttribute('data-jobpilotto-needs', needs || '1'); }   // the panel reads it on account pages AND application forms   // null: nothing is owed any more

// A control the AI named (the register link of a sign-in page, a consent link or accept button, a consent checkbox's label), pressed once. Nothing is filled first.
export function pressRegister(named) {
  const wanted = String(named || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!wanted) return 'not-named';
  const text = el => String((el.innerText ?? el.textContent) || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const all = [...document.querySelectorAll('a, button, input[type=submit], input[type=button], [role=button], label')].filter(el => el.getClientRects().length && !el.disabled && text(el));   // a label toggles its checkbox
  // The named text is the exact text of one control; else the one control whose text holds it or is held by it (the AI may name a control a little short or long), never a guess between several.
  const exact = all.filter(el => text(el) === wanted), near = all.filter(el => text(el).length >= 3 && wanted.length >= 3 && (text(el).includes(wanted) || wanted.includes(text(el))));
  let found = exact.length ? exact : near;
  if (found.length > 1) {   // several carry the text (a copy hidden from assistive tech is dropped first): the one in the smallest block that also holds a shown text box (beside the page's fields) is meant; a tie stays several. Inline: this function is injected into the page alone.
    const open = found.filter(item => !item.closest('[aria-hidden=true]'));
    if (open.length) found = open;
    const boxes = [...document.querySelectorAll('input, textarea, select')].filter(item => item.getClientRects().length && !['hidden', 'submit', 'button', 'image', 'reset', 'checkbox', 'radio'].includes(item.type));
    const span = item => { for (let at = item.parentElement; at; at = at.parentElement) if (boxes.some(box => at.contains(box))) return at.getElementsByTagName('*').length; return Infinity; };
    const sizes = found.map(span), best = Math.min(...sizes), nearest = found.filter((item, i) => sizes[i] === best);
    if (best !== Infinity && nearest.length === 1) found = nearest;
  }
  if (found.length !== 1) return found.length ? 'several' : 'not-found';
  (globalThis.__jobPilottoPress?.(found[0]) || found[0].click());
  return 'pressed';
}

// A consent the AI named, accepted once (owner, 10 Oct 2026: never an optional box in the person's name): found like pressRegister, and a CHECKBOX (or its label) only when
// the page itself says it is needed, i.e. the box is required or the form's own button is disabled while it is unticked. Newsletters, job alerts, talent pools and sharing
// with other companies are optional: never ticked, even if named. A link or a dialog's accept button (a privacy statement to open and accept) is pressed as before.
export function pressConsent(named) {
  const wanted = String(named || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!wanted) return 'not-named';
  const text = el => String((el.innerText ?? el.textContent) || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const all = [...document.querySelectorAll('a, button, input[type=submit], input[type=button], [role=button], label, input[type=checkbox]')].filter(el => el.getClientRects().length && !el.disabled && text(el));
  const exact = all.filter(el => text(el) === wanted), near = all.filter(el => text(el).length >= 3 && wanted.length >= 3 && (text(el).includes(wanted) || wanted.includes(text(el))));
  let found = exact.length ? exact : near;
  if (found.length > 1) {   // several carry the text (a copy hidden from assistive tech is dropped first): the one in the smallest block that also holds a shown text box (beside the page's fields) is meant; a tie stays several. Inline: this function is injected into the page alone.
    const open = found.filter(item => !item.closest('[aria-hidden=true]'));
    if (open.length) found = open;
    const boxes = [...document.querySelectorAll('input, textarea, select')].filter(item => item.getClientRects().length && !['hidden', 'submit', 'button', 'image', 'reset', 'checkbox', 'radio'].includes(item.type));
    const span = item => { for (let at = item.parentElement; at; at = at.parentElement) if (boxes.some(box => at.contains(box))) return at.getElementsByTagName('*').length; return Infinity; };
    const sizes = found.map(span), best = Math.min(...sizes), nearest = found.filter((item, i) => sizes[i] === best);
    if (best !== Infinity && nearest.length === 1) found = nearest;
  }
  if (found.length !== 1) return found.length ? 'several' : 'not-found';
  const el = found[0];
  const box = el.matches('input[type=checkbox]') ? el : el.matches('label') ? (el.control || el.querySelector('input[type=checkbox]')) : null;
  if (box) {
    if (box.checked) return 'already';
    const scope = box.form || document;
    const button = [...scope.querySelectorAll('button[type=submit], input[type=submit], button:not([type])')].find(b => b.getClientRects().length);
    const needed = box.required || box.getAttribute('aria-required') === 'true' || !!(button && button.disabled);
    if (!needed) return 'optional-box';
  }
  (globalThis.__jobPilottoPress?.(el) || el.click());
  return 'pressed';
}

// What is left to do on this page's password boxes, cheaply, before anything is asked of the app (the panel calls every 2 s): `boxes` visible, `empty` still to fill; `pending` = a box we
// filled whose account button the AI-judged flow has not pressed yet. Injected into the page.
export function passwordWork() {
  const boxes = [...document.querySelectorAll('input[type=password]')].filter(box => box.getClientRects().length && !box.disabled && !box.readOnly);
  return {boxes: boxes.length, empty: boxes.filter(box => !box.value).length, pending: boxes.some(box => box.hasAttribute('data-jobpilotto-filled')) && !document.documentElement.hasAttribute('data-jobpilotto-account-pressed')};
}
