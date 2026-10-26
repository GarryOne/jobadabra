// Rung 0 of the fill ladder: THE state of each control (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, amendment 4 "one truth per control"). One reader for every control kind,
// loaded in both worlds (the panel's list in background.js, the fill kit's PAGE_FILES in page-files.js, and before every judges' sketch: account-fill.js sketchOf), so the panel's left
// count (review.js), the fill's end read (fill-read.js describeForm, flow.js), the judges' sketch (account-fill.js), the audit (browser-form-fastpath.js), coverage.js and the upload
// operator (upload.js) read the same state of the same control; they used to keep copies that drifted (12 Oct 2026, Ashby: the fill said "8 filled, 1 left", the panel "5/10 left").
// stateOf(el) -> committed (holds a value: the one the fill typed, when it typed one) | mismatch (the fill typed, the box holds something else) | empty | unknown (only the extension's
// own mark says a file went in: the slot shows no file). An upload slot is read by what it shows: the file in its input, or a file name shown in the slot's own area (a custom uploader
// clears input.files and shows the file as a chip), never by the extension's mark alone. pass() is the fill's end read once the page settled: it writes each state on its control
// (data-jobpilotto-r0; unreachable when a dialog or a big fixed layer is drawn at the control's centre) and returns the states. Values never leave the page. Guard: worker/test/read-back.test.js.
(() => {
  if (window.__jobPilottoReadBack) return;
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const textOf = el => el?.innerText ?? el?.textContent ?? '';
  // aria-hidden marks a helper input (react-select's "required" input) that is no field; a select that still holds choices is the field a menu library hides beside its own box (Select2).
  const hiddenAway = el => el.getAttribute('aria-hidden') === 'true' && !(el.tagName === 'SELECT' && el.options.length > 1);
  const own = el => !!el.closest?.('[id^=jobpilotto], [id^=job-pilotto]');   // the extension's own panel
  // A file name: a stem that starts with a letter or digit, then its extension ("cv.pdf"); a format hint ("(.pdf, .docx, max 5 MB)") holds no name.
  const FILE_NAMES = /[\p{L}\p{N}][^\s\\/]*\.(?:pdf|docx?|rtf|txt|odt)\b/giu;
  const namesIn = text => [...new Set(String(text || '').match(FILE_NAMES) || [])];

  // A menu holds an answer when its selected option is a real choice: text, not disabled or hidden, a value that is not, on the first option, empty or a placeholder sentinel
  // (0, -1); further down 0 is an answer ("Number of children" 0; #331). Not "any index but the first": a menu with no blank first option starts on a real choice (easytemp, 9 Oct 2026).
  const chosen = el => (o => !!o && !o.disabled && !o.hidden && !!o.text.trim() && !(o.index === 0 && /^(|0|-1)$/.test(o.value)))(el.options[el.selectedIndex]);
  // A custom dropdown's choice (its own value is only typed search text): react-select's chip in its own container, else in the field's own area up 4 boxes (never into another
  // field's), or a hidden input a <label for> points to there (a type-to-search picklist; SuccessFactors, 8 Oct 2026), else a chip in the nearest "container" that holds no other
  // field (a wrapper around the whole form is not this field's: its chips are other fields'). -> the element that holds it, or null.
  const CHIP = '[class*=single-value], [class*=multi-value]', FIELDS = 'input:not([type=hidden]), select, textarea';
  // A select-only combobox that is no input (ARIA's pattern, OpenUI5's sap.m.Select: <div role=combobox> holding the shown choice, and a hidden input with its key beside it): its own
  // words ARE the choice. A key beside it that is empty means the first, "nothing chosen" item is the one shown ("No Selection"): empty. Structure only; no word is read.
  const selectOnly = el => {
    if (el.matches('input, textarea, select') || !String(el.textContent || '').trim()) return null;
    const keys = [...(el.parentElement?.querySelectorAll('input[type=hidden], input[aria-hidden=true]') || [])];
    return keys.length === 1 && !String(keys[0].value || '').trim() ? null : el;
  };
  // A picker whose search box is a plain input and whose choice stands beside it as a chip (Workday's multi-select: "Switzerland (+41)" in a list of selected items, 16 Oct 2026):
  // the box's own field area (up while no other field lives there) holds a shown option that is selected (aria-selected=true) or a chip (an option with no aria-selected at all, which
  // a menu's choices always carry). Never while a menu is open there (aria-expanded=true): its options are choices, not the value. Structure only; no word is read.
  const chipOf = el => {
    let box = el;
    while (box.parentElement && box.parentElement !== document.body && box.parentElement.querySelectorAll(FIELDS).length <= 1) box = box.parentElement;
    if (box === el || box.querySelector('[aria-expanded=true]') || el.getAttribute('aria-expanded') === 'true') return null;
    return [...box.querySelectorAll('[role=option]')].find(option => visible(option) && String(option.textContent || option.getAttribute('aria-label') || '').trim() &&
      (option.getAttribute('aria-selected') === 'true' || !option.hasAttribute('aria-selected'))) || null;
  };
  const comboValue = el => {
    const own = el.closest('[class*=select__container]')?.querySelector(CHIP);
    if (own) return own;
    if (!el.matches('input, textarea, select') && String(el.textContent || '').trim()) return selectOnly(el);   // shown words: the choice (or the placeholder item); none: the chip search below
    for (let box = el.parentElement, i = 0; box && i < 4 && box.querySelectorAll(FIELDS).length <= 1; box = box.parentElement, i++) {
      const found = box.querySelector(CHIP) || [...box.querySelectorAll('input[type=hidden][id]')].find(hidden => hidden.value && document.querySelector(`label[for="${CSS.escape(hidden.id)}"]`));
      if (found) return found;
    }
    const container = el.closest('[class*=container]');
    return container && container.querySelectorAll(FIELDS).length <= 1 ? container.querySelector(CHIP) : null;
  };
  // An upload slot whose input the page hides (display:none: react-dropzone draws its own zone, 12 Oct 2026 widget zoo): its visible area, the nearest shown box around the
  // input that holds no other field (at most 4 up), or null. The panel and the judges count such a slot by it, so the CV the fill attached there is never invisible to them.
  const shownSlot = input => {
    for (let box = input.parentElement, i = 0; box && i < 4; box = box.parentElement, i++) {
      if ([...box.querySelectorAll(FIELDS)].some(other => other !== input && other.type !== 'file')) return null;
      if (visible(box)) return box;
    }
    return null;
  };
  // The file this extension attached to a slot (page/upload.js marks the input and the slot with its name), if any.
  const ours = input => input.dataset?.jobPilottoFile || input.closest?.('[data-jobpilotto-file]')?.dataset.jobpilottoFile || '';
  // What an upload slot shows: its area up from the input while no other visible control lives there (at most 10 boxes), and the slot this extension marked when it attached.
  const slotText = input => {
    let box = input;
    for (let i = 0; i < 10 && box.parentElement; i++) {
      const up = box.parentElement;
      if ([...up.querySelectorAll('input, textarea, select')].some(other => other !== input && other.type !== 'file' && other.type !== 'hidden' && visible(other))) break;
      box = up;
    }
    const marked = input.closest?.('[data-jobpilotto-file]');
    return `${textOf(box)} ${marked && !box.contains(marked) ? textOf(marked) : ''}`;
  };
  // The file names the slot showed at first sight, kept on its input: written by the first reader in either world, and by page/upload.js before it attaches anything.
  const baseline = input => {
    if (!input.hasAttribute('data-jobpilotto-names-first')) input.setAttribute('data-jobpilotto-names-first', JSON.stringify(namesIn(slotText(input)).slice(0, 8)));
    try { return JSON.parse(input.getAttribute('data-jobpilotto-names-first')) || []; } catch { return []; }
  };
  // committed: the input holds a file, or the slot shows the file this extension attached, or a file name that was not there at first sight (a chip the uploader drew).
  // unknown: only the extension's own mark says a file went in, or the slot showed a name from the start (an example in a hint, a file attached before anyone looked):
  // never counted as filled (cc's review of #507, 12 Oct 2026: "Accepted: resume.pdf" in an empty slot read as a CV). empty: nothing at all (a format hint alone).
  const fileState = input => {
    if (input.files?.length) return 'committed';
    const first = baseline(input), name = ours(input), text = slotText(input), shown = namesIn(text);
    if ((name && text.includes(name)) || shown.some(found => !first.includes(found))) return 'committed';
    return name || shown.length ? 'unknown' : 'empty';
  };
  // A box: empty when it holds nothing or only a calling code (page/typed-check.js); mismatch when the fill typed it and it holds something else now.
  const boxState = el => {
    if (!(window.__jobPilottoBoxGiven ? window.__jobPilottoBoxGiven(el.value) : !!String(el.value ?? '').trim())) return 'empty';
    const typed = el.getAttribute('data-jobpilotto-typed');
    return typed && window.__jobPilottoTypedSame && !window.__jobPilottoTypedSame(typed, el.value) ? 'mismatch' : 'committed';
  };
  // The fill picked one option (data-jobpilotto-picked: its letters and digits, page/browser-form-fastpath.js, page/fill-menus.js) and the menu shows another: the page set it
  // back to its own (cc's review of #507: a country menu on the page's default read as answered).
  const alnum = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const pickedOther = (el, shown) => { const picked = el.getAttribute('data-jobpilotto-picked'), now = alnum(shown); return !!picked && now !== picked && !(/^\d{1,4}$/.test(now) && picked.endsWith(now)); };   // a picker that shows the picked option's calling code only ("Switzerland +41" -> "+41") is that option
  // What a custom dropdown shows of its choice: a chip's words; for a labelled hidden input, which holds a key ("688", SuccessFactors), the words in the box itself. A pick
  // counts as kept only when the box shows it: an empty box beside a key proves nothing (cc, 14 Oct 2026). Since ad30229 the key itself was compared with the picked option,
  // so every correct pick read as another one (Breitling: Country and language left). Guard: worker/test/picklist-hidden-key.test.js.
  const comboShown = (el, value) => (value.type === 'hidden' ? el.value : value.textContent || value.value);
  const stateOf = el => {
    if (!el) return 'empty';
    if (el.type === 'file') return fileState(el);
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'committed' : 'empty';
    if (el.tagName === 'SELECT') return !chosen(el) ? 'empty' : pickedOther(el, el.options[el.selectedIndex]?.text) ? 'mismatch' : 'committed';
    if (el.getAttribute('role') === 'combobox') { const value = comboValue(el); return !value ? 'empty' : pickedOther(el, comboShown(el, value)) ? 'mismatch' : 'committed'; }
    const state = boxState(el);
    if (state !== 'empty' || el.type === 'password' || el.tagName === 'TEXTAREA') return state;
    const chip = chipOf(el);
    return !chip ? state : pickedOther(el, chip.textContent || chip.getAttribute('aria-label')) ? 'mismatch' : 'committed';
  };

  // Something drawn over the control's centre that is a dialog or a fixed layer over most of the window, and does not hold the control (structure only, as extension/on-top.js).
  const DIALOG = '[role=dialog], [role=alertdialog], [aria-modal=true], dialog[open]';
  const covered = el => {
    const box = el.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
    if (!box.width || !box.height || x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;   // off screen: nothing is drawn there to ask
    const top = document.elementFromPoint(x, y);
    if (!top || own(top) || el.contains(top) || top.contains(el) || [...(el.labels || [])].some(label => label.contains(top))) return false;
    for (let node = top; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const layer = node.matches(DIALOG) || (getComputedStyle(node).position === 'fixed' && (b => b.width * b.height >= 0.4 * innerWidth * innerHeight)(node.getBoundingClientRect()));
      if (layer) return !node.contains(el);
    }
    return false;
  };
  // Until the page has been still for quietMs (our own marks and panel do not count), at most maxMs.
  const settle = (quietMs, maxMs) => new Promise(resolve => {
    let last = Date.now();
    const started = last, watch = new MutationObserver(records => { if (records.some(record => !own(record.target.nodeType === 1 ? record.target : record.target.parentElement || document.body) && !String(record.attributeName || '').startsWith('data-jobpilotto'))) last = Date.now(); });
    watch.observe(document.documentElement, {subtree: true, childList: true, attributes: true, characterData: true});
    const tick = () => { if (Date.now() - last >= quietMs || Date.now() - started >= maxMs) { watch.disconnect(); resolve(); } else setTimeout(tick, 100); };
    setTimeout(tick, 100);
  });
  const SKIP = ['hidden', 'submit', 'button', 'image', 'reset'];
  // The fill's end read: every control of the page (a file input even when the page hides it behind its own button), its state written on it. -> [{field, type, state, file?}]
  const pass = async ({quietMs = 700, maxMs = 2000} = {}) => {
    await settle(quietMs, maxMs);
    const rows = [];
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (SKIP.includes(el.type) || el.disabled || own(el) || (el.type !== 'file' && !visible(el))) continue;
      let state = stateOf(el);
      if (state !== 'committed' && el.type !== 'file' && covered(el)) state = 'unreachable';
      el.setAttribute('data-jobpilotto-r0', state);
      rows.push({field: el.id || el.name || '', type: el.type === 'file' ? 'file' : el.getAttribute('role') === 'combobox' ? 'combobox' : el.tagName === 'SELECT' ? 'select' : el.type || 'text', state,
        ...(el.type === 'file' && ours(el) ? {file: ours(el)} : {}), ...(el.hasAttribute('data-jobpilotto-gaveup') ? {gaveUp: true} : {})});   // gaveUp: its attempt log is spent (page/attempts.js)
    }
    return rows;
  };
  window.__jobPilottoChosen = chosen;   // the name the audit and coverage.js call it by
  // Custom dropdowns that are no input (<div role=combobox>, <button aria-haspopup=listbox>): fields the form reader and the audit both list, shown and not wrapping a real control
  // (a combobox that holds its own input is read through the input). The list they open sits in the page, named by aria-controls or beside the trigger.
  // The trigger's own wrapper holds its real field: one box beside it in a wrapper that is no form or fieldset (a trigger set straight in a form among its other boxes is the question
  // itself: widget zoo custom-select-1, a div combobox named by aria-labelledby, was never read).
  const ownField = el => { const up = el.parentElement; return !!up && !up.matches('form, fieldset') && up.querySelectorAll('input:not([type=hidden]), select, textarea').length === 1; };
  const customSelects = shown => [...document.querySelectorAll('div[role=combobox], button[role=combobox], button[aria-haspopup=listbox]')]
    .filter(el => shown(el) && !el.disabled && !hiddenAway(el) && !el.querySelector('input:not([type=hidden]), select, textarea') && !ownField(el));   // nor one whose own wrapper holds the real field (Workday's Phone Device Type button + its text input): that input is the question
  const choicesOf = el => {
    const list = (el.getAttribute('aria-controls') && document.getElementById(el.getAttribute('aria-controls'))) || el.parentElement?.parentElement?.querySelector('[role=listbox]');
    return Array.from(list?.querySelectorAll('[role=option]') || [], o => String(o.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 80);
  };
  window.__jobPilottoReadBack = {customSelects, choicesOf, stateOf, holds: el => stateOf(el) === 'committed', chosen, hiddenAway, comboValue, fileState, baseline, namesIn, shownSlot, pass};
})();
